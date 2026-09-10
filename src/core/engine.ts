import type { ContentAccess } from "emdash";
import { extractOccurrences } from "./extract.js";
import { LinkChecker } from "./http.js";
import type { HttpTransport } from "./http.js";
import { GrokipediaProvider, WaybackProvider } from "./providers.js";
import type { ArchiveProvider, EncyclopediaProvider } from "./providers.js";
import { DAY, HOUR, assertNever } from "./schema.js";
import type {
  Command,
  HistoryEntry,
  LinkRecord,
  ResolvedOptions,
  Settings,
  WorkerState,
} from "./schema.js";
import type { RelinkStore } from "./storage.js";
import { checkUrl, domainExcluded } from "./url.js";

export function newLink(id: string, url: string, now: number): LinkRecord {
  return {
    schemaVersion: 1,
    id,
    url,
    host: new URL(url).hostname,
    createdAt: now,
    updatedAt: now,
    nextCheckAt: now,
    firstFailureAt: null,
    lastFailureAt: null,
    failures: 0,
    recoveryAt: null,
    lastCheck: null,
    replacement: null,
    review: null,
    excluded: false,
    automaticDisabled: false,
    active: true,
    archiveRetryAt: null,
    grokipediaChecked: false,
  };
}
export interface EngineDependencies {
  store: RelinkStore;
  content: ContentAccess;
  transport: HttpTransport;
  options: ResolvedOptions;
  clock?: () => number;
  archive?: ArchiveProvider;
  encyclopedia?: EncyclopediaProvider;
}

/** Invoke tick only through EmDash's single, atomically claimed recurring job. */
export class RelinkEngine {
  private readonly clock: () => number;
  constructor(private readonly dependencies: EngineDependencies) {
    this.clock = dependencies.clock ?? Date.now;
  }
  private get store(): RelinkStore {
    return this.dependencies.store;
  }

  async tick(): Promise<void> {
    const state = await this.store.state();
    state.lastStartedAt = this.clock();
    state.lastError = null;
    await this.store.saveState(state);
    try {
      await this.processCommands(state);
      const settings = await this.store.settings();
      if (settings.enabled) {
        await this.scanBatch(state);
        const checker = new LinkChecker(
          this.dependencies.transport,
          settings,
          this.clock,
        );
        const due = await this.store.links.page({
          where: { active: true, nextCheckAt: { lte: this.clock() } },
          orderBy: { nextCheckAt: "asc" },
          limit: 100,
        });
        // A bounded tick stays below EmDash's ten-minute stale-claim window.
        const groups = new Map<string, LinkRecord>();
        for (const link of due.items)
          if (!groups.has(link.host) && groups.size < settings.batchSize)
            groups.set(link.host, link);
        await Promise.all(
          [...groups.values()].map(async (link) => {
            await this.checkLink(link, settings, checker);
            state.processed++;
          }),
        );
      }
      state.lastCompletedAt = this.clock();
      await this.store.saveState(state);
    } catch (error) {
      state.lastError = "storage";
      await this.store.saveState(state);
      throw error;
    }
  }

  private async event(
    link: LinkRecord,
    event: HistoryEntry["event"],
    id: string,
  ): Promise<void> {
    await this.store.history.put(id, {
      schemaVersion: 1,
      id,
      linkId: link.id,
      originalUrl: link.url,
      at: this.clock(),
      event,
      result: link.lastCheck,
      destination: link.replacement?.url ?? null,
      replacement: link.replacement,
    });
  }

  private async processCommands(state: WorkerState): Promise<void> {
    const commands = await this.store.commands.page({
      orderBy: { createdAt: "asc" },
      limit: 4,
    });
    for (const command of commands.items) {
      await this.apply(command, state);
      // Persist the scan request before acknowledging its command.
      await this.store.saveState(state);
      await this.store.commands.delete(command.id);
    }
  }

  private async apply(command: Command, state: WorkerState): Promise<void> {
    const input = command.input;
    if (input.action === "scan") {
      state.nextScanAt = 0;
      return;
    }
    if (input.action === "settings") {
      await this.store.saveSettings(input.settings);
      return;
    }
    const link = await this.store.links.get(input.linkId);
    if (!link) return;
    let event: HistoryEntry["event"] | null = null;
    switch (input.action) {
      case "check":
        link.nextCheckAt = Math.min(link.nextCheckAt, command.createdAt);
        link.grokipediaChecked = false;
        break;
      case "exclude":
        link.excluded = input.value;
        event = input.value ? "excluded" : "included";
        link.nextCheckAt = command.createdAt;
        break;
      case "undo":
        link.replacement = null;
        link.review = null;
        link.automaticDisabled = true;
        event = "undo";
        break;
      case "reschedule":
        link.review = { dueAt: input.dueAt, reason: "manual-review" };
        link.nextCheckAt = input.dueAt;
        event = "rescheduled";
        break;
      case "destination": {
        const checker = new LinkChecker(
          this.dependencies.transport,
          await this.store.settings(),
          this.clock,
        );
        const result = await checker.check(input.url);
        if (result.kind === "healthy") {
          link.replacement = {
            kind: "manual",
            url: input.url,
            verifiedAt: this.clock(),
            reason: "editor-override",
          };
          link.automaticDisabled = true;
          event = "override";
        } else {
          link.review = { dueAt: this.clock(), reason: "replacement-failed" };
          event = "replacement-unavailable";
        }
        break;
      }
      default:
        assertNever(input);
    }
    link.updatedAt = this.clock();
    await this.store.links.put(link.id, link);
    if (event) await this.event(link, event, command.id);
  }

  private async scanBatch(state: WorkerState): Promise<void> {
    if (!state.scan && state.nextScanAt <= this.clock())
      state.scan = {
        sourceIndex: 0,
        cursor: null,
        generation: crypto.randomUUID(),
        startedAt: this.clock(),
      };
    const scan = state.scan;
    if (!scan) return;
    const source = this.dependencies.options.sources[scan.sourceIndex];
    if (!source) {
      state.scan = null;
      state.nextScanAt = this.clock() + DAY;
      return;
    }
    const page = await this.dependencies.content.list(source.collection, {
      where: { status: "published" },
      limit: 10,
      ...(scan.cursor ? { cursor: scan.cursor } : {}),
    });
    for (const content of page.items) {
      if (content.status !== "published") continue;
      const occurrences = await extractOccurrences(
        {
          id: content.id,
          slug: content.slug ?? content.id,
          locale: content.locale ?? "en",
          title:
            typeof content.data["title"] === "string"
              ? content.data["title"]
              : (content.slug ?? content.id),
          data: content.data,
        },
        source,
        this.dependencies.options.siteUrl,
        scan.generation,
      );
      for (const occurrence of occurrences) {
        const existing = await this.store.links.get(occurrence.linkId);
        const link =
          existing ??
          newLink(
            occurrence.linkId,
            checkUrl(occurrence.originalUrl),
            this.clock(),
          );
        if (!link.active) link.nextCheckAt = this.clock();
        link.active = true;
        await this.store.links.put(link.id, link);
        await this.store.occurrences.put(occurrence.id, occurrence);
      }
    }
    scan.cursor = page.hasMore ? (page.cursor ?? null) : null;
    if (!scan.cursor) {
      // Only sweep after completing a collection: a failed scan never drops valid occurrences.
      const previous = await this.store.occurrences.all({
        where: { collection: source.collection },
      });
      const touched = new Set<string>();
      for (const occurrence of previous) {
        if (occurrence.generation !== scan.generation) {
          await this.store.occurrences.delete(occurrence.id);
          touched.add(occurrence.linkId);
        }
      }
      for (const id of touched) {
        const remaining = await this.store.occurrences.page({
          where: { linkId: id },
          limit: 1,
        });
        if (remaining.items.length === 0) {
          const link = await this.store.links.get(id);
          if (link) {
            link.active = false;
            await this.store.links.put(id, link);
          }
        }
      }
      scan.sourceIndex++;
      if (scan.sourceIndex >= this.dependencies.options.sources.length) {
        state.scan = null;
        state.nextScanAt = this.clock() + DAY;
      }
    }
    await this.store.saveState(state);
  }

  async checkLink(
    link: LinkRecord,
    settings: Settings,
    checker: LinkChecker,
  ): Promise<void> {
    const now = this.clock();
    if (link.excluded || domainExcluded(link.host, settings.excludedDomains)) {
      link.nextCheckAt = now + settings.healthyDays * DAY;
      await this.store.links.put(link.id, link);
      return;
    }
    let result = await checker.check(link.url);
    if (
      result.kind === "broken" &&
      (result.status === null || result.status >= 500) &&
      !(await checker.networkAvailable(
        this.dependencies.options.networkProbeUrls,
      ))
    )
      result = {
        kind: "unverifiable",
        checkedAt: now,
        finalUrl: link.url,
        status: null,
        reason: "network-outage",
        retryAt: now + HOUR,
      };
    link.lastCheck = result;
    link.updatedAt = now;
    let event: HistoryEntry["event"] = "checked";
    const occurrences = await this.store.occurrences.all({
      where: { linkId: link.id },
    });
    const fragments = [
      ...new Set(
        occurrences.map((occurrence) => new URL(occurrence.originalUrl).hash),
      ),
    ];
    switch (result.kind) {
      case "unverifiable":
        link.nextCheckAt = result.retryAt ?? now + DAY;
        link.review = { dueAt: link.nextCheckAt, reason: "unverifiable" };
        if (link.replacement) {
          const replacement = await checker.check(link.replacement.url);
          if (replacement.kind === "broken") {
            if (link.replacement.kind !== "manual") link.replacement = null;
            link.review = { dueAt: now, reason: "replacement-failed" };
            event = "replacement-unavailable";
          }
        }
        break;
      case "healthy": {
        link.failures = 0;
        link.firstFailureAt = null;
        link.lastFailureAt = null;
        link.archiveRetryAt = null;
        link.nextCheckAt = now + settings.healthyDays * DAY;
        if (link.replacement?.kind === "archive") {
          if (link.recoveryAt !== null && now - link.recoveryAt >= DAY) {
            link.replacement = null;
            link.review = null;
            link.recoveryAt = null;
            event = "original-restored";
          } else {
            link.recoveryAt ??= now;
            link.nextCheckAt = link.recoveryAt + DAY;
          }
        } else if (link.replacement?.kind === "grokipedia") {
          const replacement = await checker.check(link.replacement.url);
          if (replacement.kind !== "healthy") {
            link.replacement = null;
            link.review = null;
            link.grokipediaChecked = true;
            event = "original-restored";
          }
        } else if (link.replacement?.kind === "manual") {
          const replacement = await checker.check(link.replacement.url);
          if (replacement.kind !== "healthy")
            link.review = { dueAt: now, reason: "replacement-failed" };
        } else if (
          settings.grokipediaEnabled &&
          !link.automaticDisabled &&
          !link.grokipediaChecked
        ) {
          const provider =
            this.dependencies.encyclopedia ??
            new GrokipediaProvider(checker, this.clock);
          const discovery = await provider.discover(link, fragments);
          link.grokipediaChecked = discovery.kind !== "unavailable";
          if (discovery.kind === "found") {
            link.replacement = discovery.replacement;
            link.review = null;
            event = "grokipedia-applied";
          } else if (discovery.kind === "ambiguous")
            link.review = { dueAt: now, reason: "grokipedia-ambiguous" };
        } else if (link.review?.reason === "unverifiable") link.review = null;
        break;
      }
      case "broken": {
        link.recoveryAt = null;
        link.firstFailureAt ??= now;
        if (link.lastFailureAt === null || now - link.lastFailureAt >= DAY) {
          link.failures++;
          link.lastFailureAt = now;
        }
        link.nextCheckAt =
          link.failures < 2
            ? link.lastFailureAt + DAY
            : link.failures < 3
              ? Math.max(now + DAY, link.firstFailureAt + 3 * DAY)
              : now + settings.reviewDays * DAY;
        if (link.replacement) {
          const replacement = await checker.check(link.replacement.url);
          if (replacement.kind === "broken") {
            if (link.replacement.kind !== "manual") link.replacement = null;
            link.review = { dueAt: now, reason: "replacement-failed" };
            event = "replacement-unavailable";
          }
        }
        if (
          link.failures >= 3 &&
          !link.replacement &&
          !link.automaticDisabled &&
          settings.archiveEnabled &&
          (link.archiveRetryAt === null || link.archiveRetryAt <= now)
        ) {
          const provider =
            this.dependencies.archive ??
            new WaybackProvider(checker, this.clock);
          const discovery = await provider.discover(link, fragments);
          if (discovery.kind === "found") {
            link.replacement = discovery.replacement;
            link.review = {
              dueAt: now + settings.reviewDays * DAY,
              reason: "archive-active",
            };
            event = "archive-applied";
          } else {
            const unavailable = discovery.kind === "unavailable";
            link.archiveRetryAt =
              now + (unavailable ? DAY : settings.archiveRetryDays * DAY);
            link.review = {
              dueAt: link.archiveRetryAt,
              reason: unavailable ? "archive-unavailable" : "archive-missing",
            };
            link.nextCheckAt = Math.min(link.nextCheckAt, link.archiveRetryAt);
          }
        }
        break;
      }
      default:
        assertNever(result);
    }
    await this.store.links.put(link.id, link);
    await this.event(link, event, `${link.id}:${now}:${event}`);
  }
}

import { definePlugin, PluginRouteError } from "emdash";
import type { PluginContext, ResolvedPlugin, RouteContext } from "emdash";
import { z } from "zod";
import { RelinkEngine } from "./core/engine.js";
import { effectiveDestination, listQuerySchema } from "./core/api.js";
import type { AdminSnapshot } from "./core/api.js";
import { extractOccurrences } from "./core/extract.js";
import { indexedPaths } from "./core/paths.js";
import { commandInputSchema, optionsSchema } from "./core/schema.js";
import type { CommandInput, ResolvedOptions } from "./core/schema.js";
import { RelinkStore, storageDefinition } from "./core/storage.js";
import { isPublicUrl } from "./core/url.js";
import { adminConfiguration } from "./metadata.js";

const TASK = "maintenance-v1";
export function requireMethod(request: Request, method: "GET" | "POST"): void {
  if (
    request.method !== method &&
    !(method === "GET" && request.method === "HEAD")
  )
    throw new PluginRouteError("METHOD_NOT_ALLOWED", "Method not allowed", 405);
}
export async function ensureScheduled(
  context: Pick<PluginContext, "cron">,
): Promise<void> {
  if (!context.cron) throw new Error("EmDash cron is required");
  const tasks = await context.cron.list();
  if (!tasks.some((task) => task.name === TASK))
    await context.cron.schedule(TASK, { schedule: "* * * * *" });
}
async function enqueue(
  store: RelinkStore,
  input: CommandInput,
): Promise<string> {
  const id = crypto.randomUUID();
  await store.commands.put(id, { id, createdAt: Date.now(), input });
  return id;
}

export async function adminSnapshot(
  store: RelinkStore,
  context: Pick<RouteContext, "request" | "cron" | "user">,
): Promise<AdminSnapshot> {
  const query = listQuerySchema.parse(
    Object.fromEntries(new URL(context.request.url).searchParams),
  );
  const [allLinks, allOccurrences, settings, worker, scheduled, commands] =
    await Promise.all([
      store.links.all(),
      store.occurrences.all(),
      store.settings(),
      store.state(),
      context.cron?.list() ?? [],
      store.commands.all(),
    ]);
  const now = Date.now();
  const active = allLinks.filter((link) => link.active);
  const matches = (query.view === "history" ? allLinks : active)
    .filter((link) => {
      const occurrences = allOccurrences.filter(
        (occurrence) => occurrence.linkId === link.id,
      );
      if (query.view === "problems" && link.lastCheck?.kind !== "broken")
        return false;
      if (query.view === "archives" && link.replacement?.kind !== "archive")
        return false;
      if (query.view === "reviews" && (!link.review || link.review.dueAt > now))
        return false;
      if (
        query.view === "grokipedia" &&
        !link.host.endsWith("wikipedia.org") &&
        link.replacement?.kind !== "grokipedia"
      )
        return false;
      if (query.domain && !link.host.includes(query.domain.toLowerCase()))
        return false;
      if (
        query.state &&
        query.state !==
          (link.excluded ? "excluded" : (link.lastCheck?.kind ?? "pending"))
      )
        return false;
      if (
        query.reviewBefore !== undefined &&
        (!link.review || link.review.dueAt > query.reviewBefore)
      )
        return false;
      const search = query.search.toLowerCase();
      if (
        search &&
        !`${link.url} ${occurrences.map((entry) => `${entry.title} ${entry.text}`).join(" ")}`
          .toLowerCase()
          .includes(search)
      )
        return false;
      return (
        (!query.collection && !query.contentId && !query.language) ||
        occurrences.some(
          (entry) =>
            (!query.collection || entry.collection === query.collection) &&
            (!query.contentId || entry.contentId === query.contentId) &&
            (!query.language ||
              entry.locale.toLowerCase().split("-")[0] ===
                query.language.toLowerCase().split("-")[0]),
        )
      );
    })
    .sort((a, b) => a.nextCheckAt - b.nextCheckAt || a.id.localeCompare(b.id));
  const matchingIds = new Set(matches.map((link) => link.id));
  const matchingHistory =
    query.view === "history"
      ? (await store.history.all({ orderBy: { at: "desc" } })).filter((entry) =>
          matchingIds.has(entry.linkId),
        )
      : [];
  const history = matchingHistory.slice(
    query.offset,
    query.offset + query.limit,
  );
  const historyIds = new Set(history.map((entry) => entry.linkId));
  const links =
    query.view === "history"
      ? matches.filter((link) => historyIds.has(link.id))
      : matches.slice(query.offset, query.offset + query.limit);
  const ids = new Set(links.map((link) => link.id));
  return {
    links,
    occurrences: allOccurrences.filter((entry) => ids.has(entry.linkId)),
    history,
    total: query.view === "history" ? matchingHistory.length : matches.length,
    settings,
    worker,
    scheduled: scheduled.some((task) => task.name === TASK),
    nextRunAt: scheduled.find((task) => task.name === TASK)?.nextRunAt
      ? Date.parse(
          scheduled.find((task) => task.name === TASK)?.nextRunAt ?? "",
        )
      : null,
    pendingCommands: commands.length,
    canManage: (context.user?.role ?? 0) >= 50,
    summary: {
      attention: active.filter((link) => link.lastCheck?.kind === "broken")
        .length,
      archives: active.filter((link) => link.replacement?.kind === "archive")
        .length,
      reviews: active.filter(
        (link) => link.review !== null && link.review.dueAt <= now,
      ).length,
      unverifiable: active.filter(
        (link) => link.lastCheck?.kind === "unverifiable",
      ).length,
    },
  };
}

/** Public output contains only destinations already exposed by the published page. */
export async function pageProjection(
  store: RelinkStore,
  context: Pick<PluginContext, "content">,
  options: ResolvedOptions,
  pathname: string,
): Promise<{ rules: Array<[string, string]> }> {
  const settings = await store.settings();
  if (!context.content) return { rules: [] };
  if (!settings.enabled) return { rules: [] };
  const candidates = await Promise.all(
    options.sources.map(async (source) => {
      const pages = await Promise.all(
        indexedPaths(pathname, source).map((pagePath) =>
          store.occurrences.all({
            where: { pagePath, collection: source.collection },
          }),
        ),
      );
      return pages.flat();
    }),
  );
  const occurrences = [
    ...new Map(candidates.flat().map((entry) => [entry.id, entry])).values(),
  ];
  const verified = new Set<string>();
  const documents = new Set<string>();
  for (const occurrence of occurrences) {
    const key = `${occurrence.collection}/${occurrence.contentId}`;
    if (documents.has(key)) continue;
    documents.add(key);
    const source = options.sources.find(
      (entry) => entry.collection === occurrence.collection,
    );
    if (!source) continue;
    const content = await context.content.get(
      occurrence.collection,
      occurrence.contentId,
    );
    if (!content || content.status !== "published") continue;
    const live = await extractOccurrences(
      {
        id: content.id,
        slug: content.slug ?? content.id,
        locale: content.locale ?? "en",
        title: "",
        data: content.data,
      },
      source,
      options.siteUrl,
      "projection",
    );
    for (const entry of live)
      if (indexedPaths(pathname, source).includes(entry.pagePath))
        verified.add(entry.id);
  }
  const rules: Array<[string, string]> = [];
  for (const occurrence of occurrences) {
    if (!verified.has(occurrence.id)) continue;
    const link = await store.links.get(occurrence.linkId);
    if (!link) continue;
    const destination = effectiveDestination(
      link,
      occurrence.originalUrl,
      settings,
    );
    if (destination !== occurrence.originalUrl && isPublicUrl(destination))
      rules.push([occurrence.originalUrl, destination]);
  }
  return { rules };
}

export function createPlugin(rawOptions: unknown): ResolvedPlugin {
  const options = optionsSchema.parse(rawOptions);
  const store = (ctx: PluginContext): RelinkStore =>
    new RelinkStore(ctx, options.settings);
  const changed = async (
    _event: unknown,
    ctx: PluginContext,
  ): Promise<void> => {
    await ensureScheduled(ctx);
    await enqueue(store(ctx), { action: "scan" });
  };
  return definePlugin({
    id: "relink",
    version: "0.2.2",
    capabilities: ["content:read", "network:request:unrestricted"],
    storage: storageDefinition,
    admin: adminConfiguration,
    hooks: {
      "plugin:install": async (_event, ctx) => {
        await ensureScheduled(ctx);
      },
      "plugin:activate": async (_event, ctx) => {
        await ensureScheduled(ctx);
      },
      "plugin:deactivate": async (_event, ctx) => {
        await ctx.cron?.cancel(TASK);
      },
      "content:afterPublish": changed,
      "content:afterSave": changed,
      "content:afterUnpublish": changed,
      "content:afterDelete": changed,
      cron: {
        timeout: 540000,
        handler: async (event, ctx) => {
          if (!ctx.content || !ctx.http)
            throw new Error("Relink requires content and network access");
          if (event.name === TASK)
            await new RelinkEngine({
              store: store(ctx),
              content: ctx.content,
              transport: ctx.http,
              options,
            }).tick();
        },
      },
    },
    routes: {
      snapshot: {
        permission: "content:read",
        handler: async (ctx) => {
          requireMethod(ctx.request, "GET");
          return adminSnapshot(store(ctx), ctx);
        },
      },
      detail: {
        permission: "content:read",
        handler: async (ctx) => {
          requireMethod(ctx.request, "GET");
          const id = z
            .string()
            .min(1)
            .max(100)
            .parse(new URL(ctx.request.url).searchParams.get("id"));
          const storage = store(ctx);
          return {
            link: await storage.links.get(id),
            occurrences: await storage.occurrences.all({
              where: { linkId: id },
            }),
            history: (
              await storage.history.page({
                where: { linkId: id },
                orderBy: { at: "desc" },
                limit: 100,
              })
            ).items,
          };
        },
      },
      commands: {
        handler: async (ctx) => {
          requireMethod(ctx.request, "POST");
          const input = commandInputSchema.parse(ctx.input);
          await ensureScheduled(ctx);
          return { queued: await enqueue(store(ctx), input) };
        },
      },
      projection: {
        public: true,
        cacheControl: "no-store",
        handler: async (ctx) => {
          requireMethod(ctx.request, "GET");
          const path = z
            .string()
            .startsWith("/")
            .max(2000)
            .parse(new URL(ctx.request.url).searchParams.get("path"));
          return pageProjection(store(ctx), ctx, options, path);
        },
      },
    },
  });
}

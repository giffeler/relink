import { afterEach, describe, expect, it, vi } from "vitest";
import { RelinkEngine, newLink } from "../src/core/engine.js";
import { LinkChecker } from "../src/core/http.js";
import { DAY, defaultSettings } from "../src/core/schema.js";
import type { ReplacementRule } from "../src/core/schema.js";
import { RelinkStore } from "../src/core/storage.js";
import { adminSnapshot, pageProjection } from "../src/plugin.js";
import {
  contentAccess,
  createTestStore,
  document,
  NOW,
  options,
  response,
} from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const result = await createTestStore();
  cleanups.push(() => result.db.destroy());
  return result;
}
const archiveRule: ReplacementRule = {
  kind: "archive",
  url: "https://web.archive.org/web/20200101000000/https://external.example/article",
  verifiedAt: NOW,
  snapshotAt: Date.parse("2020-01-01"),
  reason: "confirmed-failures",
  fragments: [""],
  evidence: null,
};

describe("persistent link maintenance on Node SQLite", () => {
  it("returns the links belonging to each history page, including legacy events without URLs", async () => {
    const { store } = await fixture();
    const first = newLink("a", "https://first.example/", NOW);
    const second = newLink("b", "https://second.example/", NOW + DAY);
    await store.links.put(first.id, first);
    await store.links.put(second.id, second);
    for (const [id, linkId, at] of [
      ["old", "a", NOW],
      ["new", "b", NOW + 1],
    ] as const) {
      await store.history.put(id, {
        schemaVersion: 1,
        id,
        linkId,
        at,
        event: "checked",
        result: null,
        destination: null,
        replacement: null,
      });
    }
    for (const [offset, expected] of [
      [0, second],
      [1, first],
    ] as const) {
      const snapshot = await adminSnapshot(store, {
        request: new Request(
          `https://site.example/?view=history&limit=1&offset=${offset}`,
        ),
      });
      expect(snapshot.total).toBe(2);
      expect(snapshot.history[0]?.linkId).toBe(expected.id);
      expect(snapshot.links.map((link) => link.url)).toEqual([expected.url]);
    }
  });
  it("scans published content only, shares identical targets, resumes batches, and sweeps removed occurrences", async () => {
    const { store } = await fixture();
    const items = Array.from({ length: 12 }, (_, index) =>
      document(undefined, `post-${index}`),
    );
    items.push({ ...document(undefined, "draft"), status: "draft" });
    const fetch = vi.fn(async () => response());
    const before = JSON.stringify(items);
    const engine = new RelinkEngine({
      store,
      content: contentAccess(items),
      transport: { fetch },
      options,
      clock: () => NOW,
    });
    await engine.tick();
    expect((await store.state()).scan?.cursor).toBe("10");
    await engine.tick();
    expect((await store.state()).scan).toBeNull();
    expect(await store.links.all()).toHaveLength(1);
    expect(await store.occurrences.all()).toHaveLength(12);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(items)).toBe(before);
    items.splice(0);
    await store.commands.put("scan", {
      id: "scan",
      createdAt: NOW,
      input: { action: "scan" },
    });
    await engine.tick();
    expect(await store.occurrences.all()).toHaveLength(0);
    expect((await store.links.all())[0]?.active).toBe(false);
  });
  it("retries at 24h and 72h, archives only after three failures, then restores after two successes 24h apart", async () => {
    const { store } = await fixture();
    let now = NOW;
    let status = 404;
    const transport = {
      fetch: async (url: string) =>
        response(
          url.startsWith("https://web.archive.org") ? 200 : status,
          undefined,
          url,
        ),
    };
    const archive = {
      discover: vi.fn(
        async () => ({ kind: "found", replacement: archiveRule }) as const,
      ),
    };
    const engine = new RelinkEngine({
      store,
      content: contentAccess([]),
      transport,
      options,
      clock: () => now,
      archive,
    });
    const checker = new LinkChecker(transport, defaultSettings, () => now);
    const link = newLink("l", "https://external.example/article", now);
    await engine.checkLink(link, defaultSettings, checker);
    expect(link.failures).toBe(1);
    expect(link.nextCheckAt).toBe(NOW + DAY);
    await engine.checkLink(link, defaultSettings, checker);
    expect(link.failures).toBe(1);
    now += DAY;
    await engine.checkLink(link, defaultSettings, checker);
    expect(link.nextCheckAt).toBe(NOW + 3 * DAY);
    expect(archive.discover).not.toHaveBeenCalled();
    now += 2 * DAY;
    await engine.checkLink(link, defaultSettings, checker);
    expect(link.replacement?.kind).toBe("archive");
    expect(link.review?.dueAt).toBe(now + 7 * DAY);
    status = 200;
    now += DAY;
    await engine.checkLink(link, defaultSettings, checker);
    expect(link.replacement).not.toBeNull();
    await engine.checkLink(link, defaultSettings, checker);
    expect(link.replacement).not.toBeNull();
    now += DAY;
    await engine.checkLink(link, defaultSettings, checker);
    expect(link.replacement).toBeNull();
    expect(
      (await store.history.all()).some(
        (entry) =>
          entry.event === "archive-applied" &&
          entry.replacement?.kind === "archive",
      ),
    ).toBe(true);
  });
  it("does not count local outages or authentication failures as broken", async () => {
    const { store } = await fixture();
    for (const status of [0, 401, 403, 429, 503]) {
      const transport = {
        fetch: async () => {
          if (!status) throw new Error("timeout");
          return response(status);
        },
      };
      const engine = new RelinkEngine({
        store,
        content: contentAccess([]),
        transport,
        options,
        clock: () => NOW,
      });
      const link = newLink(
        `l-${status}`,
        "https://external.example/article",
        NOW,
      );
      await engine.checkLink(
        link,
        defaultSettings,
        new LinkChecker(transport, defaultSettings),
      );
      expect(link.failures).toBe(0);
      expect(link.replacement).toBeNull();
      expect(link.lastCheck?.kind).toBe("unverifiable");
    }
  });
  it("keeps undo exceptions through restart and leaves source content unchanged", async () => {
    const { store, context } = await fixture();
    const items = [document()];
    const before = JSON.stringify(items);
    const transport = { fetch: async () => response(404) };
    const engine = new RelinkEngine({
      store,
      content: contentAccess(items),
      transport,
      options,
      clock: () => NOW,
    });
    await engine.tick();
    const link = (await store.links.all())[0];
    if (!link) throw new Error("Missing link");
    link.replacement = archiveRule;
    await store.links.put(link.id, link);
    await store.commands.put("undo", {
      id: "undo",
      createdAt: NOW,
      input: { action: "undo", linkId: link.id },
    });
    await engine.tick();
    const restartedStore = new RelinkStore(context, defaultSettings);
    const restarted = await restartedStore.links.get(link.id);
    expect(restarted?.automaticDisabled).toBe(true);
    expect(restarted?.replacement).toBeNull();
    expect(JSON.stringify(items)).toBe(before);
    expect(await restartedStore.commands.all()).toHaveLength(0);
  });
  it.each([
    ["missing", 30],
    ["unavailable", 1],
  ] as const)(
    "retries archive discovery after %s on its own schedule",
    async (kind, days) => {
      const { store } = await fixture();
      const transport = { fetch: async () => response(404) };
      const engine = new RelinkEngine({
        store,
        content: contentAccess([]),
        transport,
        options,
        clock: () => NOW,
        archive: { discover: async () => ({ kind }) },
      });
      const link = newLink("l", "https://external.example/article", NOW);
      link.failures = 2;
      link.firstFailureAt = NOW - 3 * DAY;
      await engine.checkLink(
        link,
        defaultSettings,
        new LinkChecker(transport, defaultSettings),
      );
      expect(link.replacement).toBeNull();
      expect(link.archiveRetryAt).toBe(NOW + days * DAY);
    },
  );
  it("reverts an unavailable Grokipedia target to the reachable original", async () => {
    const { store } = await fixture();
    const transport = {
      fetch: async (url: string) =>
        response(url.includes("grokipedia") ? 404 : 200, undefined, url),
    };
    const engine = new RelinkEngine({
      store,
      content: contentAccess([]),
      transport,
      options,
      clock: () => NOW,
    });
    const link = newLink("l", "https://en.wikipedia.org/wiki/Example", NOW);
    link.replacement = {
      kind: "grokipedia",
      url: "https://grokipedia.com/page/Example",
      verifiedAt: NOW,
      reason: "identity-language-match",
      fragments: [""],
      evidence: {
        title: "Example",
        language: "en",
        canonical: "https://grokipedia.com/page/Example",
        introduction: "",
        anchors: [],
        sourceUrls: [],
        disambiguation: false,
      },
    };
    await engine.checkLink(
      link,
      { ...defaultSettings, grokipediaEnabled: true },
      new LinkChecker(transport, defaultSettings),
    );
    expect(link.replacement).toBeNull();
  });
  it.each(["/post-1", "/posts/post-1", "/post-1/"])(
    "exposes replacements only for the current published occurrence at %s",
    async (pathname) => {
      const { store } = await fixture();
      const items = [document()];
      const content = contentAccess(items);
      const aliasOptions = {
        ...options,
        sources: options.sources.map((source) => ({
          ...source,
          pathAliases: ["/posts/{slug}", "/{slug}/"],
        })),
      };
      await new RelinkEngine({
        store,
        content,
        transport: { fetch: async () => response() },
        options,
        clock: () => NOW,
      }).tick();
      const link = (await store.links.all())[0];
      if (!link) throw new Error("Missing link");
      link.replacement = archiveRule;
      await store.links.put(link.id, link);
      expect(
        (await pageProjection(store, { content }, aliasOptions, pathname))
          .rules,
      ).toHaveLength(1);
      const item = items[0];
      if (!item) throw new Error("Missing item");
      item.status = "draft";
      expect(
        (await pageProjection(store, { content }, aliasOptions, pathname))
          .rules,
      ).toHaveLength(0);
      item.status = "published";
      item.data = { website: "https://different.example" };
      expect(
        (await pageProjection(store, { content }, aliasOptions, pathname))
          .rules,
      ).toHaveLength(0);
    },
  );
  it("fails closed on corrupt persisted records", async () => {
    const { store, context } = await fixture();
    await context.storage["links"]?.put("bad", { schemaVersion: 100 });
    await expect(store.links.get("bad")).rejects.toThrow();
  });
});

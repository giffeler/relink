import { Kysely, sql } from "kysely";
import type { Dialect } from "kysely";
import { createDialect } from "emdash/db/sqlite";
import { OptionsRepository, PluginStorageRepository } from "emdash";
import type {
  ContentAccess,
  Database,
  KVAccess,
  PluginContext,
  StorageCollection,
} from "emdash";
import { defaultSettings, optionsSchema } from "../src/core/schema.js";
import { RelinkStore, storageDefinition } from "../src/core/storage.js";

export const options = optionsSchema.parse({
  siteUrl: "https://site.example",
  sources: [{ collection: "posts", urlFields: ["website", "content[].url"] }],
});
export const NOW = Date.parse("2026-09-10T12:00:00Z");
export type FixtureContent = NonNullable<
  Awaited<ReturnType<ContentAccess["get"]>>
>;
export function html(
  title = "Example article",
  language = "en",
  canonical = "https://external.example/article",
  fragment = "History",
): string {
  return `<!doctype html><html lang="${language}"><head><title>${title}</title><link rel="canonical" href="${canonical}"></head><body><main><h1>${title}</h1><p>Astronomy explores planetary systems through scientific observations, providing detailed evidence about celestial objects, gravitational interactions and historical discoveries.</p><h2 id="${fragment}">History</h2><a href="https://en.wikipedia.org/wiki/Example_article">Reference</a></main></body></html>`;
}
export function response(
  status = 200,
  body = html(),
  url = "https://external.example/article",
  headers: Record<string, string> = {},
): Response {
  const result = new Response(status === 204 ? null : body, {
    status,
    headers: { "content-type": "text/html", ...headers },
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
export function document(
  data: Record<string, unknown> = {
    website: "https://external.example/article",
  },
  id = "post-1",
): FixtureContent {
  return {
    id,
    type: "posts",
    slug: id,
    status: "published",
    locale: "en",
    data,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    publishedAt: new Date(NOW).toISOString(),
  };
}
export function contentAccess(items: FixtureContent[]): ContentAccess {
  return {
    get: async (_collection, id) =>
      items.find((item) => item.id === id) ?? null,
    list: async (_collection, query) => {
      const offset = Number(query?.cursor ?? 0);
      const limit = query?.limit ?? 100;
      const selected = items.filter((item) => item.status === "published");
      return {
        items: selected.slice(offset, offset + limit),
        hasMore: selected.length > offset + limit,
        ...(selected.length > offset + limit
          ? { cursor: String(offset + limit) }
          : {}),
      };
    },
  };
}
export async function createTestStore(
  dialect: Dialect = createDialect({ url: ":memory:" }),
): Promise<{
  db: Kysely<Database>;
  store: RelinkStore;
  context: Pick<PluginContext, "storage" | "kv">;
}> {
  const db = new Kysely<Database>({ dialect });
  await sql`CREATE TABLE IF NOT EXISTS _plugin_storage (plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(plugin_id, collection, id))`.execute(
    db,
  );
  await sql`CREATE TABLE IF NOT EXISTS options (name TEXT PRIMARY KEY, value TEXT NOT NULL, revision TEXT NOT NULL)`.execute(
    db,
  );
  await sql`CREATE TABLE IF NOT EXISTS _emdash_cron_tasks (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, task_name TEXT NOT NULL, schedule TEXT NOT NULL, is_oneshot INTEGER NOT NULL DEFAULT 0, data TEXT, next_run_at TEXT NOT NULL, last_run_at TEXT, status TEXT NOT NULL DEFAULT 'idle', locked_at TEXT, enabled INTEGER NOT NULL DEFAULT 1, UNIQUE(plugin_id, task_name))`.execute(
    db,
  );
  const repository = new OptionsRepository(db);
  const kv: KVAccess = {
    get: async <T>(key: string): Promise<T | null> =>
      repository.get<T>(`plugin:relink:${key}`),
    getVersioned: async <T>(key: string) =>
      repository.getVersioned<T>(`plugin:relink:${key}`),
    set: async (key, value) => repository.set(`plugin:relink:${key}`, value),
    compareAndSet: async (key, expectedRevision, value) =>
      repository.compareAndSet(
        `plugin:relink:${key}`,
        expectedRevision,
        value,
      ),
    delete: async (key) => repository.delete(`plugin:relink:${key}`),
    compareAndDelete: async (key, expectedRevision) =>
      repository.compareAndDelete(`plugin:relink:${key}`, expectedRevision),
    list: async (prefix = "") =>
      [...(await repository.getByPrefix(`plugin:relink:${prefix}`))].map(
        ([key, value]) => ({ key, value }),
      ),
  };
  const storage: Record<string, StorageCollection> = {};
  for (const [name, declaration] of Object.entries(storageDefinition))
    storage[name] = new PluginStorageRepository(
      db,
      "relink",
      name,
      declaration.indexes,
    );
  const context = { storage, kv };
  return { db, context, store: new RelinkStore(context, defaultSettings) };
}

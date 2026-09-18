import { Kysely, sql } from "kysely";
import { createDialect } from "emdash/db/sqlite";
import { ContentRepository, PluginStorageRepository } from "emdash";
import {
  extractOccurrences,
  linkSchema,
  newLink,
  optionsSchema,
} from "../dist/core/index.js";
import { resolve } from "node:path";

const db = new Kysely({
  dialect: createDialect({
    url: resolve(import.meta.dirname, "../work/package-site/data.db"),
  }),
});
try {
  // The package test has already exercised the real scheduler. Keep it from
  // racing deterministic browser fixtures in this disposable local database.
  await sql`UPDATE _emdash_cron_tasks SET enabled = 0 WHERE plugin_id = 'relink'`.execute(
    db,
  );
  const options = optionsSchema.parse({
    siteUrl: "http://localhost:4321",
    sources: [
      { collection: "posts", path: "/posts/{slug}", urlFields: ["website"] },
    ],
  });
  const content = await new ContentRepository(db).findMany("posts", {
    where: { status: "published" },
  });
  const links = new PluginStorageRepository(db, "relink", "links", []);
  const occurrences = new PluginStorageRepository(
    db,
    "relink",
    "occurrences",
    [],
  );
  for (const item of content.items) {
    const entries = await extractOccurrences(
      {
        id: item.id,
        slug: item.slug ?? item.id,
        locale: item.locale ?? "en",
        title: "Links in published content",
        data: item.data,
      },
      options.sources[0],
      options.siteUrl,
      "browser-fixture",
    );
    for (const entry of entries) {
      await links.put(
        entry.linkId,
        linkSchema.parse(
          newLink(entry.linkId, new URL(entry.originalUrl).href, Date.now()),
        ),
      );
      await occurrences.put(entry.id, entry);
    }
  }
} finally {
  await db.destroy();
}

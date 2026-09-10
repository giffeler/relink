import { describe, expect, it, vi } from "vitest";
import { sql } from "kysely";
import { CronAccessImpl, CronExecutor } from "emdash-test-cron";
import { Miniflare } from "miniflare";
import { createDialect } from "@emdash-cms/cloudflare/db/d1";
import { env } from "./cloudflare-env.js";
import { RelinkEngine } from "../src/core/engine.js";
import { RelinkStore } from "../src/core/storage.js";
import { defaultSettings } from "../src/core/schema.js";
import { ensureScheduled } from "../src/plugin.js";
import {
  contentAccess,
  createTestStore,
  document,
  NOW,
  options,
  response,
} from "./helpers.js";

describe.each(["sqlite", "d1"] as const)(
  "EmDash persistence and cron on %s",
  (platform) => {
    it("claims duplicate jobs once, recovers crashed work and retains settings across engine instances", async () => {
      const runtime =
        platform === "d1"
          ? new Miniflare({
              modules: true,
              script:
                'export default { fetch() { return new Response("D1 fixture"); } };',
              compatibilityDate: "2026-07-30",
              d1Databases: ["DB"],
            })
          : null;
      if (runtime) env["DB"] = await runtime.getD1Database("DB");
      const fixture = await createTestStore(
        runtime
          ? createDialect({ binding: "DB", session: "disabled" })
          : undefined,
      );
      try {
        const cron = new CronAccessImpl(fixture.db, "relink", () => undefined);
        await ensureScheduled({ cron });
        await ensureScheduled({ cron });
        expect(await cron.list()).toHaveLength(1);
        await sql`UPDATE _emdash_cron_tasks SET next_run_at = '2020-01-01T00:00:00Z'`.execute(
          fixture.db,
        );
        const engine = new RelinkEngine({
          store: fixture.store,
          content: contentAccess([document()]),
          transport: { fetch: async () => response() },
          options,
          clock: () => NOW,
        });
        const invoke = vi.fn(async () => engine.tick());
        const first = new CronExecutor(fixture.db, invoke);
        const second = new CronExecutor(fixture.db, invoke);
        await Promise.all([first.tick(), second.tick()]);
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(await fixture.store.links.all()).toHaveLength(1);
        await sql`UPDATE _emdash_cron_tasks SET status = 'running', locked_at = '2020-01-01T00:00:00Z', next_run_at = '2020-01-01T00:00:00Z'`.execute(
          fixture.db,
        );
        expect(await second.recoverStaleLocks()).toBe(1);
        await second.tick();
        expect(invoke).toHaveBeenCalledTimes(2);
        await fixture.store.saveSettings({
          ...defaultSettings,
          direction: "rtl",
        });
        expect(
          (await new RelinkStore(fixture.context, defaultSettings).settings())
            .direction,
        ).toBe("rtl");
        expect((await fixture.store.state()).lastCompletedAt).toBe(NOW);
      } finally {
        await fixture.db.destroy();
        await runtime?.dispose();
        delete env["DB"];
      }
    });
  },
);

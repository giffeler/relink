/** Test-only access to the pinned host's scheduler, never shipped in the plugin. */
declare module "emdash-test-cron" {
  import type { Kysely } from "kysely";
  import type { Database, ResolvedPlugin } from "emdash";
  type CronEvent = Parameters<
    NonNullable<ResolvedPlugin["hooks"]["cron"]>["handler"]
  >[0];
  export class CronExecutor {
    constructor(
      db: Kysely<Database>,
      invoke: (pluginId: string, event: CronEvent) => Promise<void>,
    );
    tick(): Promise<number>;
    recoverStaleLocks(): Promise<number>;
  }
  export class CronAccessImpl {
    constructor(db: Kysely<Database>, pluginId: string, reschedule: () => void);
    schedule(
      name: string,
      opts: { schedule: string; data?: Record<string, unknown> },
    ): Promise<void>;
    cancel(name: string): Promise<void>;
    list(): Promise<
      Array<{
        name: string;
        schedule: string;
        nextRunAt: string;
        lastRunAt: string | null;
      }>
    >;
  }
}

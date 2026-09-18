import type { PluginContext } from "emdash";
import type { ResolvedOptions } from "./core/schema.js";

export type LogFields = Record<string, string | number | boolean | null>;
export interface MaintenanceLog extends LogFields {
  component: "relink";
  version: string;
  timestamp: string;
  site: string;
  runId: string;
  event: string;
}

/** Exclude messages and stacks: upstream errors may contain URLs or content. */
export function errorFields(error: unknown): LogFields {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  return {
    errorType: /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(name) ? name : "Error",
    errorCode: code && /^[A-Z0-9_]{1,64}$/u.test(code) ? code : null,
  };
}

export function maintenanceLogger(
  host: PluginContext["log"],
  options: ResolvedOptions,
): (record: MaintenanceLog) => Promise<void> {
  return async (record) => {
    const line = JSON.stringify(record);
    try {
      if (record.event.endsWith(".failed")) host.error(line);
      else host.info(line);
    } catch {
      // A host logger must not interrupt maintenance or the optional file sink.
    }
    if (!options.logFile) return;
    try {
      const { appendLog } = await import("./node-log.js");
      await appendLog(options.logFile, line);
    } catch (error) {
      try {
        host.error(
          JSON.stringify({
            component: "relink",
            timestamp: record.timestamp,
            site: record.site,
            runId: record.runId,
            event: "log.write.failed",
            ...errorFields(error),
          }),
        );
      } catch {
        // Maintenance remains available even when both log destinations fail.
      }
    }
  };
}

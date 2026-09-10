import type { PluginDescriptor } from "emdash";
import { optionsSchema } from "./core/schema.js";
import type { RelinkOptions, ResolvedOptions } from "./core/schema.js";
import { adminConfiguration } from "./metadata.js";

/** Register in emdash({ plugins: [relink(options)] }). */
export function relink(
  options: RelinkOptions,
): PluginDescriptor<ResolvedOptions> {
  return {
    id: "relink",
    version: "0.2.0",
    format: "native",
    entrypoint: "emdash-plugin-relink/runtime",
    options: optionsSchema.parse(options),
    adminEntry: adminConfiguration.entry,
    adminPages: adminConfiguration.pages,
    adminWidgets: adminConfiguration.widgets,
  };
}
export type {
  RelinkOptions,
  ResolvedOptions,
  Settings,
  LinkRecord,
  LinkOccurrence,
  CheckResult,
  ReplacementRule,
  ReviewTask,
  TextDirection,
  CollectionSource,
  HistoryEntry,
} from "./core/schema.js";
export type { ContentDocument } from "./core/extract.js";
export type {
  ArchiveProvider,
  EncyclopediaProvider,
  DiscoveryResult,
} from "./core/providers.js";

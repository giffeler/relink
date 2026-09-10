import { z } from "zod";
import {
  historySchema,
  linkSchema,
  occurrenceSchema,
  settingsSchema,
  stateSchema,
} from "./schema.js";
import type { LinkRecord, Settings } from "./schema.js";
import { domainExcluded } from "./url.js";

export const viewSchema = z.enum([
  "all",
  "problems",
  "archives",
  "reviews",
  "grokipedia",
  "history",
]);
export const listQuerySchema = z.object({
  view: viewSchema.default("all"),
  search: z.string().max(500).default(""),
  domain: z.string().max(253).default(""),
  collection: z.string().max(100).default(""),
  contentId: z.string().max(100).default(""),
  language: z.string().max(30).default(""),
  state: z
    .enum(["", "pending", "healthy", "broken", "unverifiable", "excluded"])
    .default(""),
  reviewBefore: z.coerce.number().nonnegative().optional(),
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export const summarySchema = z.object({
  attention: z.number(),
  archives: z.number(),
  reviews: z.number(),
  unverifiable: z.number(),
});
export const snapshotSchema = z.object({
  links: z.array(linkSchema),
  occurrences: z.array(occurrenceSchema),
  history: z.array(historySchema),
  total: z.number(),
  summary: summarySchema,
  settings: settingsSchema,
  worker: stateSchema,
  scheduled: z.boolean(),
  nextRunAt: z.number().nullable(),
  pendingCommands: z.number(),
  canManage: z.boolean(),
});
export type AdminSnapshot = z.infer<typeof snapshotSchema>;
export const detailSchema = z.object({
  link: linkSchema.nullable(),
  occurrences: z.array(occurrenceSchema),
  history: z.array(historySchema),
});
export type LinkDetail = z.infer<typeof detailSchema>;
export const projectionSchema = z.object({
  rules: z.array(z.tuple([z.url(), z.url()])),
});

export function effectiveDestination(
  link: LinkRecord,
  original: string,
  settings: Settings,
): string {
  const rule = link.replacement;
  if (
    !rule ||
    !settings.enabled ||
    link.excluded ||
    !link.active ||
    domainExcluded(link.host, settings.excludedDomains)
  )
    return original;
  if (rule.kind === "archive" && !settings.archiveEnabled) return original;
  if (rule.kind === "grokipedia" && !settings.grokipediaEnabled)
    return original;
  if (rule.kind === "manual") return rule.url;
  if (!rule.fragments.includes(new URL(original).hash)) return original;
  return `${rule.url}${new URL(original).hash}`;
}

/** Spreadsheet applications must not interpret URL or editor text as formulas. */
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

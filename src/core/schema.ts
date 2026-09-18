import { z } from "zod";

export const timestamp = z.number().int().nonnegative();
export const httpUrl = z
  .url()
  .refine((value) => /^https?:\/\//u.test(value), "HTTP(S) URL required");
export const directionSchema = z.enum(["auto", "ltr", "rtl"]);
export const settingsSchema = z.object({
  enabled: z.boolean().default(true),
  archiveEnabled: z.boolean().default(true),
  grokipediaEnabled: z.boolean().default(false),
  direction: directionSchema.default("auto"),
  healthyDays: z.number().int().min(1).max(365).default(7),
  reviewDays: z.number().int().min(1).max(90).default(7),
  archiveRetryDays: z.number().int().min(1).max(365).default(30),
  timeoutMs: z.number().int().min(1000).max(10000).default(10000),
  batchSize: z.number().int().min(1).max(4).default(4),
  excludedDomains: z.array(z.string().min(1).max(253)).max(200).default([]),
});
export type Settings = z.infer<typeof settingsSchema>;
export type TextDirection = z.infer<typeof directionSchema>;
export const defaultSettings: Settings = settingsSchema.parse({});

export const evidenceSchema = z.object({
  title: z.string(),
  language: z.string(),
  canonical: z.string(),
  introduction: z.string().max(2000),
  anchors: z.array(z.string()).max(2000),
  sourceUrls: z.array(z.string()).max(200),
  disambiguation: z.boolean(),
});
export type PageEvidence = z.infer<typeof evidenceSchema>;
const checked = { checkedAt: timestamp, finalUrl: httpUrl };
export const checkResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("healthy"),
    ...checked,
    status: z.number().int(),
    contentType: z.string(),
    evidence: evidenceSchema.nullable(),
  }),
  z.object({
    kind: z.literal("broken"),
    ...checked,
    status: z.number().int().nullable(),
    reason: z.enum([
      "not-found",
      "server-error",
      "dns",
      "timeout",
      "connection",
      "redirect-loop",
    ]),
  }),
  z.object({
    kind: z.literal("unverifiable"),
    ...checked,
    status: z.number().int().nullable(),
    reason: z.enum([
      "authentication",
      "blocked",
      "rate-limited",
      "unsafe-url",
      "soft-error",
      "network-outage",
      "unsupported-response",
      "response-too-large",
    ]),
    retryAt: timestamp.nullable(),
  }),
]);
export type CheckResult = z.infer<typeof checkResultSchema>;
export const replacementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("archive"),
    url: httpUrl,
    verifiedAt: timestamp,
    snapshotAt: timestamp,
    reason: z.literal("confirmed-failures"),
    fragments: z.array(z.string()),
    evidence: evidenceSchema.nullable(),
  }),
  z.object({
    kind: z.literal("grokipedia"),
    url: httpUrl,
    verifiedAt: timestamp,
    reason: z.literal("identity-language-match"),
    fragments: z.array(z.string()),
    evidence: evidenceSchema,
  }),
  z.object({
    kind: z.literal("manual"),
    url: httpUrl,
    verifiedAt: timestamp,
    reason: z.literal("editor-override"),
  }),
]);
export type ReplacementRule = z.infer<typeof replacementSchema>;
export const reviewReasonSchema = z.enum([
  "archive-active",
  "archive-missing",
  "archive-unavailable",
  "grokipedia-ambiguous",
  "replacement-failed",
  "unverifiable",
  "manual-review",
]);
export const reviewSchema = z.object({
  dueAt: timestamp,
  reason: reviewReasonSchema,
});
export type ReviewTask = z.infer<typeof reviewSchema>;
export const linkSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  url: httpUrl,
  host: z.string(),
  createdAt: timestamp,
  updatedAt: timestamp,
  nextCheckAt: timestamp,
  firstFailureAt: timestamp.nullable(),
  lastFailureAt: timestamp.nullable(),
  failures: z.number().int().nonnegative(),
  recoveryAt: timestamp.nullable(),
  lastCheck: checkResultSchema.nullable(),
  replacement: replacementSchema.nullable(),
  review: reviewSchema.nullable(),
  excluded: z.boolean(),
  automaticDisabled: z.boolean(),
  active: z.boolean(),
  archiveRetryAt: timestamp.nullable(),
  grokipediaChecked: z.boolean(),
});
export type LinkRecord = z.infer<typeof linkSchema>;
export const occurrenceSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  linkId: z.string(),
  originalUrl: httpUrl,
  collection: z.string(),
  contentId: z.string(),
  slug: z.string(),
  locale: z.string(),
  title: z.string(),
  path: z.string(),
  text: z.string(),
  pagePath: z.string(),
  generation: z.string(),
});
export type LinkOccurrence = z.infer<typeof occurrenceSchema>;
export const historySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  linkId: z.string(),
  originalUrl: httpUrl.optional(),
  at: timestamp,
  event: z.enum([
    "checked",
    "archive-applied",
    "grokipedia-applied",
    "original-restored",
    "replacement-unavailable",
    "excluded",
    "included",
    "override",
    "undo",
    "rescheduled",
  ]),
  result: checkResultSchema.nullable(),
  destination: z.string().nullable(),
  replacement: replacementSchema.nullable(),
});
export type HistoryEntry = z.infer<typeof historySchema>;

export const collectionSourceSchema = z.object({
  collection: z.string().regex(/^[a-z][a-z0-9_]*$/u),
  portableTextFields: z.array(z.string()).default(["content"]),
  urlFields: z.array(z.string()).default([]),
  path: z.string().startsWith("/").default("/{slug}"),
  pathAliases: z.array(z.string().startsWith("/")).max(20).default([]),
});
export const optionsSchema = z.object({
  siteUrl: httpUrl,
  logFile: z.string().min(1).max(4096).startsWith("/").optional(),
  sources: z.array(collectionSourceSchema).min(1),
  settings: settingsSchema.default(defaultSettings),
  networkProbeUrls: z
    .array(httpUrl)
    .length(2)
    .default([
      "https://www.cloudflare.com/cdn-cgi/trace",
      "https://www.wikipedia.org/",
    ]),
});
export type RelinkOptions = z.input<typeof optionsSchema>;
export type ResolvedOptions = z.infer<typeof optionsSchema>;
export type CollectionSource = z.infer<typeof collectionSourceSchema>;

export const commandInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("scan") }),
  z.object({ action: z.literal("check"), linkId: z.string().min(1) }),
  z.object({
    action: z.literal("exclude"),
    linkId: z.string().min(1),
    value: z.boolean(),
  }),
  z.object({ action: z.literal("undo"), linkId: z.string().min(1) }),
  z.object({
    action: z.literal("destination"),
    linkId: z.string().min(1),
    url: httpUrl,
  }),
  z.object({
    action: z.literal("reschedule"),
    linkId: z.string().min(1),
    dueAt: timestamp,
  }),
  z.object({ action: z.literal("settings"), settings: settingsSchema }),
]);
export type CommandInput = z.infer<typeof commandInputSchema>;
export const commandSchema = z.object({
  id: z.string(),
  createdAt: timestamp,
  input: commandInputSchema,
});
export type Command = z.infer<typeof commandSchema>;
export const scanSchema = z.object({
  sourceIndex: z.number().int().nonnegative(),
  cursor: z.string().nullable(),
  generation: z.string(),
  startedAt: timestamp,
});
export const stateSchema = z.object({
  schemaVersion: z.literal(1),
  scan: scanSchema.nullable(),
  nextScanAt: timestamp,
  lastStartedAt: timestamp.nullable(),
  lastCompletedAt: timestamp.nullable(),
  lastError: z.enum(["storage", "content", "network"]).nullable(),
  processed: z.number().int().nonnegative(),
});
export type WorkerState = z.infer<typeof stateSchema>;
export const initialState = (): WorkerState => ({
  schemaVersion: 1,
  scan: null,
  nextScanAt: 0,
  lastStartedAt: null,
  lastCompletedAt: null,
  lastError: null,
  processed: 0,
});
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export function assertNever(value: never): never {
  throw new Error(`Unexpected state: ${String(value)}`);
}

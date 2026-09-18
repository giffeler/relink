# Validation and known limitations

## Reproducible checks

`pnpm check` runs strict TypeScript checking, typed ESLint rules, Vitest and declaration/package builds. The suite exercises HTTP status distinctions, HEAD/GET disagreement, redirects, timeouts, response limits, archive evidence/outages, Grokipedia ambiguity/language/sections, recovery intervals, duplicate targets, removed occurrences, restart state, undo exceptions, publication checks, output replacement and cache headers. Catalog tests cover regional locales, fallback and pluralization.

Maintenance-log tests verify run correlation, real SQLite processing counters, idle-run reporting, state-read/write failures, URL-query omission, unwritable file fallback, concurrent appends, restrictive permissions and 5 MiB rotation with five retained archives. Logging failures must not alter maintenance outcomes. The installed-package test also waits for a real scheduled run and validates its JSON Lines completion record.

Platform tests use the actual EmDash `PluginStorageRepository` and native Node SQLite adapter. The D1 test uses the actual EmDash D1 adapter against a local workerd D1 binding supplied by stable Miniflare 4.20260730.0. Only the binding import is substituted. Both platforms run EmDash 0.38.0's real atomic cron claim/recovery implementation. That pinned internal scheduler import is confined to tests; the shipped plugin uses only public EmDash APIs.

The workspace and isolated example pin vulnerable transitive versions of sharp to 0.35.4 and Undici 7 to 7.29.0. These patches address upstream [sharp](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c) and [Undici](https://github.com/nodejs/undici/security/advisories/GHSA-4cwx-7wf7-3272) advisories. The plugin's own runtime dependencies are parse5 and Zod; consuming sites manage their EmDash/Astro dependency updates independently.

`pnpm test:package` builds a tarball, installs it into `work/package-site` with a separate dependency boundary, seeds EmDash, builds Astro, and checks its published page and authenticated plugin API. Test-only loopback authentication is copied into this isolated fixture and is not included in the package or normal examples. `--prepare-only` prepares that site for the browser suite. Never deploy `work/package-site`.

Run `node scripts/seed-browser.mjs` after the package test to populate a deterministic pending-link index from the fixture's actual published content, then run `pnpm test:browser`. The browser suite checks native navigation, dashboard/editor extensions, English/German and regional language detection, live host language switching, unsupported-language fallback, light/dark accessibility, keyboard focus, scoped RTL, CSV downloads and authenticated routes. A separate mounted React test exercises language activation without remounting. No synthetic link-health result is seeded.

Cache integration tests use Astro's actual memory provider and simulate elapsed time: a replacement and a rollback appear after the capped 300-second lifetime even when the page asks for a 24-hour cache and stale revalidation. Browser HTTP tests inspect server HTML with no JavaScript and compare actual CMS entries and revisions before/after replacement.

`pnpm --filter relink-example-cloudflare build` validates the Cloudflare example and supported scheduled Worker entry. CI runs these checks and uploads the package artifact. It does not publish to npm, create Cloudflare resources or deploy a production site.

## Scope and limits

The browser seed disables Relink's cron task only in the disposable `work/package-site` database after the package test has verified a real scheduled run. This keeps live network results from racing the browser's deterministic fixtures. Production scheduling is unaffected.

- Only published content in configured collections/fields is indexed. Theme-only targets, JavaScript-generated links and embedded media are outside the initial scanner. Root Portable Text fields and explicit nested/wildcard URL selectors are supported.
- Path templates must match actual public URLs, including locale prefixes and trailing slashes. A slug containing path separators needs a compatible theme/template; placeholders are URL-encoded.
- Dynamic HTML is required. Previously cached content must be purged at installation, and overriding CDN policies must respect the freshness bound. See [cache operation](installation.md#cache-behaviour).
- HTTP evidence can be inconclusive. Authentication, anti-bot responses, missing metadata, oversized pages and uncertain article identity intentionally remain review items. No provider's uptime or coverage is guaranteed.
- Literal IPv6 targets and special-purpose IPv4 ranges are conservatively excluded. Normal public hostnames can resolve to IPv4 or IPv6 through EmDash's DNS-aware network guard. Self-hosted deployments retain EmDash's network-egress requirements; the plugin does not bypass that guard.
- Grokipedia matching uses visible content evidence and is intentionally conservative. It does not promise semantic equivalence across every encyclopedia article and does not translate articles or section names.
- Lists are paginated, but filtered counts and collection sweeps currently read the relevant plugin index in memory. Capacity testing is required for very large sites. The admin detail dialog shows the latest 100 events; the global History view paginates retained events. History has no automatic retention deletion.
- Notifications stay inside EmDash. No email or external messaging integration is included.
- This validation covers local Node/SQLite, local workerd/D1, built package installation and example builds. Production Cloudflare account configuration, real Cron delivery, CDN overrides and sustained load require deployment-specific checks.

English documentation is maintained alongside the code. Behavioural changes require matching tests and release notes; compatibility beyond EmDash 0.38.0 must be verified rather than assumed.

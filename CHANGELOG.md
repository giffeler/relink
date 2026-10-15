# Changelog

## Unreleased

- Record maintainer-confirmed compatibility with EmDash 1.3.0 on 2026-10-15. The existing automated matrix and package peer dependencies cover 0.38.0 through 0.42.0; this is a documentation-only update.

## 0.2.6 - 2026-09-28

- Test EmDash and matching admin packages from 0.38.0 through 0.42.0; add an explicit compatibility matrix and use 0.42.0 in development and installation fixtures.
- Use a single GET for ordinary checks and inspect complete HTML up to 2 MiB by default, with a configurable ceiling of 4 MiB. Preserve HTTP status and final URL when the body exceeds the limit.
- Persist host-wide cooldowns after HTTP 429 and HTTP 503 with `Retry-After`, including redirected destinations and archive providers. Retain prior link evidence when a scheduled check is deferred.
- Back off repeated inconclusive checks to one, three and seven days, while respecting explicit retry times and keeping blocked links out of automatic archive eligibility.
- Recognize Cloudflare challenge headers regardless of HTTP status and support a configurable crawler identity with an operator contact URL.

## 0.2.5 - 2026-09-23

- Add compatibility with EmDash and `@emdash-cms/admin` 0.39.0.
- Update the dependency and package-install test fixtures, including the patched devalue release.

## 0.2.4 — 2026-09-18

- Verify native-plugin compatibility with EmDash and `@emdash-cms/admin` 0.38.0, including SQLite/D1 persistence, scheduling, installed-package SSR and admin integration.
- Record correlated maintenance starts, completions, failure stages, scan batches, commands and link outcomes through EmDash's logger. Add optional Node JSON Lines files with size-based rotation and restricted permissions.
- Keep URL paths, query strings, article content and raw exception messages out of operational logs. Log-destination failures do not interrupt maintenance.
- Wait for all in-flight checks before reporting a failed batch; preserve the previous successful completion time and original error when persistence fails.
- Fix CI setup by reading the pnpm version from `package.json`.

## 0.2.3 — 2026-09-15

- Add compatibility with EmDash 0.38.0.

## 0.2.2 — 2026-09-10

- Show the original URL for every history event, with a keyboard-accessible action to open link details.
- Correct history pagination so legacy events receive the matching target metadata. Preserve original URLs in new history records without requiring a migration.
- Label replacement destinations separately and localize event counts in English and German.
- Prepare package metadata and installation guidance for the first npm release.

## 0.2.1 — 2026-09-10

- Support explicit content route aliases, including trailing-slash and legacy article routes, without duplicating link occurrences.
- Revalidate publication and source links when rendering through an alias.
- Update the development and isolated-install TOML dependency to the patched release.

## 0.2.0 — 2026-09-10

- Introduce the Relink Noncommercial License 1.0 for otherwise unlicensed additions and changes, with free noncommercial use and separate commercial agreements through gekko mbH.
- Preserve the original 0.1.0 MIT notice and all existing permissions in the MIT baseline. This transition does not retroactively restrict commercial use of that material.
- Add commercial-licensing guidance, a contribution-rights policy, and third-party licensing notices.
- Update release metadata to distinguish the licensing transition from the MIT release. No link-maintenance functionality changes.

## 0.1.0 — 2026-09-10

- Initial native EmDash 0.37.0 plugin and Astro output integration.
- Published-link indexing, shared checks, persistent scheduling and review history.
- Verified Wayback recovery and optional conservative Grokipedia matching.
- Manual destinations, exclusions and persistent undo exceptions.
- English/German admin pages, dashboard/editor extensions and scoped RTL settings.
- Strict TypeScript declarations, runtime validation, SQLite/D1 tests and installation examples.

This version is built and distributed from the source repository. npm publication and production deployment are separate release steps.

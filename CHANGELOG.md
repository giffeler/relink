# Changelog

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

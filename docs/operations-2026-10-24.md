# Production audit: 24 October 2026

Scope: Relink on `gpt.gekko.de` and `space.gekko.de`, inspected over SSH on `gekko`. Both hosts run EmDash 1.3.1. The initial deployed Relink version was 0.2.6.

## Initial findings

| Measurement                          |     GPT |    Space |
| ------------------------------------ | ------: | -------: |
| Published documents, including pages |     283 |      231 |
| Indexed link occurrences             |     622 |      565 |
| Active distinct external targets     |     563 |      515 |
| Healthy targets                      |     460 |      407 |
| Unverifiable targets                 |      87 |       71 |
| Broken targets                       |      16 |       37 |
| Active archive replacements          |       9 |       10 |
| Wikipedia targets                    |       6 |       18 |
| Grokipedia replacements              |       0 |        0 |
| Effective Grokipedia setting         | enabled | disabled |

Re-extraction from every published, non-deleted document matched every indexed occurrence: no missing or stale occurrences. Both SQLite databases passed `PRAGMA quick_check`, both recurring jobs were enabled and idle between minute ticks, and neither site had overdue link checks at the inspection snapshot.

Every active archive replacement was verified in a public HTTP 200 article response, using one occurrence for each replacement. All 19 target URLs appeared in rendered anchor attributes and the original anchor URL was absent. Source content remains unchanged: Relink rewrites rendered HTML, not CMS documents.

## Log reconciliation

Retained GPT logs covered 2026-09-25 16:53 UTC through 2026-10-24 15:04 UTC; Space logs covered 2026-10-01 07:07 UTC through 2026-10-24 15:04 UTC. All lines parsed as JSON. GPT had 41,651 complete start/completion pairs and Space had 33,597. Each retained window also began with one completion whose start preceded the rotation boundary. Neither retained window contained `run.failed`, duplicate run events, or an orphaned start.

Rotation used approximately 5 MiB files with at most five archives and restricted permissions. The different retention periods reflect different log volumes, not missing rotation. A successful maintenance run means the batch executed successfully; it does not mean every external link was reachable or a Grokipedia replacement was selected.

One Space Reddit target caused 19,069 blocked observations in the retained period. Its short `Retry-After` repeatedly overrode the intended backoff. This was an operational defect, although the plugin correctly avoided classifying the block as a broken target.

## Grokipedia diagnosis

A read-only probe used the installed EmDash 1.3.1 HTTP bridge and the corrected Relink parser for all 24 active Wikipedia targets:

- Four Wikipedia sources returned 404 and cannot establish current article identity.
- Nine candidate Grokipedia URLs returned 404 at the Wikipedia-derived path. This does not prove that no equivalent article exists under another path.
- Eleven candidates failed the existing identity/content heuristic. Their introductory significant-word overlap was approximately 21–49%, below the configured implementation threshold of 60%. The `Lunar_surface` source additionally redirects to a different title/canonical article. `Range_safety` contains a section fragment which would still require verification if article matching succeeded.

The old parser only read `<p>` elements. Grokipedia's current visible article paragraphs use `<span data-tts-block="true">` inside `.article-body`; the old parser therefore extracted an empty introduction even from an available article such as `Machine_learning`. A second defect permanently cached ambiguous results through `grokipediaChecked`, so later content or markup changes could never recover without a manual check.

The source fixes support the visible paragraph structure and periodic reconsideration. They do not lower the article-identity threshold or force replacements. Consequently, the complete live probe still produced zero eligible automatic Grokipedia replacements. Improving recall further requires a separately evaluated matching strategy, alias discovery, or editorially verified manual destinations.

## Corrections and validation

Relink 0.2.7 adds scoped visible-text extraction, weekly reconsideration of rejected candidates, distinct missing/unavailable provider outcomes, `grokipedia.discovery` reason codes, and the effective Grokipedia setting in `run.completed`. Repeated unverifiable checks now respect the later of the server retry time and the three/seven-day backoff. The first explicit retry time remains honored.

Local verification passed strict TypeScript checks, lint, all 113 tests across 12 files, and the package build. Regression tests cover the observed span markup, exclusion of UI/script text, provider failure classification, repeated short `Retry-After`, reconsideration of legacy negative results, and discovery logging.

## Deployment result

Both sites were deployed sequentially from isolated builds using Relink 0.2.7 and explicit `settings: { grokipediaEnabled: true }`. GPT's existing saved setting was already true; Space had no saved settings override and now uses the enabled default. The deployed tarball SHA-256 is `720408a92b45e311a9d4c1367e82bbbf79989ee45dc88045397f05bd5c1462ee`. This is a vendored deployment; npm publication was not performed.

Both site builds and Astro type checks passed with no type errors or warnings. Installed-package SQLite/storage revisions, scheduler registration and admin snapshot checks passed against EmDash 1.3.1. `pnpm peers check` reported no issues. The exact staged package/lockfile pairs also passed offline frozen-lockfile validation independently of unrelated working-tree changes.

Both services are active. Public homepages return 200; unauthenticated admin requests return the expected 302. EmDash doctor passed database, migrations, collections, datetime storage and users on both sites, with no pending migrations. All 19 archive replacement output checks passed again after deployment.

Actual 0.2.7 scheduled runs report `grokipediaEnabled: true` and record both content mismatch and missing-target outcomes. GPT completed its in-progress content scan after restart. The persistent Space Reddit block now schedules its next check seven days later instead of retrying every minute. No automatic Grokipedia rule was forced into the database.

Database snapshots, pre-change configuration, deployment logs and migration/doctor reports are retained under `/var/backups/relink-20261024/{space,gpt}`. Previous distribution trees and dependency trees are retained on the same filesystem under `/var/www/.relink-{space,gpt}-0.2.7-previous`. The deployment did not restore old database snapshots or overwrite content, drafts, revisions or unrelated source changes.

## Remaining operational issues

Bot blocks, authentication requirements, rate limits and oversized responses remain external checking limitations. They are classified separately from broken links; backoff reduces traffic but cannot remove a remote access restriction. The four current Wikipedia 404s are `Convergence_of_algorithms`, `Baffle_(fluid)`, `Psychological_effects_of_spaceflight` and `Isolation_and_loneliness`.

The required host dependency audit also reported 20 advisories on each existing site dependency tree: one critical, six high, nine moderate and four low. These concern DOMPurify, Zod, the MCP SDK, sanitize-html, ip-address, fast-uri and undici, including host peer dependencies and Relink's pinned Zod dependency. They did not cause the observed maintenance failures, and exploitability was not assessed in this operational check. The full results are retained as `audit.json` in each backup directory. Platform dependency remediation remains separate outstanding maintenance; this report is not a security clearance.

Site deployment commits were pushed to `origin/main`: Space `186dacf` and GPT `66be8c5`. Only the Relink version, vendored archive, matching lockfile entries and Grokipedia default were staged. Space's existing Rose-related changes and both sites' existing theme changes remain uncommitted and intact. GitHub's push-time Dependabot summary reported seven alerts per repository; the live `pnpm audit` result above uses a different inventory and should not be conflated with that summary.

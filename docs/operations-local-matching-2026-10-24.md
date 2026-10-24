# Local matching deployment: 24 October 2026

This follows the [initial production audit](operations-2026-10-24.md). The authorized scope was local similarity matching without paid AI, deployed to GPT and Space on gekko.

## Implementation and resource boundary

Relink 0.2.8 adds Wikipedia canonical/redirect/typo discovery, Grokipedia title/full-text search, local semantic scoring, conservative automatic decisions, an editorial candidate view and missing-topic suggestion drafts. See the [matching policy and installation guide](local-matching.md) for exact thresholds, bounded search limits and downgrade considerations.

The scorer runs in the separate `relink-semantic.service` systemd unit over a group-restricted Unix socket. It uses FastEmbed 0.9.0 and Qdrant's quantized ONNX conversion of multilingual MiniLM-L12-v2 on CPU. The installed environment and model cache use approximately 445 MiB on disk. Observed resident memory was approximately 650 MiB; the unit caps memory at 1 GiB and CPU at 150%. There are no paid inference credentials, requests or remote inference fallbacks. Existing server CPU/memory use is still a resource cost.

Runtime IP traffic is denied and address families are restricted to AF_UNIX. Model loading is offline, telemetry is disabled and startup verifies cached artifact hashes. A deliberate checksum mismatch was rejected before model initialization. The one-time public model download is separate from runtime inference. The source repository records the exact Python dependency versions and model artifact checksums.

## Pre-deployment observations

A read-only pass over all 24 active Wikipedia targets used fresh published paragraph context and the actual CPU model. Before the final empty-title evidence guard, it proposed eight matches, twelve reviews and four missing-topic drafts. All accepted target introductions were inspected. Representative alias matches were:

| Wikipedia URL title                 | Resolved Grokipedia title           | Similarity |
| ----------------------------------- | ----------------------------------- | ---------: |
| Lunar dust                          | Lunar regolith                      |      0.878 |
| Olfaction                           | Sense of smell                      |      0.801 |
| Microgravity                        | Weightlessness                      |      0.851 |
| Dynamic stability                   | Stability theory                    |      0.790 |
| SpaceX Merlin                       | SpaceX Merlin                       |      0.938 |
| Harald Lesch                        | Harald Lesch                        |      0.900 |
| Genetic diversity                   | Genetic diversity                   |      0.864 |
| Explainable artificial intelligence | Explainable artificial intelligence |      0.848 |

Scores are cosine similarity, not probabilities. Canonical Wikipedia redirects and aliases corroborate the differently named destinations. The final guard additionally rejects incomplete title evidence and can hold an otherwise good match when a competing fetched article cannot be verified.

The four draft topics were Dietrich Dörner, Light Verse (short story), Spaceflight-associated neuro-ocular syndrome and Bioastronautics. The searches found no suitable candidate within their bounded results; this is not proof that Grokipedia has no equivalent article anywhere. Drafts link to the official suggestion form and contain scope/reference notes. No suggestion was submitted and no article generation was requested.

The four original Wikipedia 404s produced candidate lists but no automatic correction: current context/title evidence did not meet the strict typo-repair gate. Machine learning has competing same-title results. Artificial general intelligence and several other valid-looking subjects remain below the automatic score/margin thresholds. Range safety has a required section absent from the target. Lunar surface redirects to a section within a broader source article, so it is retained for review.

A small real-model contrast check scored a lunar-regolith paraphrase at 0.760 and unrelated machine-learning/short-story text at 0.053/0.060. This checks that the deployed model distinguishes those examples; it is not a calibrated accuracy benchmark or a justification to lower production thresholds.

## Validation and deployment

Local strict type checking, lint, 132 tests across 15 files, the package build, and 12 installed-package browser tests passed. Tests cover aliases, typos with independent context, identical-title ambiguity, language/identity conflicts, missing fragments, outages, socket response validation, old storage defaults, rule revalidation, manual overrides and local-only submission bookkeeping. Browser checks include the candidate/draft UI, disabled rejected-candidate actions, no automatic external requests, authentication, CSRF, locale behavior, keyboard navigation and accessibility. The new view was also visually inspected.

Both sites were built from isolated copies after SQLite/upload/configuration backups, deployed sequentially (Space then GPT), and restarted with access to the local socket group. Installed-package storage/scheduler/admin checks passed against EmDash 1.3.1. Astro type checks and builds passed. Peer checks passed, all EmDash doctor checks passed and no migrations were pending. Public homepages return 200 and unauthenticated admin requests return 302.

The vendored 0.2.8 archive SHA-256 is `40a5ec78fe3ee1c7dc2f3c5b26b45e147d25bcd9f162258bf1cd9d6e1498807a`. This was not an npm publication. Site commits pushed to `origin/main` are Space `3b697a4` and GPT `065e1d1`. Existing theme and Rose work was preserved and excluded from these commits; the separately staged package/lockfile pairs passed frozen offline validation.

Backups and deployment/doctor/audit logs are under `/var/backups/relink-semantic-20261024/{space,gpt}`. Previous build/dependency trees are under `/var/www/.relink-{space,gpt}-0.2.8-previous`. Temporary build copies were removed after verification. CMS source documents, revisions and uploads were not rewritten.

## Live provider limitations

A scheduled GPT search for artificial general intelligence was incomplete on the first attempt; both public search endpoints subsequently returned valid responses through the installed EmDash HTTP bridge. Ordinary Python urllib requests received HTTP 403, confirming that an unrelated HTTP client is not a substitute for the supported bridge when diagnosing production behavior.

The `Artificial_Intelligence` Grokipedia candidate returned HTTP 200 with an empty visible h1 and French body text. Its title metadata alone does not establish valid English article evidence. The final empty-title guard therefore holds the explainable-AI comparison, although its main candidate scores well. The broad `search-unavailable` result covers incomplete candidate retrieval/evidence as well as search-endpoint failures. This is a provider-evidence limitation, not a failed local model invocation, and no automatic rule is forced through it.

The pre-existing host dependency audits still report 20 advisories per site: one critical, six high, nine moderate and four low. They are unchanged from the initial audit and remain separate maintenance; this matching deployment is not a security clearance.

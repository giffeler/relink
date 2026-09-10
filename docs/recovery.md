# Link evidence, archive recovery and exceptions

## Checking originals

Relink tries HEAD first and confirms unsuccessful or HTML responses with GET. Redirects are bounded to five and ten-second request timeouts apply. Inspected bodies are limited to 512 KB. A successful HEAD cannot override a failing GET. Sign-in pages, bot challenges and suspicious soft-error titles are marked unverifiable.

404/410 and repeated server or transport failures can contribute to a broken-link decision. 401/407, 403/451 and 429 remain distinct authentication, blocked and rate-limited results. `Retry-After` is honoured with bounds. For transport/5xx failures, independent network probes must answer successfully enough to establish connectivity before a failure counts. If both probes fail, Relink records a local outage, retries in an hour and does not advance archive eligibility.

Failures count at most once per 24 hours, including manual retries. The default schedule is first check, +24 hours, +72 hours from initial failure. The third confirmed failure permits archive discovery. Healthy originals reset the failure series. Originals behind an active archive return after two successful checks at least 24 hours apart; an intervening confirmed broken check resets recovery evidence.

## Wayback

Relink queries the Internet Archive CDX endpoint for up to three of the latest exact-URL captures before the failure period. It requires a successful recorded status, a supported document MIME type, an accessible playback URL for that exact timestamp/resource, and all referenced section anchors. Calendar pages, errors, mismatching resources and missing sections are unsuitable. It records the capture date, original URL, verified fragments, playback evidence, decision reason and history.

Discovery never submits pages to Save Page Now. Missing captures leave the original in place and schedule discovery in 30 days. Archive API/playback outages are retryable service failures and are retried in one day. An archive that subsequently gives a confirmed broken response is removed and flagged; authentication or bot-blocking alone does not prove a previously verified archive is gone.

## Grokipedia

Disabled by default. The initial provider considers canonical Wikipedia `/wiki/` article URLs. Query-bearing/historical revisions and special namespaces are held for review. A candidate Grokipedia slug is only a discovery hint.

Automatic eligibility additionally requires a reachable exact canonical Grokipedia URL, matching visible article titles, matching source/target language, a canonical Wikipedia source, sufficient independent introductory-content overlap, no disambiguation evidence, and matching section identifiers. The current overlap rule requires at least six shared significant words and 60% overlap relative to the smaller introduction vocabulary. This conservative heuristic is not a universal semantic identity proof; ambiguous or insufficient evidence stays unchanged. German sources cannot be redirected to English destinations.

If a Grokipedia replacement becomes unavailable while Wikipedia is reachable, Relink restores Wikipedia. If both are broken, the normal archive workflow applies. **Check again** permits another matching attempt. Reviewers can always set a verified manual destination or retain the original with an undo exception. No undocumented paid API or account is required.

## Network safety

Production requests use EmDash's DNS-aware restricted HTTP bridge, with the unrestricted-public-network capability needed for arbitrary external links. Local/private addresses, credentials in URLs and unsafe redirects are rejected. Relink also rejects unsafe literals before calling the bridge. Literal IPv6 URLs are conservatively excluded in this release; ordinary hostnames with public IPv6 DNS are handled by EmDash. No cookies, browser credentials or incoming authorization headers are forwarded to link destinations.

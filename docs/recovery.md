# Link evidence, archive recovery and exceptions

## Checking originals

Relink uses GET directly for ordinary link checks, avoiding a preceding HEAD request to the same target. Redirects are bounded to five and ten-second request timeouts apply. Complete HTML responses are inspected up to 2 MiB by default; `http.maxHtmlBytes` can increase the ceiling to at most 4 MiB. Oversized responses remain unverifiable, with their HTTP status retained; truncated HTML is never accepted as complete identity or section evidence. Provider API payloads retain a separate 512,000-byte limit. Sign-in pages, bot challenges and suspicious soft-error titles are marked unverifiable. Explicit HEAD checks remain available internally, but do not immediately repeat an authentication, blocking or rate-limit refusal with GET.

404/410 and repeated server or transport failures can contribute to a broken-link decision. 401/407, 403/451 and 429 remain distinct authentication, blocked and rate-limited results. A `cf-mitigated: challenge` response remains blocked even at HTTP 200 or 503, following [Cloudflare's documented challenge signal](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/). HTTP 503 with `Retry-After` is treated as a temporary rate-limit result. `Retry-After` is honoured between one minute and seven days. For other transport/5xx failures, independent network probes must answer successfully enough to establish connectivity before a failure counts. If both probes fail, Relink records a local outage, retries in an hour and does not advance archive eligibility.

## Reducing inconclusive checks

The scheduler already selects at most one original link per hostname per tick. HTTP 429 and HTTP 503 with `Retry-After` additionally pause that hostname across URLs, redirects, provider requests and subsequent scheduled runs. Without a valid header, a 429 pauses the host for one hour. Cooldowns survive process restarts; expired entries are discarded. Deferring a scheduled sibling link emits `link.deferred` and moves its next check without overwriting its previous evidence. This policy is per site; separate sites do not coordinate their requests.

Repeated unverifiable results without an explicit retry time use intervals of one, three and then seven days. A healthy or broken observation resets this counter. **Check again** resets the per-link backoff but respects an active host cooldown. Existing records load with zero attempts and no cooldowns; no data migration is required. These changes reduce unnecessary requests; an existing block is not proof that the target has disappeared.

For an operator-identifiable crawler, configure a public contact page:

```ts
relink({
  siteUrl: "https://your-site.example",
  http: {
    userAgent: "Relink (+https://your-site.example/crawler)",
    maxHtmlBytes: 2 * 1024 * 1024,
  },
  sources: [{ collection: "posts", path: "/posts/{slug}" }],
});
```

For persistent 403 responses, verify the original manually and request allowlisting from the destination operator where appropriate. Keep uncertain links for review or explicitly exclude a domain. A HEAD response, a search result or an available archive does not establish that the original is healthy or dead. Authentication and challenges remain review items; this release does not use browser impersonation, rotating proxies or CAPTCHA solving. Configuration changes take effect after rebuilding/restarting the site. Existing records are re-evaluated on their next scheduled check, or through **Check again**.

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

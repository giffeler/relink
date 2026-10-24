# Local Wikipedia and Grokipedia matching

Relink 0.2.8 can use a local CPU embedding model to compare article introductions. No inference API key, subscription, paid endpoint or remote inference fallback is used. Wikipedia and Grokipedia are still contacted to retrieve public article/search evidence. Only public article text and published link context reach the local scorer.

## Matching policy

1. Verify the Wikipedia source, its canonical URL and language. Read its redirect aliases through the Wikipedia API.
2. For a confirmed source 404, search Wikipedia and compare candidates with the published paragraph around the link. Automatic typo repair requires at least 40 context characters, title edit similarity of 0.88, semantic similarity of 0.72, a lead of 0.08 over the next candidate, and valid fragments. Blocks, authentication failures and timeouts never trigger source repair.
3. Search Grokipedia's public typeahead and full-text endpoints using the canonical and original titles (or a simplified title). Include the direct canonical-title candidate, rank by title/alias similarity and verify up to five articles.
4. Compare language, canonical identity, introductory text and every referenced section. Explicit subject-type or birth-year conflicts reject a candidate. Automatic replacement requires title/alias edit similarity of 0.88 and semantic cosine similarity of 0.78, with a 0.06 lead over every other non-rejected candidate.
5. Retain ambiguous candidates for review. Failed searches, incomplete article responses and an unavailable scorer cannot authorize an automatic replacement. Inconclusive revalidation removes an existing automatic encyclopedia rule; manual decisions remain intact.
6. If searches succeed but no suitable candidate survives, prepare a suggestion draft. A corrected Wikipedia source can become the replacement when no Grokipedia match exists. No CMS source content is changed.

These are conservative heuristics, not calibrated probabilities or a proof of article identity. A cosine score is displayed as similarity, never as a confidence percentage. Related subjects can have high scores; identical titles can describe different subjects. Language and identity checks are useful safeguards but are not exhaustive. Legitimate matches below the thresholds remain reviewable rather than being forced through.

Searches are bounded: five results per endpoint, at most two target queries, five fetched target articles and fifty Wikipedia aliases. An unsuccessful bounded search does not prove an article is absent from all of Grokipedia. The label “missing” means no suitable match in those recorded searches. Grokipedia's public search endpoints are observed frontend interfaces, not a guaranteed stable API; response changes fail closed and need maintenance.

The scorer uses the first 2,500 characters of each title/introduction. It averages normalized embeddings from 55-word windows to reduce truncation at the model's 128-token limit; unusually token-dense windows can still be truncated. The model and thresholds must be reevaluated together before changing either.

## Node service installation

The supplied unit is for Linux/systemd Node deployments, not Cloudflare Workers. The validated server runs Python 3.14 on Linux arm64. Install the Python dependencies in a dedicated virtual environment; `services/semantic/requirements.lock` records the exact production dependency versions. Other platforms need compatible wheels and their own validation.

Run as the server administrator, adjusting the two existing web-service usernames as needed:

```sh
useradd --system --no-create-home --shell /usr/sbin/nologin relink-semantic
install -d -m 0755 /opt/relink-semantic
python3.14 -m venv /opt/relink-semantic/venv
/opt/relink-semantic/venv/bin/python -m pip install --only-binary=:all: -r services/semantic/requirements.lock
install -m 0644 services/semantic/server.py /opt/relink-semantic/server.py
/opt/relink-semantic/venv/bin/python /opt/relink-semantic/server.py --cache /opt/relink-semantic/models --download
chgrp -R relink-semantic /opt/relink-semantic/models
chmod -R g+rX /opt/relink-semantic/models
usermod -a -G relink-semantic emdash-space
usermod -a -G relink-semantic emdash-gpt
install -m 0644 services/semantic/relink-semantic.service /etc/systemd/system/relink-semantic.service
systemctl daemon-reload
systemctl enable --now relink-semantic
```

The one-time download retrieves Qdrant's quantized ONNX conversion of `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`. The deployment used model repository revision `faf4aa4225822f3bc6376869cb1164e8e3feedd0`. Compare the generated `models/sha256.json` with the checked-in `services/semantic/model-sha256.json` before enabling production. A changed upstream snapshot requires review; do not silently accept changed weights. The download command writes a local manifest, and every subsequent runtime start verifies those hashes. Runtime cache files remain root-owned and read-only for the service.

The service accepts HTTP only on `/run/relink-semantic/score.sock` with mode 0660. systemd denies IP traffic, permits only AF_UNIX sockets, caps memory at 1 GiB and CPU at 150%, and prevents filesystem writes outside its runtime/temp directories. ONNX telemetry is disabled. Offline mode prevents model downloads at runtime. The model process logs readiness, not article text or request bodies.

Add to the existing plugin configuration:

```ts
relink({
  // Existing siteUrl and sources remain required.
  settings: { grokipediaEnabled: true },
  matching: { socketPath: "/run/relink-semantic/score.sock" },
});
```

Saved admin settings take precedence over configuration defaults. Rebuild the site and restart its service so the process gains supplementary group access. Use the normal EmDash cron job; never run a second maintenance engine concurrently against the production database. Queue a published-content scan to populate paragraph context, then queue checks for the Wikipedia targets.

The Node client times out after 15 seconds, bounds responses and validates the model identifier and score count. Service failure produces an unavailable assessment rather than a remote fallback. Restoring the socket service and requesting another check retries the comparison. Existing non-local configurations keep the previous strict provider.

## Review and suggestions

Link details show the verified Wikipedia source, candidate URLs, similarity, rejection/review reasons and a manual destination action. Rejected candidates and candidates with missing fragments cannot be selected through the candidate button. Manual destination verification remains available through the normal editorial workflow.

Missing-topic drafts contain a title, reference URL, aliases and a scope instruction. They do not copy an article body. The “Open Grokipedia suggestion” action opens `https://grokipedia.com/suggest?q=...`; signing in and submitting are separate actions in Grokipedia. Its submission initiates article generation. Relink makes no submission request and does not attempt to automate that workflow. “Mark as submitted” changes only local bookkeeping and preserves the state across repeat checks for the same topic.

## Verification and rollback

Inspect `grokipedia.discovery` records for result, reason, candidate count, model and top score. Detailed candidates stay in plugin storage/history; article bodies and full URLs are excluded from operational logs. Reconcile records with public rendered anchors, because a completed run alone does not prove any replacement occurred.

For an immediate operational rollback, keep Relink 0.2.8 installed and disable the Grokipedia setting. This stops encyclopedia rewrites while leaving archive handling available. Remove `matching` and rebuild to restore the previous strict discovery provider; stop the model service only after removing its consumers.

Upgrading needs no database migration: new fields have defaults. Downgrading to 0.2.7 is different because its schema does not recognize the new `wikipedia` rule kind, `grokipedia-missing` review reason, `wikipedia-corrected` history event or `suggestion-submitted` command. Before an old binary reads those records, stop the web service, retain a fresh database backup, clear Wikipedia correction rules and their history destinations, translate those review/event values to existing equivalents, and remove pending suggestion-bookkeeping commands. Preserve all CMS content and unrelated plugin data. Do not restore an old whole-database snapshot over newer published content. The retained pre-deployment distribution/configuration/dependency trees support binary rollback once storage compatibility has been reconciled.

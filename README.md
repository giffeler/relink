# Relink

External link maintenance for EmDash. Relink inventories published links, checks them in the background, uses verified Wayback captures after repeated failures, and keeps a review history. Original content, drafts and revisions are never rewritten.

**Compatibility:** Compatibility with **EmDash 1.3.0** has been tested and confirmed. The automated compatibility matrix covers EmDash 0.38.0, 0.39.0, 0.40.0, 0.41.0 and 0.42.0, with matching `@emdash-cms/admin` versions. The default development and example fixtures use 0.42.0, Astro 7.3.1, React 19 and Lingui 5. English and German interfaces; automatic or forced text direction. This is a native plugin, installed through your site's configuration; it is not a sandbox marketplace bundle. See the [validation scope](docs/testing.md).

**Licensing:** [Relink Noncommercial License 1.0](LICENSE). Noncommercial use is free; commercial use of material governed by the new license requires a separate agreement with **gekko mbH** at [info2504@gekko.de](mailto:info2504@gekko.de). This is source-available software, not OSI-approved open source. **The previously released 0.1.0 code retains its MIT permissions, including commercial use.** The licensing transition started with version 0.2.0. See [licensing and commercial use](docs/licensing.md) for the exact scope and the rights needed for external contributions.

## Install

Install the current npm release, **Relink 0.2.6**:

```sh
pnpm add emdash-plugin-relink@0.2.6
```

Keep EmDash and `@emdash-cms/admin` on matching versions, React on major version 19, and Lingui on major version 5. If your package manager does not install peer dependencies automatically, add the matching admin and Lingui packages explicitly. Relink 0.2.6's declared EmDash/admin peer dependencies still list only 0.38.0 through 0.42.0, so package managers may report a peer-dependency mismatch with EmDash 1.3.0 despite its confirmed compatibility. See the [compatibility record](docs/testing.md#emdash-130-compatibility-confirmation).

To build a distribution archive from source instead:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination work/artifacts
```

The source tree builds Relink **0.2.9**. Install the resulting `emdash-plugin-relink-0.2.9.tgz` in the host site. See the [production audit](docs/operations-2026-10-24.md) for the initial fixes. The optional [local similarity service](docs/local-matching.md) adds alias search, conservative typo repair, reviewable candidates and missing-article suggestion drafts without paid inference. See the [deployment results](docs/operations-local-matching-2026-10-24.md).

```ts
// astro.config.ts
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
import { relink } from "emdash-plugin-relink";
import { relinkAstro } from "emdash-plugin-relink/astro";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: "file:./data.db" }),
      plugins: [
        relink({
          siteUrl: "https://your-site.example",
          sources: [
            {
              collection: "posts",
              path: "/posts/{slug}",
              portableTextFields: ["content"],
              urlFields: ["website", "content[].url"],
            },
          ],
        }),
      ],
    }),
    relinkAstro(),
  ],
});
```

Open **Relink** in the EmDash navigation and choose **Scan published content**. This registers the recurring job if it does not already exist. Saving, publishing, unpublishing and deleting content also queue a scan of published entries. Node uses EmDash's scheduler. Cloudflare needs the supported Worker entry and a Cron Trigger; see [installation](docs/installation.md).

## Behaviour

| Situation                   | Default                                                     |
| --------------------------- | ----------------------------------------------------------- |
| New published target        | Check in a background batch                                 |
| Reachable target            | Check again in seven days                                   |
| Confirmed failure           | Retry after 24 hours and 72 hours from the first failure    |
| Three confirmed failures    | Discover and verify an existing Wayback capture             |
| Archive in use              | Review and recheck after seven days                         |
| No suitable capture         | Retry discovery after 30 days                               |
| Archive service unavailable | Retry discovery after one day                               |
| Original recovers           | Restore after two successful checks at least 24 hours apart |
| Undo automatic replacement  | Preserve an exception across scans and restarts             |

Authentication, bot blocking, rate limiting and local outages are distinct from broken links. Grokipedia matching is optional and disabled by default. Matching slugs alone never permit a replacement; language, canonical identity, visible article evidence and section targets must match.

Checks use one GET by default, inspect complete HTML up to 2 MiB, and retain host-wide rate-limit pauses across scheduled runs. Repeated inconclusive checks back off to one, three and seven days. Operators can configure the bounded HTML budget and a crawler identity with a public contact URL. See [request policy and blocked targets](docs/recovery.md#reducing-inconclusive-checks).

The admin includes filters, CSV export, a history view, source excerpts and editor links, manual actions, a dashboard widget and a content-editor panel. It follows the active EmDash language without adding a language selector. RTL is a presentation option, not an Arabic or Hebrew translation.

## Development and verification

Every maintenance run writes structured diagnostics through EmDash's logger. Node operators can additionally set `logFile` to an absolute path for a rotating JSON Lines file. See [operational logging](docs/installation.md#operational-logging) for configuration, retention and how to distinguish successful runs from broken external links.

```sh
pnpm check                    # strict types, lint, unit/integration tests, package build
pnpm test:package             # install the tarball in an isolated EmDash site
node scripts/seed-browser.mjs  # deterministic published-link index for browser tests
pnpm test:browser             # browser regression suite for that installed package
pnpm --filter relink-example-cloudflare build
```

[Architecture and API](docs/architecture.md) · [Configuration](docs/configuration.md) · [Recovery rules](docs/recovery.md) · [Translation and RTL](docs/translations.md) · [Testing and limitations](docs/testing.md) · [Release notes](CHANGELOG.md)

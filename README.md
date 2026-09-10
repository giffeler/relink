# Relink

External link maintenance for EmDash. Relink inventories published links, checks them in the background, uses verified Wayback captures after repeated failures, and keeps a review history. Original content, drafts and revisions are never rewritten.

**Compatibility:** EmDash 0.37.0, Astro 7.3.1, React 19 and Lingui 5. English and German interfaces; automatic or forced text direction. This is a native plugin, installed through your site's configuration; it is not a sandbox marketplace bundle.

**Licensing:** [Relink Noncommercial License 1.0](LICENSE). Noncommercial use is free; commercial use of material governed by the new license requires a separate agreement with **gekko mbH** at [info2504@gekko.de](mailto:info2504@gekko.de). This is source-available software, not OSI-approved open source. **The previously released 0.1.0 code retains its MIT permissions, including commercial use.** Version 0.2.1 records a licensing transition and adds no new link-maintenance functionality. See [licensing and commercial use](docs/licensing.md) for the exact scope and the rights needed for external contributions.

## Install

The initial package is built from this repository. npm publication and deployment are separate operations.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm pack --pack-destination work/artifacts
```

In your EmDash site, install the resulting `emdash-plugin-relink-0.2.1.tgz`. Existing EmDash installations should already have the peer dependencies. Keep `@emdash-cms/admin` at 0.37.0 and Lingui on major version 5.

```sh
pnpm add /path/to/emdash-plugin-relink-0.2.1.tgz
```

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

The admin includes filters, CSV export, a history view, source excerpts and editor links, manual actions, a dashboard widget and a content-editor panel. It follows the active EmDash language without adding a language selector. RTL is a presentation option, not an Arabic or Hebrew translation.

## Development and verification

```sh
pnpm check                    # strict types, lint, unit/integration tests, package build
pnpm test:package             # install the tarball in an isolated EmDash site
node scripts/seed-browser.mjs  # deterministic published-link index for browser tests
pnpm test:browser             # browser regression suite for that installed package
pnpm --filter relink-example-cloudflare build
```

[Architecture and API](docs/architecture.md) · [Configuration](docs/configuration.md) · [Recovery rules](docs/recovery.md) · [Translation and RTL](docs/translations.md) · [Testing and limitations](docs/testing.md) · [Release notes](CHANGELOG.md)

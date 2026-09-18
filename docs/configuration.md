# Configuration

`relink(options: RelinkOptions)` validates configuration at startup. Invalid values cause an explicit validation error. Configuration is JSON-serializable and remains inside the package's descriptor/runtime boundary.

| Option                         | Meaning                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `siteUrl`                      | Absolute public site URL. Same-origin links are excluded.                                                                                       |
| `logFile`                      | Optional absolute POSIX path to a Node-only JSON Lines log. No file is written when omitted; EmDash host logging is always enabled. See [operational logging](installation.md#operational-logging). |
| `sources`                      | Explicit collections and fields to index. At least one is required.                                                                             |
| `sources[].collection`         | Existing EmDash collection slug.                                                                                                                |
| `sources[].path`               | Published pathname template, default `/{slug}`. Supports `{slug}` and `{locale}`. Must match the theme's actual path, including trailing slash. |
| `sources[].portableTextFields` | Root Portable Text fields, default `['content']`. Only used link annotations are scanned.                                                       |
| `sources[].urlFields`          | Explicit selectors for URL strings. Dot notation and `[]` array wildcards are supported.                                                        |
| `settings`                     | Initial validated defaults; admin-saved values take precedence.                                                                                 |
| `networkProbeUrls`             | Two independent public endpoints used to distinguish local network failures from destination failures.                                          |

Custom blocks are supported through explicit field selectors, for example `content[].url`, `content[].button.href` or `resources[].link`. Relink does not guess URL-bearing fields or scan embedded media. Portable Text collects each contiguous linked span group as an occurrence. Identical normalized URLs share a network check; fragments remain on individual occurrences and must be separately verified for automatic replacement.

`ContentDocument`, `CollectionSource` and `extractOccurrences` provide a typed content-adapter boundary. `ArchiveProvider` and `EncyclopediaProvider` define typed provider contracts. External responses and persisted values pass runtime schemas before use.

## Settings

| Setting             | Default | Accepted values                              |
| ------------------- | ------- | -------------------------------------------- |
| `enabled`           | `true`  | Boolean                                      |
| `archiveEnabled`    | `true`  | Boolean                                      |
| `grokipediaEnabled` | `false` | Boolean                                      |
| `direction`         | `auto`  | `auto`, `ltr`, `rtl`                         |
| `healthyDays`       | `7`     | Integer 1–365                                |
| `reviewDays`        | `7`     | Integer 1–90                                 |
| `archiveRetryDays`  | `30`    | Integer 1–365                                |
| `timeoutMs`         | `10000` | Integer 1000–10000                           |
| `batchSize`         | `4`     | Integer 1–4                                  |
| `excludedDomains`   | `[]`    | Domain names; also excludes their subdomains |

The initial settings form exposes activation, archives, Grokipedia, direction and domain exclusions. Timing/batch settings are configurable through typed configuration or the authenticated settings command. Changes are queued and applied by the single background writer, so the UI can display their pending state.

Manual overrides are checked before activation and take priority over automatic destinations. Undo creates a persistent automatic-replacement exception. Excluding a link suppresses checking and rewriting; including it again does not erase an undo exception. Setting a new manual destination remains possible.

# Third-party and historical licensing

The Relink Noncommercial License governs only material identified as subject to it and only rights controlled by gekko. It does not supersede licenses on dependencies or previously MIT-licensed Relink material.

The original Relink 0.1.0 MIT notice is retained verbatim in [LICENSES/MIT-legacy.txt](LICENSES/MIT-legacy.txt). See [the licensing transition](docs/licensing.md#existing-mit-rights-remain).

## Runtime dependencies and host integration

| Component                      | License in the validated baseline | Where to find the notice                          |
| ------------------------------ | --------------------------------- | ------------------------------------------------- |
| parse5 8.0.1                   | MIT                               | Installed parse5 package                          |
| Zod 4.5.4                      | MIT                               | Installed zod package                             |
| EmDash and EmDash admin 0.37.0 | MIT                               | Installed emdash and @emdash-cms/admin packages   |
| Astro 7.3.1                    | MIT                               | Installed astro package                           |
| React 19                       | MIT                               | Installed react package                           |
| Lingui 5                       | MIT                               | Installed @lingui/core and @lingui/react packages |
| Kumo 2.6                       | MIT                               | Installed @cloudflare/kumo package                |

Relink's package contains its own emitted modules and imports these dependencies or host-provided peers. It does not replace their license files. If you bundle or redistribute their code, include the applicable notices from the exact versions distributed. This table is a guide to the direct runtime and host components, not a substitute for reviewing all transitive or development dependencies in a redistributed installation.

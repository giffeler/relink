# Third-party and historical licensing

The Relink Noncommercial License governs only material identified as subject to it and only rights controlled by gekko. It does not supersede licenses on dependencies or previously MIT-licensed Relink material.

The original Relink 0.1.0 MIT notice is retained verbatim in [LICENSES/MIT-legacy.txt](LICENSES/MIT-legacy.txt). See [the licensing transition](docs/licensing.md#existing-mit-rights-remain).

## Runtime dependencies and host integration

| Component                             | License in the validated baseline | Where to find the notice                          |
| ------------------------------------- | --------------------------------- | ------------------------------------------------- |
| parse5 8.0.1                          | MIT                               | Installed parse5 package                          |
| Zod 4.5.4                             | MIT                               | Installed zod package                             |
| EmDash and EmDash admin 0.38.0–0.42.0 | MIT                               | Installed emdash and @emdash-cms/admin packages   |
| Astro 7.3.1                           | MIT                               | Installed astro package                           |
| React 19                              | MIT                               | Installed react package                           |
| Lingui 5                              | MIT                               | Installed @lingui/core and @lingui/react packages |
| Kumo 2.6                              | MIT                               | Installed @cloudflare/kumo package                |

Relink's package contains its own emitted modules and imports these dependencies or host-provided peers. It does not replace their license files. If you bundle or redistribute their code, include the applicable notices from the exact versions distributed. This table is a guide to the direct runtime and host components, not a substitute for reviewing all transitive or development dependencies in a redistributed installation.

## Optional local semantic service

The service uses FastEmbed and ONNX Runtime. Model weights are downloaded separately and are not included in the npm archive. The [Sentence Transformers model](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) and [Qdrant quantized ONNX conversion](https://huggingface.co/Qdrant/paraphrase-multilingual-MiniLM-L12-v2-onnx-Q) identify Apache-2.0 licensing in their model cards. Their licenses remain independent of Relink's license. Retain the model cache's upstream notices and the installed Python distributions' license files when redistributing a complete service installation. The exact validated dependency versions and model checksums are recorded under `services/semantic/`; the weights are not relicensed by this project.

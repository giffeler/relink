import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import emdash from "emdash/astro";
import { d1 } from "@emdash-cms/cloudflare";
import { relink } from "emdash-plugin-relink";
import { relinkAstro } from "emdash-plugin-relink/astro";

export default defineConfig({
  output: "server",
  site: "https://relink-example.example",
  adapter: cloudflare(),
  integrations: [
    react(),
    emdash({
      database: d1({ binding: "DB" }),
      plugins: [
        relink({
          siteUrl: "https://relink-example.example",
          sources: [{ collection: "posts", path: "/posts/{slug}" }],
        }),
      ],
    }),
    relinkAstro(),
  ],
});

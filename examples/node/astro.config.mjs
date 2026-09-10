import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import emdash from "emdash/astro";
import { sqlite } from "emdash/db";
import { relink } from "emdash-plugin-relink";
import { relinkAstro } from "emdash-plugin-relink/astro";

export default defineConfig({
  output: "server",
  site: "http://localhost:4321",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: "file:./data.db" }),
      plugins: [
        relink({
          siteUrl: "http://localhost:4321",
          sources: [
            {
              collection: "posts",
              path: "/posts/{slug}",
              urlFields: ["website", "content[].url"],
            },
          ],
        }),
      ],
    }),
    relinkAstro(),
  ],
});

import type { AstroIntegration } from "astro";

/** Add after emdash(). Dynamic HTML is rewritten after the downstream render. */
export function relinkAstro(): AstroIntegration {
  return {
    name: "relink",
    hooks: {
      "astro:config:setup": ({ addMiddleware, updateConfig }) => {
        addMiddleware({
          entrypoint: "emdash-plugin-relink/middleware",
          order: "post",
        });
        updateConfig({
          vite: {
            resolve: {
              dedupe: [
                "react",
                "react-dom",
                "@lingui/core",
                "@lingui/react",
                "@cloudflare/kumo",
              ],
            },
          },
        });
      },
    },
  };
}
export default relinkAstro;

import { afterEach, expect, it, vi } from "vitest";
// Pinned Astro internals exercise the actual cache provider; shipped code uses public types only.
import memoryProvider from "../node_modules/astro/dist/core/cache/memory-provider.js";
import {
  AstroCache,
  applyCacheHeaders,
} from "../node_modules/astro/dist/core/cache/runtime/cache.js";
import { capRenderCache, renderResponse } from "../src/middleware.js";

afterEach(() => vi.restoreAllMocks());

it("refreshes replacement and rollback through Astro's real memory cache within 300 seconds", async () => {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const provider = memoryProvider(undefined);
  const handle = provider.onRequest?.bind(provider);
  if (!handle) throw new Error("Missing Astro cache handler");
  let destination: string | null = null;
  const request = new Request("https://site.example/post");
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const dispatch = vi.fn(async () => ({
    success: true,
    data: {
      rules: destination ? [["https://original.example/", destination]] : [],
    },
  }));
  const requestPage = (): Promise<Response> =>
    handle({ request, url: new URL(request.url), logger }, async () => {
      const cache = new AstroCache(provider);
      cache.set({ maxAge: 86400, swr: 3600, etag: '"same-cms-revision"' });
      const response = await renderResponse(
        new Response('<a href="https://original.example/">Source</a>', {
          headers: { "content-type": "text/html" },
        }),
        request,
        { emdash: { handlePublicPluginApiRoute: dispatch } },
      );
      await capRenderCache(response, request, cache);
      applyCacheHeaders(cache, response, request);
      return response;
    });
  const first = await requestPage();
  expect(first.headers.get("X-Astro-Cache")).toBe("MISS");
  const originalEtag = first.headers.get("etag");
  destination = "https://archive.example/capture";
  now += 299_000;
  const stale = await requestPage();
  expect(stale.headers.get("X-Astro-Cache")).toBe("HIT");
  expect(await stale.text()).toContain("original.example");
  now += 1001;
  const replaced = await requestPage();
  expect(await replaced.text()).toContain("archive.example");
  expect(replaced.headers.get("etag")).not.toBe(originalEtag);
  expect(replaced.headers.get("cache-control")).toBe(
    "public, max-age=0, must-revalidate",
  );
  destination = null;
  now += 300_001;
  expect(await (await requestPage()).text()).toContain("original.example");
  expect(dispatch).toHaveBeenCalledTimes(3);
});

it("honors explicit cache opt-outs and disables caching for private HTML", async () => {
  const request = new Request("https://site.example/post");
  const cache = new AstroCache(null);
  cache.set({ maxAge: 86400 });
  cache.set(false);
  await capRenderCache(
    new Response("public", { headers: { "content-type": "text/html" } }),
    request,
    cache,
  );
  expect(cache.options.maxAge).toBeUndefined();
  cache.set({ maxAge: 86400 });
  await capRenderCache(
    new Response("private", {
      headers: {
        "content-type": "text/html",
        "cache-control": "private, no-store",
      },
    }),
    request,
    cache,
  );
  expect(cache.options.maxAge).toBeUndefined();
});

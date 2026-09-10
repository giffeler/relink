/// <reference types="emdash/locals" />
import type { APIContext, MiddlewareHandler } from "astro";
import { getPublicPluginApiRouteHandler } from "emdash/plugin-utils";
import type { PublicPluginRuntimeLocals } from "emdash/plugin-utils";
import { projectionSchema } from "./core/api.js";
import { rewriteLinks } from "./core/html.js";
import { readLimited } from "./core/http.js";
import { stableId } from "./core/url.js";

const fingerprints = new WeakMap<Response, string>();

/** No external I/O: only the local, public EmDash dispatcher is used. */
export async function renderResponse(
  response: Response,
  request: Request,
  locals: PublicPluginRuntimeLocals,
): Promise<Response> {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.pathname.startsWith("/_emdash") ||
    [...url.searchParams.keys()].some((key) => /preview|edit/iu.test(key)) ||
    response.status !== 200 ||
    !response.headers.get("content-type")?.includes("text/html")
  )
    return response;
  const headers = new Headers(response.headers);
  // HTML must reach the origin within five minutes, including failure fallback.
  // Private/no-store pages keep their stronger policy; public pages receive a cap.
  if (!/private|no-store/iu.test(headers.get("cache-control") ?? ""))
    headers.set(
      "cache-control",
      "public, max-age=0, s-maxage=300, must-revalidate",
    );
  headers.delete("etag");
  headers.delete("last-modified");
  const fallback = (): Response =>
    new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  const dispatch = getPublicPluginApiRouteHandler(locals);
  if (!dispatch || response.headers.has("content-encoding")) return fallback();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const requestUrl = new URL("/_emdash/api/plugins/relink/projection", url);
    requestUrl.searchParams.set("path", url.pathname);
    const result = await Promise.race([
      dispatch("relink", "GET", "/projection", new Request(requestUrl)),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Relink projection timeout")),
          1000,
        );
      }),
    ]);
    if (!result.success) return fallback();
    const projection = projectionSchema.parse(result.data);
    if (projection.rules.length === 0) return fallback();
    const html = await readLimited(response.clone(), 2_000_000, 2000);
    const output = rewriteLinks(html, new Map(projection.rules), url.href);
    headers.delete("content-length");
    headers.delete("content-encoding");
    void response.body?.cancel().catch(() => undefined);
    const resultResponse = new Response(output, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    fingerprints.set(
      resultResponse,
      await stableId(JSON.stringify(projection.rules)),
    );
    return resultResponse;
  } catch {
    return fallback();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
/** Keep Astro's origin cache and downstream caches within one freshness budget. */
export async function capRenderCache(
  result: Response,
  request: Request,
  cache: APIContext["cache"],
): Promise<void> {
  const url = new URL(request.url);
  if (
    request.method === "GET" &&
    result.status === 200 &&
    result.headers.get("content-type")?.includes("text/html") &&
    !url.pathname.startsWith("/_emdash") &&
    ![...url.searchParams.keys()].some((key) => /preview|edit/iu.test(key)) &&
    cache.enabled &&
    (cache.options.maxAge !== undefined || cache.tags.length > 0)
  ) {
    if (/private|no-store/iu.test(result.headers.get("cache-control") ?? ""))
      cache.set(false);
    else {
      // Astro's provider wraps middleware and can overwrite response headers.
      // Cap that inner cache too, then prevent another full TTL at an outer CDN.
      cache.set({
        maxAge: Math.min(cache.options.maxAge ?? 300, 300),
        swr: 0,
        etag: `"${await stableId(`${cache.options.etag ?? Date.now()}:${fingerprints.get(result) ?? "original"}`)}"`,
        lastModified: new Date(),
      });
      result.headers.set("cache-control", "public, max-age=0, must-revalidate");
    }
  }
}
export const onRequest: MiddlewareHandler = async (context, next) => {
  const result = await renderResponse(
    await next(),
    context.request,
    context.locals,
  );
  await capRenderCache(result, context.request, context.cache);
  return result;
};

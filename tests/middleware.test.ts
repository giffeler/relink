import { describe, expect, it, vi } from "vitest";
import { renderResponse } from "../src/middleware.js";

describe("server output and cache lifetime", () => {
  const html = '<p><a href="https://original.example/">Original</a></p>';
  const original = (): Response =>
    new Response(html, {
      headers: {
        "content-type": "text/html",
        "cache-control": "public, max-age=86400, stale-while-revalidate=600",
        etag: "stale",
      },
    });
  const request = new Request("https://site.example/post?utm_source=test");
  it("rewrites on the server without JavaScript or external fetches and caps cache age at five minutes", async () => {
    const dispatch = vi.fn(async () => ({
      success: true,
      data: {
        rules: [["https://original.example/", "https://replacement.example/"]],
      },
    }));
    const result = await renderResponse(original(), request, {
      emdash: { handlePublicPluginApiRoute: dispatch },
    });
    expect(await result.text()).toBe(
      html.replace("https://original.example/", "https://replacement.example/"),
    );
    expect(result.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=300, must-revalidate",
    );
    expect(result.headers.has("etag")).toBe(false);
    expect(dispatch).toHaveBeenCalledOnce();
  });
  it("preserves originals when the plugin is absent, errors, or returns invalid data", async () => {
    for (const locals of [
      {},
      {
        emdash: {
          handlePublicPluginApiRoute: async () => ({ success: false }),
        },
      },
      {
        emdash: {
          handlePublicPluginApiRoute: async () => ({
            success: true,
            data: { rules: "bad" },
          }),
        },
      },
    ]) {
      expect(
        await (await renderResponse(original(), request, locals)).text(),
      ).toBe(html);
    }
  });
  it("preserves stronger private cache policy and skips preview and admin output", async () => {
    const privateResponse = new Response(html, {
      headers: {
        "content-type": "text/html",
        "cache-control": "private, no-store",
      },
    });
    expect(
      (await renderResponse(privateResponse, request, {})).headers.get(
        "cache-control",
      ),
    ).toBe("private, no-store");
    const dispatch = vi.fn();
    for (const url of [
      "https://site.example/_emdash/admin",
      "https://site.example/post?_emdash_preview=1",
    ])
      await renderResponse(original(), new Request(url), {
        emdash: { handlePublicPluginApiRoute: dispatch },
      });
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("falls back without deadlocking on an oversized cloned response", async () => {
    const input = new Response("x".repeat(2_000_001), {
      headers: { "content-type": "text/html" },
    });
    const result = await renderResponse(input, request, {
      emdash: {
        handlePublicPluginApiRoute: async () => ({
          success: true,
          data: {
            rules: [
              ["https://original.example/", "https://replacement.example/"],
            ],
          },
        }),
      },
    });
    expect((await result.text()).length).toBe(2_000_001);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  BodyLimitError,
  LinkChecker,
  readLimited,
  retryAfter,
} from "../src/core/http.js";
import {
  defaultSettings,
  HOUR,
  httpOptionsSchema,
  defaultHttpOptions,
} from "../src/core/schema.js";
import { isPublicUrl } from "../src/core/url.js";
import { NOW, response, html } from "./helpers.js";

describe("HTTP evidence", () => {
  it.each([
    [404, "broken", "not-found"],
    [410, "broken", "not-found"],
    [503, "broken", "server-error"],
    [401, "unverifiable", "authentication"],
    [403, "unverifiable", "blocked"],
    [429, "unverifiable", "rate-limited"],
    [451, "unverifiable", "blocked"],
  ])(
    "classifies GET %i without a redundant HEAD request",
    async (status, kind, reason) => {
      const fetch = vi.fn(async () => response(status, "error"));
      const result = await new LinkChecker({ fetch }, defaultSettings).check(
        "https://example.com",
      );
      expect(result).toMatchObject({ kind, reason });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledWith(
        "https://example.com",
        expect.objectContaining({ method: "GET" }),
      );
    },
  );
  it("trusts successful GET after HEAD failure", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response(init?.method === "HEAD" ? 405 : 200),
    );
    expect(
      await new LinkChecker({ fetch }, defaultSettings).check(
        "https://example.com",
        true,
        "HEAD",
      ),
    ).toMatchObject({ kind: "healthy" });
  });
  it("does not trust a successful HEAD when GET is blocked", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response(init?.method === "HEAD" ? 200 : 403),
    );
    expect(
      await new LinkChecker({ fetch }, defaultSettings).check(
        "https://example.com",
        true,
        "HEAD",
      ),
    ).toMatchObject({ kind: "unverifiable", reason: "blocked" });
  });
  it("reads complete large HTML while retaining a hard configurable byte limit and HTTP status", async () => {
    const large = html() + `<script>${" ".repeat(800_000)}</script>`;
    const checker = new LinkChecker(
      { fetch: async () => response(200, large) },
      defaultSettings,
    );
    expect(await checker.check("https://example.com")).toMatchObject({
      kind: "healthy",
      status: 200,
      evidence: { title: "Example article" },
    });
    const limited = new LinkChecker(
      { fetch: async () => response(200, large) },
      defaultSettings,
      () => NOW,
      { ...defaultHttpOptions, maxHtmlBytes: 512_000 },
    );
    expect(await limited.check("https://example.com")).toMatchObject({
      kind: "unverifiable",
      reason: "response-too-large",
      status: 200,
      finalUrl: "https://external.example/article",
    });
    expect(
      httpOptionsSchema.safeParse({ maxHtmlBytes: 4 * 1024 * 1024 + 1 })
        .success,
    ).toBe(false);
    expect(
      httpOptionsSchema.safeParse({
        userAgent: "Relink\r\nAuthorization: secret",
      }).success,
    ).toBe(false);
  });
  it.each([200, 403, 503])(
    "recognizes a Cloudflare challenge at HTTP %i without counting failure",
    async (status) => {
      const fetch = vi.fn(async () =>
        response(status, "<title>Wait</title>", "https://example.com", {
          "cf-mitigated": "challenge",
        }),
      );
      const checker = new LinkChecker({ fetch }, defaultSettings);
      expect(
        await checker.check("https://example.com", true, "HEAD"),
      ).toMatchObject({ kind: "unverifiable", reason: "blocked", status });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it.each([403, 429])(
    "does not immediately retry an explicit HEAD refusal (%i)",
    async (status) => {
      const fetch = vi.fn(async () => response(status));
      await new LinkChecker({ fetch }, defaultSettings).check(
        "https://example.com",
        true,
        "HEAD",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("honours host cooldowns across URLs and redirects without blocking other hosts", async () => {
    let now = NOW;
    const cooldowns: Record<string, number> = {};
    const fetch = vi.fn(async (url: string) =>
      url.includes("redirect.example")
        ? response(302, "", url, { location: "https://limited.example/second" })
        : url.includes("limited.example")
          ? response(429, "", url, { "retry-after": "120" })
          : response(200, html(), url),
    );
    const checker = new LinkChecker(
      { fetch },
      defaultSettings,
      () => now,
      defaultHttpOptions,
      cooldowns,
    );
    expect(await checker.check("https://limited.example/first")).toMatchObject({
      kind: "unverifiable",
      reason: "rate-limited",
      retryAt: NOW + 120000,
    });
    expect(await checker.check("https://limited.example/second")).toMatchObject(
      { reason: "rate-limited", status: null },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await checker.check("https://redirect.example/alias")).toMatchObject(
      { reason: "rate-limited" },
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await checker.check("https://other.example/")).toMatchObject({
      kind: "healthy",
    });
    now += 120001;
    await checker.check("https://limited.example/second");
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("treats a temporary 503 with Retry-After as a deferred check and sends the configured identity", async () => {
    let sentHeaders: HeadersInit | undefined;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      sentHeaders = init?.headers;
      return response(503, "", "https://example.com", { "retry-after": "180" });
    });
    const checker = new LinkChecker({ fetch }, defaultSettings, () => NOW, {
      ...defaultHttpOptions,
      userAgent: "Relink (+https://site.example/contact)",
    });
    expect(await checker.check("https://example.com")).toMatchObject({
      kind: "unverifiable",
      reason: "rate-limited",
      retryAt: NOW + 180000,
    });
    expect(new Headers(sentHeaders).get("User-Agent")).toBe(
      "Relink (+https://site.example/contact)",
    );
  });
  it("keeps the longest cooldown when concurrent redirects reach the same host", async () => {
    const cooldowns: Record<string, number> = {};
    const checker = new LinkChecker(
      {
        fetch: async (url: string) =>
          response(429, "", url, {
            "retry-after": url.endsWith("long") ? "7200" : "120",
          }),
      },
      defaultSettings,
      () => NOW,
      defaultHttpOptions,
      cooldowns,
    );
    await Promise.all([
      checker.check("https://limited.example/long"),
      checker.check("https://limited.example/short"),
    ]);
    expect(cooldowns["limited.example"]).toBe(NOW + 2 * HOUR);
  });
  it("follows five redirects but rejects a sixth and private redirect targets", async () => {
    let count = 0;
    const fetch = vi.fn(async () => {
      count++;
      return response(302, "", "", {
        location: `https://example.com/${count}`,
      });
    });
    expect(
      await new LinkChecker({ fetch }, defaultSettings).check(
        "https://example.com",
      ),
    ).toMatchObject({ kind: "broken", reason: "redirect-loop" });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(
      await new LinkChecker(
        {
          fetch: async () =>
            response(302, "", "", { location: "http://127.0.0.1/private" }),
        },
        defaultSettings,
      ).check("https://example.com"),
    ).toMatchObject({ kind: "unverifiable", reason: "unsafe-url" });
  });
  it("classifies soft errors, timeouts and DNS failures", async () => {
    expect(
      await new LinkChecker(
        { fetch: async () => response(200, "<title>Just a moment</title>") },
        defaultSettings,
      ).check("https://example.com"),
    ).toMatchObject({ kind: "unverifiable", reason: "soft-error" });
    for (const [message, reason] of [
      ["Aborted", "timeout"],
      ["ENOTFOUND", "dns"],
    ]) {
      expect(
        await new LinkChecker(
          {
            fetch: async () => {
              throw new Error(message, { cause: { code: message } });
            },
          },
          defaultSettings,
        ).check("https://example.com"),
      ).toMatchObject({ kind: "broken", reason });
    }
  });
  it("cancels slow response streams and caps body size", async () => {
    const cancelled = vi.fn();
    await expect(
      readLimited(
        new Response(new ReadableStream({ cancel: cancelled })),
        100,
        20,
      ),
    ).rejects.toThrow("timeout");
    expect(cancelled).toHaveBeenCalled();
    await expect(
      readLimited(response(200, "123456"), 3),
    ).rejects.toBeInstanceOf(BodyLimitError);
  });
  it.each([
    ["Hostname resolved to no addresses", "broken", "dns"],
    [
      "Could not resolve hostname: DoH lookup failed: 503",
      "unverifiable",
      "network-outage",
    ],
    ["Hostname resolves to a private IP address", "unverifiable", "unsafe-url"],
    [
      "Plugin HTTP response body exceeds the 8388608 byte limit",
      "unverifiable",
      "response-too-large",
    ],
  ])(
    "preserves EmDash transport refusal evidence: %s",
    async (message, kind, reason) => {
      const checker = new LinkChecker(
        {
          fetch: async () => {
            throw new Error(
              `Plugin "relink": blocked fetch to "external.example": ${message}`,
            );
          },
        },
        defaultSettings,
      );
      expect(await checker.check("https://external.example/")).toMatchObject({
        kind,
        reason,
      });
    },
  );
  it("honours Retry-After within bounded limits", () => {
    expect(retryAfter("120", NOW)).toBe(NOW + 120000);
    expect(retryAfter("1000000000", NOW)).toBe(NOW + 168 * HOUR);
    expect(retryAfter("garbage", NOW)).toBeNull();
  });
  it.each([
    "http://127.0.0.1",
    "http://2130706433",
    "http://10.0.0.1",
    "http://169.254.169.254",
    "http://198.18.0.1",
    "http://198.51.100.1",
    "http://203.0.113.1",
    "http://[::1]",
    "http://localhost",
    "file:///etc/passwd",
    "https://user:password@example.com",
  ])("rejects unsafe literal %s", (url) =>
    expect(isPublicUrl(url)).toBe(false),
  );
  it("permits globally routed IPv4 addresses for EmDash's final network validation", () => {
    expect(isPublicUrl("https://198.41.215.162/")).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  BodyLimitError,
  LinkChecker,
  readLimited,
  retryAfter,
} from "../src/core/http.js";
import { defaultSettings, HOUR } from "../src/core/schema.js";
import { isPublicUrl } from "../src/core/url.js";
import { NOW, response } from "./helpers.js";

describe("HTTP evidence", () => {
  it.each([
    [404, "broken", "not-found"],
    [410, "broken", "not-found"],
    [503, "broken", "server-error"],
    [401, "unverifiable", "authentication"],
    [403, "unverifiable", "blocked"],
    [429, "unverifiable", "rate-limited"],
    [451, "unverifiable", "blocked"],
  ])("confirms HEAD %i with GET", async (status, kind, reason) => {
    const fetch = vi.fn(async () => response(status, "error"));
    const result = await new LinkChecker({ fetch }, defaultSettings).check(
      "https://example.com",
    );
    expect(result).toMatchObject({ kind, reason });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]).toBeDefined();
  });
  it("trusts successful GET after HEAD failure", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      response(init?.method === "HEAD" ? 405 : 200),
    );
    expect(
      await new LinkChecker({ fetch }, defaultSettings).check(
        "https://example.com",
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
      ),
    ).toMatchObject({ kind: "unverifiable", reason: "blocked" });
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
  ])(
    "preserves the distinction in EmDash's DNS guard: %s",
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

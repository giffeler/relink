import { describe, expect, it } from "vitest";
import { LinkChecker } from "../src/core/http.js";
import {
  GrokipediaProvider,
  sameArticle,
  WaybackProvider,
} from "../src/core/providers.js";
import { newLink } from "../src/core/engine.js";
import { defaultSettings } from "../src/core/schema.js";
import { pageEvidence } from "../src/core/html.js";
import { html, NOW, response } from "./helpers.js";

describe("Wayback evidence", () => {
  const original = "https://external.example/article";
  const link = (): ReturnType<typeof newLink> => ({
    ...newLink("l", original, NOW),
    firstFailureAt: NOW,
  });
  it("uses the latest accessible exact capture before failure and preserves verified sections", async () => {
    const rows = [
      ["timestamp", "original", "statuscode", "mimetype"],
      ["20260801000000", original, "200", "text/html"],
      ["20260909000000", original, "200", "text/html"],
      ["20260911000000", original, "200", "text/html"],
    ];
    const checker = new LinkChecker(
      {
        fetch: async (url) =>
          url.includes("/cdx/")
            ? response(200, JSON.stringify(rows), url)
            : response(200, html(), url),
      },
      defaultSettings,
      () => NOW,
    );
    const result = await new WaybackProvider(checker, () => NOW).discover(
      link(),
      ["#History"],
    );
    expect(result).toMatchObject({
      kind: "found",
      replacement: {
        url: `https://web.archive.org/web/20260909000000/${original}`,
        snapshotAt: Date.parse("2026-09-09T00:00:00Z"),
        fragments: ["#History"],
      },
    });
  });
  it.each([
    { rows: [] },
    {
      rows: [
        ["timestamp", "original", "statuscode", "mimetype"],
        ["20260909000000", "https://other.example", "200", "text/html"],
      ],
    },
  ])("preserves originals without an exact capture", async ({ rows }) => {
    const checker = new LinkChecker(
      { fetch: async (url) => response(200, JSON.stringify(rows), url) },
      defaultSettings,
    );
    expect(await new WaybackProvider(checker).discover(link(), [""])).toEqual({
      kind: "missing",
    });
  });
  it.each([429, 503])(
    "treats archive API %i as a service failure",
    async (status) => {
      const checker = new LinkChecker(
        { fetch: async () => response(status) },
        defaultSettings,
      );
      expect(await new WaybackProvider(checker).discover(link(), [""])).toEqual(
        { kind: "unavailable" },
      );
    },
  );
  it("verifies PDF playback with GET even when HEAD advertises success", async () => {
    const rows = [
      ["timestamp", "original", "statuscode", "mimetype"],
      ["20260909000000", original, "200", "application/pdf"],
    ];
    const checker = new LinkChecker(
      {
        fetch: async (url, init) =>
          url.includes("/cdx/")
            ? response(200, JSON.stringify(rows), url)
            : response(init?.method === "HEAD" ? 200 : 404, "", url, {
                "content-type": "application/pdf",
              }),
      },
      defaultSettings,
    );
    expect(await new WaybackProvider(checker).discover(link(), [""])).toEqual({
      kind: "missing",
    });
  });
  it("rejects missing fragments and service failures on playback", async () => {
    const rows = [
      ["timestamp", "original", "statuscode", "mimetype"],
      ["20260909000000", original, "200", "text/html"],
    ];
    const checker = new LinkChecker(
      {
        fetch: async (url) =>
          response(
            200,
            url.includes("/cdx/") ? JSON.stringify(rows) : html(),
            url,
          ),
      },
      defaultSettings,
    );
    expect(
      await new WaybackProvider(checker).discover(link(), ["#Missing"]),
    ).toEqual({ kind: "missing" });
    const outage = new LinkChecker(
      {
        fetch: async (url) =>
          url.includes("/cdx/")
            ? response(200, JSON.stringify(rows), url)
            : response(503),
      },
      defaultSettings,
    );
    expect(await new WaybackProvider(outage).discover(link(), [""])).toEqual({
      kind: "unavailable",
    });
  });
});

describe("Grokipedia matching", () => {
  const original = "https://en.wikipedia.org/wiki/Example_article";
  const target = "https://grokipedia.com/page/Example_article";
  async function discover(
    sourceHtml: string,
    targetHtml: string,
    fragments = ["#History"],
    url = original,
  ) {
    const checker = new LinkChecker(
      { fetch: async (url) => response(200, targetHtml, url) },
      defaultSettings,
      () => NOW,
    );
    const link = newLink("wiki", url, NOW);
    link.lastCheck = {
      kind: "healthy",
      checkedAt: NOW,
      finalUrl: url,
      status: 200,
      contentType: "text/html",
      evidence: pageEvidence(sourceHtml, url),
    };
    return new GrokipediaProvider(checker, () => NOW).discover(link, fragments);
  }
  it("requires visible article evidence beyond the URL slug", async () => {
    const source = html("Example article", "en", original);
    expect(
      await discover(source, html("Example article", "en", target)),
    ).toMatchObject({ kind: "found" });
    expect(
      await discover(
        source,
        html("Example article", "en", target).replace(
          /<p>.*<\/p>/u,
          "<p>Different</p>",
        ),
      ),
    ).toEqual({ kind: "ambiguous" });
  });
  it("rejects language mismatch and retains German destinations", async () => {
    const de = "https://de.wikipedia.org/wiki/Example_article";
    expect(
      await discover(
        html("Example article", "de", de),
        html("Example article", "en", target),
        [""],
        de,
      ),
    ).toEqual({ kind: "ambiguous" });
    expect(
      await discover(
        html("Example article", "de", de),
        html("Example article", "de", target),
        [""],
        de,
      ),
    ).toMatchObject({ kind: "found" });
  });
  it("rejects unmatched sections and historical revisions", async () => {
    expect(
      await discover(
        html("Example article", "en", original),
        html("Example article", "en", target),
        ["#Missing"],
      ),
    ).toEqual({ kind: "ambiguous" });
    expect(
      await discover(html(), html(), [""], `${original}?oldid=42`),
    ).toEqual({ kind: "ambiguous" });
    expect(
      await discover(
        html(),
        html(),
        [""],
        "https://de.wikipedia.org/w/index.php?title=Example&oldid=42",
      ),
    ).toEqual({ kind: "ambiguous" });
    expect(
      await discover(html(), html(), [""], "https://en.wikipedia.org/wiki/%FF"),
    ).toEqual({ kind: "ambiguous" });
  });
  it("rejects disambiguation and mismatching canonical identities", () => {
    const source = pageEvidence(
      html("Example article", "en", original),
      original,
    );
    const other = pageEvidence(html("Example article", "en", target), target);
    expect(
      sameArticle({ ...source, disambiguation: true }, other, original),
    ).toBe(false);
    expect(
      sameArticle(
        { ...source, canonical: "https://en.wikipedia.org/wiki/Other" },
        other,
        original,
      ),
    ).toBe(false);
  });
});

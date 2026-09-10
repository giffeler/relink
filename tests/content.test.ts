import { describe, expect, it } from "vitest";
import { extractOccurrences } from "../src/core/extract.js";
import { rewriteLinks } from "../src/core/html.js";
import { effectiveDestination, csvCell } from "../src/core/api.js";
import { defaultSettings } from "../src/core/schema.js";
import { newLink } from "../src/core/engine.js";
import { options } from "./helpers.js";

describe("published occurrences and rendering", () => {
  it("indexes repeated Portable Text links, supported custom blocks and explicit fields without changing content", async () => {
    const data = {
      website: "https://external.example/article",
      content: [
        {
          _type: "block",
          markDefs: [
            {
              _type: "link",
              _key: "a",
              href: "https://external.example/article#History",
            },
          ],
          children: [
            { text: "First", marks: ["a"] },
            { text: "separator", marks: [] },
            { text: "Second", marks: ["a"] },
          ],
        },
        { _type: "cta", url: "https://external.example/article" },
        { _type: "image", src: "https://media.example/image.png" },
      ],
    };
    const before = JSON.stringify(data);
    const source = options.sources[0];
    if (!source) throw new Error("Fixture source");
    const result = await extractOccurrences(
      { id: "p", slug: "p", locale: "de", title: "Title", data },
      source,
      options.siteUrl,
      "g",
    );
    expect(result).toHaveLength(4);
    expect(new Set(result.map((entry) => entry.linkId)).size).toBe(1);
    expect(result.map((entry) => entry.text)).toContain("Second");
    expect(JSON.stringify(data)).toBe(before);
  });
  it("changes only matching anchor attributes and preserves HTML and fragments", () => {
    const input =
      '<!doctype html><p><a class="x" href="https://external.example/a#History">Source</a><img src="https://external.example/a#History"></p><script>const a="https://external.example/a#History";</script>';
    const output = rewriteLinks(
      input,
      new Map([
        [
          "https://external.example/a#History",
          "https://archive.example/c?a=1&b=2#History",
        ],
      ]),
      options.siteUrl,
    );
    expect(output).toBe(
      input.replace(
        'href="https://external.example/a#History"',
        'href="https://archive.example/c?a=1&amp;b=2#History"',
      ),
    );
    expect(rewriteLinks(input, new Map(), options.siteUrl)).toBe(input);
  });
  it("only applies sections that were verified and respects presentation exclusions", () => {
    const link = newLink("a", "https://example.com/a", 0);
    link.replacement = {
      kind: "archive",
      url: "https://web.archive.org/web/20200101000000/https://example.com/a",
      verifiedAt: 0,
      snapshotAt: 0,
      reason: "confirmed-failures",
      fragments: ["", "#History"],
      evidence: null,
    };
    expect(
      effectiveDestination(link, `${link.url}#History`, defaultSettings),
    ).toContain("/web/");
    expect(effectiveDestination(link, `${link.url}#New`, defaultSettings)).toBe(
      `${link.url}#New`,
    );
    expect(
      effectiveDestination(link, link.url, {
        ...defaultSettings,
        enabled: false,
      }),
    ).toBe(link.url);
    link.excluded = true;
    expect(effectiveDestination(link, link.url, defaultSettings)).toBe(
      link.url,
    );
  });
  it("neutralizes spreadsheet formulas and quotes", () => {
    expect(csvCell('=HYPERLINK("evil")')).toBe('"\'=HYPERLINK(""evil"")"');
  });
});

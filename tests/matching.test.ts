import { describe, expect, it, vi } from "vitest";
import {
  SimilarityProvider,
  titleSimilarity,
  identityConflict,
} from "../src/core/matching.js";
import { LocalSemanticScorer, SEMANTIC_MODEL } from "../src/core/semantic.js";
import { LinkChecker } from "../src/core/http.js";
import { newLink } from "../src/core/engine.js";
import {
  defaultSettings,
  linkSchema,
  occurrenceSchema,
} from "../src/core/schema.js";
import { pageEvidence } from "../src/core/html.js";
import { html, NOW, response } from "./helpers.js";

const sourceUrl = "https://en.wikipedia.org/wiki/Example_article";
const targetUrl = "https://grokipedia.com/page/Example_article";
function fixture({
  alias = false,
  competitor = false,
  searchFails = false,
  targetStatus = 200,
  fragments = [""] as readonly string[],
  score = 0.9,
  wrongLanguage = false,
  conflict = false,
  scorerFails = false,
} = {}) {
  const source = pageEvidence(
    html("Example article", "en", sourceUrl),
    sourceUrl,
  );
  const target = alias
    ? "https://grokipedia.com/page/Alternative_title"
    : targetUrl;
  const title = alias ? "Alternative title" : "Example article";
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("/w/api.php"))
      return response(
        200,
        JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "Example article",
                fullurl: sourceUrl,
                redirects: alias ? [{ title }] : [],
              },
            },
          },
        }),
        url,
      );
    if (url.includes("/api/"))
      return response(
        searchFails ? 503 : 200,
        JSON.stringify({
          results: [
            { slug: alias ? "Alternative_title" : "Example_article", title },
            ...(competitor ? [{ slug: "Other_example_article", title }] : []),
          ],
        }),
        url,
      );
    if (url === targetUrl && alias) return response(404, "", url);
    return response(
      targetStatus,
      html(
        title,
        wrongLanguage ? "de" : "en",
        competitor ? url : target,
      ).replace(
        "Astronomy explores",
        conflict
          ? "Mercury is a chemical element. Astronomy explores"
          : "Astronomy explores",
      ),
      url,
    );
  });
  if (conflict)
    source.introduction = "Mercury is a planet. " + source.introduction;
  const scorer = {
    score: vi.fn(async (_source: string, candidates: readonly string[]) => {
      if (scorerFails) throw new Error("Offline");
      return { model: SEMANTIC_MODEL, scores: candidates.map(() => score) };
    }),
  };
  const link = newLink("wiki", sourceUrl, NOW);
  link.lastCheck = {
    kind: "healthy",
    checkedAt: NOW,
    finalUrl: sourceUrl,
    status: 200,
    contentType: "text/html",
    evidence: source,
  };
  return {
    fetch,
    scorer,
    link,
    run: () =>
      new SimilarityProvider(
        new LinkChecker({ fetch }, defaultSettings, () => NOW),
        scorer,
        () => NOW,
      ).discover(link, fragments),
  };
}
describe("local article matching", () => {
  it("resolves a verified Wikipedia alias to a differently named Grokipedia article", async () => {
    const f = fixture({ alias: true });
    const result = await f.run();
    expect(result).toMatchObject({
      kind: "found",
      replacement: { url: "https://grokipedia.com/page/Alternative_title" },
      assessment: {
        model: SEMANTIC_MODEL,
        status: "matched",
        searchComplete: true,
      },
    });
    expect(f.scorer.score).toHaveBeenCalledTimes(1);
  });
  it("keeps equally plausible same-title articles in review", async () => {
    expect(await fixture({ competitor: true }).run()).toMatchObject({
      kind: "ambiguous",
      reason: "multiple-candidates",
      assessment: { suggestion: null },
    });
  });
  it("does not reinterpret a blocked Wikipedia source as a typo", async () => {
    const f = fixture();
    f.link.lastCheck = {
      kind: "unverifiable",
      reason: "blocked",
      checkedAt: NOW,
      finalUrl: sourceUrl,
      status: 403,
      retryAt: null,
    };
    expect(await f.run()).toMatchObject({
      kind: "unavailable",
      reason: "source-evidence-missing",
    });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    [{ searchFails: true }, "unavailable", "search-unavailable"],
    [{ scorerFails: true }, "unavailable", "semantic-unavailable"],
    [{ fragments: ["#Missing"] }, "ambiguous", "article-mismatch"],
    [{ score: 0.65 }, "ambiguous", "article-mismatch"],
  ] as const)(
    "keeps uncertain outcomes out of automatic replacements",
    async (options, kind, reason) => {
      const r = await fixture(options).run();
      expect(r).toMatchObject({ kind, reason });
      expect(r).not.toHaveProperty("replacement");
      expect(r.assessment?.suggestion).toBeNull();
    },
  );
  it("does not accept high semantic scores across languages or explicit identity conflicts", async () => {
    for (const options of [{ wrongLanguage: true }, { conflict: true }]) {
      const result = await fixture(options).run();
      expect(result.kind).toBe("missing");
      expect(result.assessment?.candidates[0]?.decision).toBe("rejected");
    }
  });
  it("creates a reviewable suggestion only after successful searches and confirmed missing targets", async () => {
    const f = fixture({ targetStatus: 404 });
    const result = await f.run();
    expect(result).toMatchObject({
      kind: "missing",
      assessment: {
        searchComplete: true,
        suggestion: {
          state: "draft",
          topic: "Example article",
          url: "https://grokipedia.com/suggest?q=Example%20article",
        },
      },
    });
    expect(f.fetch.mock.calls.every(([url]) => !url.includes("/suggest"))).toBe(
      true,
    );
    f.link.matching = result.assessment ?? null;
    if (!f.link.matching?.suggestion) throw new Error("Missing draft");
    f.link.matching.suggestion.state = "submitted";
    f.link.matching.suggestion.submittedAt = NOW;
    expect((await f.run()).assessment?.suggestion).toMatchObject({
      state: "submitted",
      submittedAt: NOW,
    });
  });
  it("does not turn target blocking into a missing-article suggestion", async () => {
    expect(await fixture({ targetStatus: 403 }).run()).toMatchObject({
      kind: "unavailable",
      assessment: { suggestion: null, searchComplete: false },
    });
  });
  it("does not search historical revisions or namespace URLs", async () => {
    const f = fixture();
    f.link.url = sourceUrl + "?oldid=123";
    expect(await f.run()).toMatchObject({
      kind: "ambiguous",
      reason: "unsupported-source",
    });
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("treats similar titles and different birth years as separate signals", () => {
    expect(titleSimilarity("Dietrich_Dörner", "Dietrich Dorner")).toBe(1);
    const a = pageEvidence(html(), sourceUrl);
    expect(
      identityConflict(
        { ...a, introduction: "John Smith (born 1938) is an author." },
        { ...a, introduction: "John Smith (born 1964) is an author." },
      ),
    ).toBe(true);
  });
  it("loads old records without a migration", () => {
    const original = newLink("legacy", sourceUrl, NOW);
    const old = Object.fromEntries(
      Object.entries(original).filter(([key]) => key !== "matching"),
    );
    expect(linkSchema.parse(old).matching).toBeNull();
  });
  it("repairs a typo only with published context and a clear lead", async () => {
    const link = newLink(
      "typo",
      "https://en.wikipedia.org/wiki/Exampl_article",
      NOW,
    );
    link.lastCheck = {
      kind: "broken",
      checkedAt: NOW,
      finalUrl: link.url,
      status: 404,
      reason: "not-found",
    };
    const fetch = async (url: string) => {
      if (url.includes("list=search"))
        return response(
          200,
          JSON.stringify({ query: { search: [{ title: "Example article" }] } }),
          url,
        );
      if (url.includes("/w/api.php"))
        return response(
          200,
          JSON.stringify({
            query: {
              pages: { "1": { title: "Example article", fullurl: sourceUrl } },
            },
          }),
          url,
        );
      if (url.includes("grokipedia.com/api"))
        return response(200, JSON.stringify({ results: [] }), url);
      if (url.includes("grokipedia.com")) return response(404, "", url);
      return response(200, html("Example article", "en", sourceUrl), url);
    };
    const scorer = {
      score: async () => ({ model: SEMANTIC_MODEL, scores: [0.94] }),
    };
    const provider = new SimilarityProvider(
      new LinkChecker({ fetch }, defaultSettings),
      scorer,
      () => NOW,
    );
    expect(await provider.discover(link, [""])).toMatchObject({
      kind: "ambiguous",
      reason: "source-ambiguous",
    });
    const occurrence = occurrenceSchema.parse({
      schemaVersion: 1,
      id: "o",
      linkId: link.id,
      originalUrl: link.url,
      collection: "posts",
      contentId: "p",
      slug: "p",
      locale: "en",
      title: "Post",
      path: "content[0]",
      text: "Example article",
      context:
        "A detailed discussion of planetary systems, gravitational interactions and scientific observations.",
      pagePath: "/p",
      generation: "g",
    });
    expect(await provider.discover(link, [""], [occurrence])).toMatchObject({
      kind: "found",
      replacement: { kind: "wikipedia", url: sourceUrl },
      assessment: { sourceCorrected: true, suggestion: { state: "draft" } },
    });
  });
  it("fails closed when the configured local socket is unavailable", async () => {
    await expect(
      new LocalSemanticScorer("/tmp/relink-nonexistent-test.sock").score(
        "source",
        ["target"],
      ),
    ).rejects.toThrow();
  });
});

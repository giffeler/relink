import { expect, it } from "vitest";
import { RelinkEngine, newLink } from "../src/core/engine.js";
import { pageEvidence } from "../src/core/html.js";
import { LinkChecker } from "../src/core/http.js";
import {
  defaultSettings,
  DAY,
  matchAssessmentSchema,
} from "../src/core/schema.js";
import type { DiscoveryResult } from "../src/core/providers.js";
import { effectiveDestination } from "../src/core/api.js";
import {
  contentAccess,
  createTestStore,
  html,
  NOW,
  options,
  response,
} from "./helpers.js";

it("persists matching evidence, applies verified rules, removes uncertain rules and preserves manual decisions", async () => {
  const { store, db } = await createTestStore();
  try {
    const url = "https://en.wikipedia.org/wiki/Example_article";
    const destination = "https://grokipedia.com/page/Example_article";
    const settings = { ...defaultSettings, grokipediaEnabled: true };
    const transport = {
      fetch: async () => response(200, html("Example article", "en", url), url),
    };
    const link = newLink("wiki", url, NOW);
    const assessment = matchAssessmentSchema.parse({
      checkedAt: NOW,
      status: "matched",
      reason: "identity-language-match",
      sourceUrl: url,
      sourceTitle: "Example article",
      sourceCorrected: false,
      model: "local",
      queries: ["Example article"],
      searchComplete: true,
      candidates: [],
      suggestion: null,
    });
    let result: DiscoveryResult = {
      kind: "found",
      assessment,
      replacement: {
        kind: "grokipedia",
        url: destination,
        verifiedAt: NOW,
        reason: "identity-language-match",
        fragments: [""],
        evidence: pageEvidence(html(), "https://external.example/article"),
      },
    };
    let calls = 0;
    const engine = new RelinkEngine({
      store,
      content: contentAccess([]),
      transport,
      options: { ...options, matching: { socketPath: "/run/test.sock" } },
      clock: () => NOW,
      encyclopedia: {
        discover: async () => {
          calls++;
          return result;
        },
      },
    });
    const checker = new LinkChecker(transport, settings, () => NOW);
    await engine.checkLink(link, settings, checker);
    expect(effectiveDestination(link, url, settings)).toBe(destination);
    expect((await store.history.all())[0]?.matching?.status).toBe("matched");
    result = {
      kind: "unavailable",
      reason: "semantic-unavailable",
      assessment: {
        ...assessment,
        status: "unavailable",
        reason: "semantic-unavailable",
      },
    };
    await engine.checkLink(link, settings, checker);
    expect(link.replacement).toBeNull();
    expect(link.review?.reason).toBe("grokipedia-ambiguous");
    link.automaticDisabled = true;
    await engine.checkLink(link, settings, checker);
    expect(calls).toBe(2);
    link.automaticDisabled = false;
    link.replacement = {
      kind: "manual",
      url: destination,
      verifiedAt: NOW,
      reason: "editor-override",
    };
    await engine.checkLink(link, settings, checker);
    expect(calls).toBe(2);
    expect(link.replacement.kind).toBe("manual");
  } finally {
    await db.destroy();
  }
});

it("marks a draft locally without making an external request", async () => {
  const { store, db } = await createTestStore();
  try {
    const link = newLink(
      "wiki",
      "https://en.wikipedia.org/wiki/Example_article",
      NOW,
    );
    link.nextCheckAt = NOW + DAY;
    link.matching = matchAssessmentSchema.parse({
      checkedAt: NOW,
      status: "missing",
      reason: "no-suitable-match",
      sourceUrl: link.url,
      sourceTitle: "Example article",
      sourceCorrected: false,
      model: null,
      queries: [],
      searchComplete: true,
      candidates: [],
      suggestion: {
        topic: "Example article",
        notes: "Review",
        url: "https://grokipedia.com/suggest?q=Example",
        state: "draft",
        submittedAt: null,
      },
    });
    await store.links.put(link.id, link);
    await store.commands.put("submitted", {
      id: "submitted",
      createdAt: NOW,
      input: { action: "suggestion-submitted", linkId: link.id },
    });
    let requests = 0;
    const engine = new RelinkEngine({
      store,
      content: contentAccess([]),
      transport: {
        fetch: async () => {
          requests++;
          return response();
        },
      },
      options,
      clock: () => NOW,
    });
    await engine.tick();
    expect(
      (await store.links.get(link.id))?.matching?.suggestion,
    ).toMatchObject({ state: "submitted", submittedAt: NOW });
    expect(requests).toBe(0);
  } finally {
    await db.destroy();
  }
});

it("gates Wikipedia typo corrections and preserves only verified fragments", () => {
  const link = newLink("typo", "https://en.wikipedia.org/wiki/Exampel", NOW);
  link.replacement = {
    kind: "wikipedia",
    url: "https://en.wikipedia.org/wiki/Example",
    verifiedAt: NOW,
    reason: "verified-title-correction",
    fragments: ["", "#History"],
    evidence: pageEvidence(html(), "https://external.example/article"),
  };
  const settings = { ...defaultSettings, grokipediaEnabled: true };
  expect(effectiveDestination(link, link.url + "#History", settings)).toBe(
    link.replacement.url + "#History",
  );
  expect(effectiveDestination(link, link.url + "#Missing", settings)).toBe(
    link.url + "#Missing",
  );
  expect(effectiveDestination(link, link.url, defaultSettings)).toBe(link.url);
});

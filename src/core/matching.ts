import { z } from "zod";
import type { LinkChecker } from "./http.js";
import type {
  EncyclopediaProvider,
  DiscoveryResult,
  DiscoveryReason,
} from "./providers.js";
import { hasFragments } from "./providers.js";
import type {
  LinkRecord,
  LinkOccurrence,
  PageEvidence,
  MatchAssessment,
  MatchCandidate,
  ReplacementRule,
} from "./schema.js";
import type { SemanticScorer } from "./semantic.js";
import { baseLanguage, checkUrl } from "./url.js";

export function titleKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s*[-–—|]\s*(wikipedia|grokipedia).*$/iu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 500);
}
/** Character edit similarity is a discovery signal, never identity evidence alone. */
export function titleSimilarity(a: string, b: string): number {
  a = titleKey(a);
  b = titleKey(b);
  if (!a || !b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        (next[j - 1] ?? 0) + 1,
        (row[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return 1 - (row[b.length] ?? 0) / Math.max(a.length, b.length);
}
function subjectType(text: string): string | null {
  const lead = text.slice(0, 300).toLowerCase();
  if (/\bborn\b|\bgeboren\b/u.test(lead)) return "person";
  for (const type of [
    "short story",
    "novel",
    "chemical element",
    "planet",
    "quran",
    "film",
  ])
    if (lead.includes(type)) return type;
  return null;
}
function birthYear(text: string): string | undefined {
  return /\b(?:born|geboren)\b[^.;)]{0,80}?\b((?:1[5-9]|20)\d{2})\b/iu.exec(
    text,
  )?.[1];
}
export function identityConflict(a: PageEvidence, b: PageEvidence): boolean {
  const x = subjectType(a.introduction),
    y = subjectType(b.introduction);
  const ax = birthYear(a.introduction),
    by = birthYear(b.introduction);
  return Boolean((x && y && x !== y) || (ax && by && ax !== by));
}
function text(evidence: PageEvidence): string {
  return `${evidence.title}\n${evidence.introduction}`.slice(0, 2500);
}
function validArticle(url: string, host: string, prefix: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      u.hostname === host &&
      !u.search &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith(prefix) &&
      u.pathname.length > prefix.length &&
      !decodeURIComponent(u.pathname.slice(prefix.length)).includes(":")
    );
  } catch {
    return false;
  }
}
function wikiUrl(host: string, title: string): string {
  return `https://${host}/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
}
function grokUrl(slug: string): string {
  return `https://grokipedia.com/page/${encodeURIComponent(decodeURIComponent(slug))}`;
}
const wikiPage = z.object({
  title: z.string().max(500),
  fullurl: z.string().optional(),
  missing: z.unknown().optional(),
  redirects: z.array(z.object({ title: z.string().max(500) })).optional(),
});
const wikiInfo = z.object({
  query: z.object({ pages: z.record(z.string(), wikiPage) }),
});
const wikiSearch = z.object({
  query: z.object({
    search: z.array(z.object({ title: z.string().max(500) })).max(20),
    searchinfo: z
      .object({ suggestion: z.string().max(500).optional() })
      .optional(),
  }),
});
const grokSearch = z.object({
  results: z
    .array(
      z.object({
        slug: z.string().min(1).max(1000),
        title: z.string().max(500),
      }),
    )
    .max(20),
});

export class SimilarityProvider implements EncyclopediaProvider {
  constructor(
    private readonly checker: LinkChecker,
    private readonly scorer: SemanticScorer,
    private readonly clock: () => number = Date.now,
  ) {}
  private async json(url: string): Promise<unknown> {
    const response = await this.checker.request(url);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("Search unavailable");
    }
    return JSON.parse(await this.checker.read(response)) as unknown;
  }
  private async article(
    url: string,
    host: string,
    prefix: string,
  ): Promise<PageEvidence | null> {
    const result = await this.checker.check(url);
    if (result.kind === "broken" && result.reason === "not-found") return null;
    if (
      result.kind !== "healthy" ||
      !result.evidence ||
      !result.evidence.title ||
      result.evidence.title.length > 500 ||
      !result.evidence.introduction
    )
      throw new Error("Article unavailable");
    const e = result.evidence;
    if (
      !validArticle(result.finalUrl, host, prefix) ||
      !validArticle(e.canonical, host, prefix)
    )
      throw new Error("Unexpected article identity");
    return e;
  }
  async discover(
    link: LinkRecord,
    fragments: readonly string[],
    occurrences: readonly LinkOccurrence[] = [],
  ): Promise<DiscoveryResult> {
    const input = new URL(link.url);
    if (
      !/^[a-z-]+\.(?:m\.)?wikipedia\.org$/u.test(input.hostname) ||
      !validArticle(link.url, input.hostname, "/wiki/")
    )
      return { kind: "ambiguous", reason: "unsupported-source" };
    const language = input.hostname.split(".")[0] ?? "";
    const wikiHost = `${language}.wikipedia.org`;
    const originalTitle = decodeURIComponent(
      input.pathname.slice(6),
    ).replaceAll("_", " ");
    if (originalTitle.length > 500)
      return { kind: "ambiguous", reason: "unsupported-source" };
    const assessment: MatchAssessment = {
      checkedAt: this.clock(),
      status: "review",
      reason: "source-ambiguous",
      sourceUrl: null,
      sourceTitle: originalTitle,
      sourceCorrected: false,
      model: null,
      queries: [],
      searchComplete: false,
      candidates: [],
      suggestion: null,
    };
    const finish = (
      kind: "missing" | "unavailable" | "ambiguous",
      reason: DiscoveryReason,
    ): DiscoveryResult => {
      assessment.status = kind === "ambiguous" ? "review" : kind;
      assessment.reason = reason;
      const previous = link.matching?.suggestion;
      if (
        previous?.state === "submitted" &&
        previous.topic === assessment.sourceTitle
      )
        assessment.suggestion = previous;
      return { kind, reason, assessment };
    };
    let source =
      link.lastCheck?.kind === "healthy" ? link.lastCheck.evidence : null;
    let corrected: PageEvidence | null = null;
    if (!source) {
      // Search is permitted only for a confirmed missing source, never a block/outage.
      if (
        link.lastCheck?.kind !== "broken" ||
        link.lastCheck.reason !== "not-found"
      )
        return finish("unavailable", "source-evidence-missing");
      try {
        const params = new URLSearchParams({
          action: "query",
          list: "search",
          srsearch: originalTitle,
          srnamespace: "0",
          srlimit: "5",
          srinfo: "suggestion",
          format: "json",
        });
        assessment.queries.push(originalTitle);
        const result = wikiSearch.parse(
          await this.json(`https://${wikiHost}/w/api.php?${params}`),
        );
        const titles = [
          ...new Set([
            ...(result.query.searchinfo?.suggestion
              ? [result.query.searchinfo.suggestion]
              : []),
            ...result.query.search.map((p) => p.title),
          ]),
        ].slice(0, 5);
        const evidence: PageEvidence[] = [];
        for (const title of titles) {
          const e = await this.article(
            wikiUrl(wikiHost, title),
            wikiHost,
            "/wiki/",
          );
          if (e && !e.disambiguation && baseLanguage(e.language) === language)
            evidence.push(e);
        }
        const context = occurrences
          .slice(0, 3)
          .map((o) => o.context || o.text)
          .join(" ")
          .slice(0, 1800);
        const scores = evidence.length
          ? await this.scorer.score(
              `${originalTitle}\n${context}`,
              evidence.map(text),
            )
          : null;
        assessment.model = scores?.model ?? null;
        assessment.candidates = evidence
          .map((e, i) => ({
            url: e.canonical,
            title: e.title,
            score: scores?.scores[i] ?? null,
            titleScore: titleSimilarity(originalTitle, e.title),
            decision: "review" as const,
            reason: "source-ambiguous",
          }))
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const best = assessment.candidates[0];
        // Automatic source repair is restricted to near-identical titles plus
        // independent published-link context and a clear semantic lead.
        if (
          !best ||
          context.length < 40 ||
          best.titleScore < 0.88 ||
          (best.score ?? 0) < 0.72 ||
          (assessment.candidates[1] &&
            (best.score ?? 0) - (assessment.candidates[1].score ?? 0) < 0.08)
        )
          return finish("ambiguous", "source-ambiguous");
        source = evidence.find((e) => e.canonical === best.url) ?? null;
        if (!source || !hasFragments(source, fragments))
          return finish("ambiguous", "fragment-mismatch");
        corrected = source;
        assessment.sourceCorrected = true;
      } catch {
        return finish("unavailable", "search-unavailable");
      }
    }
    if (
      !source.title ||
      source.title.length > 500 ||
      !source.introduction ||
      source.disambiguation ||
      baseLanguage(source.language) !== language ||
      !validArticle(source.canonical, wikiHost, "/wiki/")
    )
      return finish("ambiguous", "source-evidence-missing");
    if (
      new URL(source.canonical).hash &&
      !fragments.includes(new URL(source.canonical).hash)
    )
      return finish("ambiguous", "fragment-mismatch");
    assessment.sourceUrl = source.canonical;
    assessment.sourceTitle = source.title;
    assessment.candidates = [];
    let aliases: string[];
    try {
      const params = new URLSearchParams({
        action: "query",
        prop: "info|redirects",
        redirects: "1",
        titles: decodeURIComponent(
          new URL(source.canonical).pathname.slice(6),
        ).replaceAll("_", " "),
        inprop: "url",
        rdlimit: "50",
        format: "json",
      });
      const result = wikiInfo.parse(
        await this.json(`https://${wikiHost}/w/api.php?${params}`),
      );
      const page = Object.values(result.query.pages).find(
        (p) =>
          p.missing === undefined &&
          p.fullurl &&
          checkUrl(p.fullurl) === checkUrl(source.canonical),
      );
      if (!page) return finish("ambiguous", "canonical-mismatch");
      aliases = [
        ...new Set([
          source.title,
          page.title,
          ...(page.redirects ?? []).map((p) => p.title),
        ]),
      ];
    } catch {
      return finish("unavailable", "search-unavailable");
    }
    const queries = [...new Set([source.title, originalTitle])].slice(0, 2);
    // When redirects give the same title, a simplified form is a second search.
    if (queries.length === 1) {
      const simple = source.title.replace(/\s*\([^)]*\)/gu, "").trim();
      if (simple !== source.title) queries.push(simple);
    }
    assessment.queries.push(...queries);
    const candidates = new Map<string, string>();
    candidates.set(
      grokUrl(new URL(source.canonical).pathname.slice(6)),
      source.title,
    );
    let complete = true;
    for (const query of queries) {
      for (const endpoint of ["typeahead", "full-text-search"]) {
        try {
          const params = new URLSearchParams({
            v: "2",
            query,
            limit: "5",
            offset: "0",
          });
          const found = grokSearch.parse(
            await this.json(`https://grokipedia.com/api/${endpoint}?${params}`),
          );
          for (const p of found.results) {
            const url = grokUrl(p.slug);
            if (validArticle(url, "grokipedia.com", "/page/"))
              candidates.set(url, p.title);
          }
        } catch {
          complete = false;
        }
      }
    }
    const shortlist = [...candidates]
      .sort(
        (a, b) =>
          Math.max(...aliases.map((t) => titleSimilarity(t, b[1]))) -
          Math.max(...aliases.map((t) => titleSimilarity(t, a[1]))),
      )
      .slice(0, 5);
    const targets = new Map<string, PageEvidence>();
    for (const [url] of shortlist) {
      try {
        const e = await this.article(url, "grokipedia.com", "/page/");
        if (e) targets.set(checkUrl(e.canonical), e);
      } catch {
        complete = false;
      }
    }
    assessment.searchComplete = complete;
    const entries = [...targets];
    let scores: number[] = [];
    if (entries.length) {
      try {
        const result = await this.scorer.score(
          text(source),
          entries.map(([, e]) => text(e)),
        );
        assessment.model = result.model;
        scores = result.scores;
      } catch {
        return finish("unavailable", "semantic-unavailable");
      }
    }
    const sourceEvidence = source;
    assessment.candidates = entries
      .map(([url, e], i): MatchCandidate => {
        const score = scores[i] ?? -1;
        const titleScore = Math.max(
          ...aliases.map((t) => titleSimilarity(t, e.title)),
        );
        let reason = "article-mismatch";
        let decision: MatchCandidate["decision"] = "rejected";
        if (baseLanguage(e.language) !== language) reason = "language-mismatch";
        else if (e.disambiguation || identityConflict(sourceEvidence, e))
          reason = "identity-conflict";
        else if (!hasFragments(e, fragments)) {
          reason = "fragment-mismatch";
          decision = "review";
        } else if (titleScore >= 0.88 && score >= 0.78) {
          reason = "identity-language-match";
          decision = "eligible";
        } else if ((titleScore >= 0.65 && score >= 0.55) || score >= 0.72) {
          reason = "article-mismatch";
          decision = "review";
        }
        return { url, title: e.title, score, titleScore, decision, reason };
      })
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    if (!complete) return finish("unavailable", "search-unavailable");
    const best = assessment.candidates.find((c) => c.decision === "eligible");
    if (best) {
      if (
        assessment.candidates.some(
          (c) =>
            c.url !== best.url &&
            c.decision !== "rejected" &&
            (c.score ?? -1) >= (best.score ?? 0) - 0.06,
        )
      )
        return finish("ambiguous", "multiple-candidates");
      const evidence = targets.get(best.url);
      if (!evidence) return finish("unavailable", "target-evidence-missing");
      assessment.status = "matched";
      assessment.reason = "identity-language-match";
      return {
        kind: "found",
        reason: "identity-language-match",
        assessment,
        replacement: {
          kind: "grokipedia",
          url: best.url,
          verifiedAt: this.clock(),
          reason: "identity-language-match",
          fragments: [...fragments],
          evidence,
        },
      };
    }
    if (assessment.candidates.some((c) => c.decision === "review"))
      return finish("ambiguous", "article-mismatch");
    const previous = link.matching?.suggestion;
    assessment.suggestion =
      previous?.topic === source.title
        ? previous
        : {
            topic: source.title,
            notes:
              `Topic: ${source.title}\nLanguage: ${source.language}\nReference: ${source.canonical}\n\nScope: the specific subject of the reference article, preserving its distinctions from broader or related topics.\nAlternative names: ${aliases.slice(0, 8).join("; ")}\n\nNo suitable match was found in the recorded title and full-text searches. Please verify that the topic is not already covered under another name.`.slice(
                0,
                3000,
              ),
            url: `https://grokipedia.com/suggest?q=${encodeURIComponent(source.title)}`,
            state: "draft",
            submittedAt: null,
          };
    if (corrected) {
      assessment.status = "missing";
      assessment.reason = "no-suitable-match";
      const replacement: ReplacementRule = {
        kind: "wikipedia",
        url: checkUrl(corrected.canonical),
        verifiedAt: this.clock(),
        reason: "verified-title-correction",
        fragments: [...fragments],
        evidence: corrected,
      };
      return {
        kind: "found",
        reason: "verified-title-correction",
        assessment,
        replacement,
      };
    }
    return finish("missing", "no-suitable-match");
  }
}

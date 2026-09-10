import { z } from "zod";
import type { LinkChecker } from "./http.js";
import { baseLanguage, checkUrl, normalizeUrl } from "./url.js";
import type {
  CheckResult,
  LinkRecord,
  PageEvidence,
  ReplacementRule,
} from "./schema.js";

export type DiscoveryResult =
  | { kind: "found"; replacement: ReplacementRule }
  | { kind: "missing" }
  | { kind: "unavailable" }
  | { kind: "ambiguous" };
export interface ArchiveProvider {
  discover(
    link: LinkRecord,
    fragments: readonly string[],
  ): Promise<DiscoveryResult>;
}
export interface EncyclopediaProvider {
  discover(
    link: LinkRecord,
    fragments: readonly string[],
  ): Promise<DiscoveryResult>;
}

function captureDate(value: string): number | null {
  if (!/^\d{14}$/u.test(value)) return null;
  const date = Date.parse(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`,
  );
  return Number.isNaN(date) ? null : date;
}
function hasFragments(
  evidence: PageEvidence | null,
  fragments: readonly string[],
): boolean {
  return fragments.every((fragment) => {
    try {
      return (
        !fragment ||
        (evidence?.anchors.includes(
          decodeURIComponent(fragment.replace(/^#/u, "")),
        ) ??
          false)
      );
    } catch {
      return false;
    }
  });
}
export class WaybackProvider implements ArchiveProvider {
  constructor(
    private readonly checker: LinkChecker,
    private readonly clock: () => number = Date.now,
  ) {}
  async discover(
    link: LinkRecord,
    fragments: readonly string[],
  ): Promise<DiscoveryResult> {
    const before = link.firstFailureAt ?? this.clock();
    const to = new Date(before)
      .toISOString()
      .replace(/[-:TZ.]/gu, "")
      .slice(0, 14);
    const params = new URLSearchParams({
      url: link.url,
      matchType: "exact",
      output: "json",
      fl: "timestamp,original,statuscode,mimetype",
      filter: "statuscode:200",
      to,
      limit: "-3",
    });
    try {
      const response = await this.checker.request(
        `https://web.archive.org/cdx/search/cdx?${params.toString()}`,
      );
      if (!response.ok) {
        await response.body?.cancel();
        return { kind: "unavailable" };
      }
      const raw: unknown = JSON.parse(await this.checker.read(response));
      const rows = z.array(z.array(z.string())).parse(raw);
      const captures = rows
        .slice(1)
        .flatMap((row) => {
          const [stamp, original, status, mime] = row;
          const at = stamp ? captureDate(stamp) : null;
          if (
            !stamp ||
            !original ||
            status !== "200" ||
            at === null ||
            at > before ||
            checkUrl(original) !== link.url ||
            !mime ||
            !/html|pdf|plain/iu.test(mime)
          )
            return [];
          return [{ at, stamp, original }];
        })
        .sort((a, b) => b.at - a.at);
      for (const capture of captures) {
        const url = `https://web.archive.org/web/${capture.stamp}/${capture.original}`;
        const result = await this.checker.check(url, true, "GET");
        if (
          result.kind === "unverifiable" ||
          (result.kind === "broken" && result.reason !== "not-found")
        )
          return { kind: "unavailable" };
        if (
          result.kind !== "healthy" ||
          !hasFragments(result.evidence, fragments)
        )
          continue;
        const final = new URL(result.finalUrl);
        const expected = `/web/${capture.stamp}/`;
        if (
          final.hostname !== "web.archive.org" ||
          !final.pathname.startsWith(expected) ||
          checkUrl(final.href.slice(final.origin.length + expected.length)) !==
            link.url
        )
          continue;
        if (
          result.evidence &&
          /wayback machine|has not archived|snapshot cannot be displayed/iu.test(
            result.evidence.title,
          )
        )
          continue;
        return {
          kind: "found",
          replacement: {
            kind: "archive",
            url,
            verifiedAt: this.clock(),
            snapshotAt: capture.at,
            reason: "confirmed-failures",
            fragments: [...fragments],
            evidence: result.evidence,
          },
        };
      }
      return { kind: "missing" };
    } catch {
      return { kind: "unavailable" };
    }
  }
}

function titleKey(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s*[-–—|]\s*(wikipedia|grokipedia).*$/iu, "")
    .replaceAll("_", " ")
    .replace(/\s+/gu, " ")
    .trim();
}
function words(text: string): Set<string> {
  return new Set(
    text
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}]{5,}/gu) ?? [],
  );
}
export function sameArticle(
  source: PageEvidence,
  target: PageEvidence,
  sourceUrl: string,
): boolean {
  if (
    !source.title ||
    source.disambiguation ||
    target.disambiguation ||
    titleKey(source.title) !== titleKey(target.title)
  )
    return false;
  if (
    !source.language ||
    !target.language ||
    baseLanguage(source.language) !== baseLanguage(target.language)
  )
    return false;
  const canonical = normalizeUrl(source.canonical);
  if (!canonical || checkUrl(canonical) !== checkUrl(sourceUrl)) return false;
  const a = words(source.introduction);
  const b = words(target.introduction);
  const shared = [...a].filter((word) => b.has(word)).length;
  // Independent visible content evidence is mandatory, even with a matching slug.
  return shared >= 6 && shared / Math.max(1, Math.min(a.size, b.size)) >= 0.6;
}

export class GrokipediaProvider implements EncyclopediaProvider {
  constructor(
    private readonly checker: LinkChecker,
    private readonly clock: () => number = Date.now,
  ) {}
  async discover(
    link: LinkRecord,
    fragments: readonly string[],
  ): Promise<DiscoveryResult> {
    const sourceUrl = new URL(link.url);
    if (!/^[a-z-]+\.(?:m\.)?wikipedia\.org$/u.test(sourceUrl.hostname))
      return { kind: "missing" };
    try {
      if (
        !sourceUrl.pathname.startsWith("/wiki/") ||
        sourceUrl.search ||
        /:/u.test(decodeURIComponent(sourceUrl.pathname.slice(6)))
      )
        return { kind: "ambiguous" };
    } catch {
      return { kind: "ambiguous" };
    }
    const source: CheckResult | null = link.lastCheck;
    if (source?.kind !== "healthy" || !source.evidence)
      return { kind: "ambiguous" };
    try {
      const url = `https://grokipedia.com/page/${sourceUrl.pathname.slice(6)}`;
      const target = await this.checker.check(url);
      if (target.kind === "unverifiable") return { kind: "unavailable" };
      if (target.kind !== "healthy" || !target.evidence)
        return { kind: "ambiguous" };
      const canonical = normalizeUrl(target.evidence.canonical);
      if (
        !canonical ||
        canonical !== url ||
        new URL(target.finalUrl).hostname !== "grokipedia.com"
      )
        return { kind: "ambiguous" };
      if (
        baseLanguage(source.evidence.language) !==
          sourceUrl.hostname.split(".")[0] ||
        !sameArticle(source.evidence, target.evidence, link.url) ||
        !hasFragments(target.evidence, fragments)
      )
        return { kind: "ambiguous" };
      return {
        kind: "found",
        replacement: {
          kind: "grokipedia",
          url,
          verifiedAt: this.clock(),
          reason: "identity-language-match",
          fragments: [...fragments],
          evidence: target.evidence,
        },
      };
    } catch {
      return { kind: "unavailable" };
    }
  }
}

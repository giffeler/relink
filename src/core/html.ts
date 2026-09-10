import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import type { PageEvidence } from "./schema.js";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
export function elements(root: Node): Element[] {
  const result: Element[] = [];
  function walk(node: Node): void {
    if ("tagName" in node) result.push(node);
    if ("childNodes" in node) node.childNodes.forEach(walk);
  }
  walk(root);
  return result;
}
export function attribute(element: Element, name: string): string {
  return element.attrs.find((attr) => attr.name === name)?.value ?? "";
}
function textOf(node: Node): string {
  if (node.nodeName === "#text" && "value" in node) return node.value;
  if ("tagName" in node && ["script", "style", "nav"].includes(node.tagName))
    return "";
  return "childNodes" in node ? node.childNodes.map(textOf).join(" ") : "";
}
export function pageEvidence(html: string, url: string): PageEvidence {
  const nodes = elements(parse(html));
  const h1 = nodes.find((node) => node.tagName === "h1");
  const title = nodes.find((node) => node.tagName === "title");
  const main =
    nodes.find((node) => ["main", "article"].includes(node.tagName)) ??
    nodes.find((node) => node.tagName === "body");
  const paragraphs = main
    ? elements(main).filter((node) => node.tagName === "p")
    : [];
  const introduction = paragraphs
    .map(textOf)
    .map((text) => text.replace(/\s+/gu, " ").trim())
    .filter((text) => text.length > 80)
    .slice(0, 3)
    .join(" ")
    .slice(0, 2000);
  const canonical = nodes.find(
    (node) =>
      node.tagName === "link" &&
      attribute(node, "rel").split(" ").includes("canonical"),
  );
  const htmlNode = nodes.find((node) => node.tagName === "html");
  const pageTitle = textOf(h1 ?? title ?? parse(""))
    .replace(/\s+/gu, " ")
    .trim();
  return {
    title: pageTitle,
    language: htmlNode ? attribute(htmlNode, "lang") : "",
    canonical: canonical
      ? new URL(attribute(canonical, "href"), url).href
      : url,
    introduction,
    anchors: nodes
      .flatMap((node) => {
        const id = attribute(node, "id");
        return id ? [id] : [];
      })
      .slice(0, 2000),
    sourceUrls: nodes
      .filter((node) => node.tagName === "a")
      .map((node) => attribute(node, "href"))
      .filter((href) =>
        /^https:\/\/[a-z-]+\.wikipedia\.org\/wiki\//u.test(href),
      )
      .slice(0, 200),
    disambiguation:
      /\bdisambiguation\b|may refer to|begriffsklärung|bezeichnet unter anderem/iu.test(
        `${pageTitle} ${introduction.slice(0, 400)}`,
      ),
  };
}

export function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Edit only href attribute byte ranges, preserving all other HTML verbatim. */
export function rewriteLinks(
  html: string,
  replacements: ReadonlyMap<string, string>,
  siteUrl: string,
): string {
  const nodes = elements(parse(html, { sourceCodeLocationInfo: true }));
  const edits: Array<{ start: number; end: number; value: string }> = [];
  for (const node of nodes) {
    if (node.tagName !== "a" || !node.sourceCodeLocation?.attrs) continue;
    const href = attribute(node, "href");
    let original: string;
    try {
      original = new URL(href, siteUrl).href;
    } catch {
      continue;
    }
    const destination = replacements.get(original);
    const location = node.sourceCodeLocation.attrs["href"];
    if (!destination || !location) continue;
    edits.push({
      start: location.startOffset,
      end: location.endOffset,
      value: `href="${escapeAttribute(destination)}"`,
    });
  }
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    output = output.slice(0, edit.start) + edit.value + output.slice(edit.end);
  return output;
}

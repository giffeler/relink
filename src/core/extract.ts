import { z } from "zod";
import { checkUrl, normalizeUrl, stableId } from "./url.js";
import type { CollectionSource, LinkOccurrence } from "./schema.js";

const objectSchema = z.record(z.string(), z.unknown());
export function object(value: unknown): Record<string, unknown> | null {
  const result = objectSchema.safeParse(value);
  return result.success ? result.data : null;
}
export interface ContentDocument {
  id: string;
  slug: string;
  locale: string;
  title: string;
  data: unknown;
}
interface Found {
  url: string;
  path: string;
  text: string;
}

function visit(
  value: unknown,
  segments: string[],
  path: string,
  found: Found[],
): void {
  if (segments.length === 0) {
    if (typeof value === "string") found.push({ url: value, path, text: "" });
    return;
  }
  const [segment, ...rest] = segments;
  if (segment === "*" && Array.isArray(value)) {
    value.forEach((child: unknown, index: number) =>
      visit(child, rest, `${path}[${index}]`, found),
    );
  } else if (segment) {
    const item = object(value);
    if (item)
      visit(item[segment], rest, path ? `${path}.${segment}` : segment, found);
  }
}

function portableText(value: unknown, path: string, found: Found[]): void {
  if (!Array.isArray(value)) return;
  for (const [index, rawBlock] of value.entries()) {
    const block = object(rawBlock);
    if (
      !block ||
      block["_type"] !== "block" ||
      !Array.isArray(block["markDefs"])
    )
      continue;
    const children: unknown[] = Array.isArray(block["children"])
      ? block["children"]
      : [];
    for (const rawMark of block["markDefs"]) {
      const mark = object(rawMark);
      if (!mark || mark["_type"] !== "link" || typeof mark["href"] !== "string")
        continue;
      let run: Found | null = null;
      for (const [childIndex, child] of children.entries()) {
        const span = object(child);
        if (
          !span ||
          !Array.isArray(span["marks"]) ||
          !span["marks"].includes(mark["_key"]) ||
          typeof span["text"] !== "string"
        ) {
          run = null;
          continue;
        }
        if (run) run.text = (run.text + span["text"]).slice(0, 500);
        else {
          run = {
            url: mark["href"],
            text: span["text"].slice(0, 500),
            path: `${path}[${index}].children[${childIndex}]`,
          };
          found.push(run);
        }
      }
    }
  }
}

export async function extractOccurrences(
  document: ContentDocument,
  source: CollectionSource,
  siteUrl: string,
  generation: string,
): Promise<LinkOccurrence[]> {
  const found: Found[] = [];
  const data = object(document.data);
  if (!data) return [];
  for (const field of source.portableTextFields)
    portableText(data[field], field, found);
  for (const field of source.urlFields)
    visit(data, field.replace(/\[\]/gu, ".*").split("."), "", found);
  const occurrences: LinkOccurrence[] = [];
  for (const item of found) {
    const originalUrl = normalizeUrl(item.url, siteUrl);
    if (!originalUrl || new URL(originalUrl).origin === new URL(siteUrl).origin)
      continue;
    const id = await stableId(
      `${source.collection}/${document.id}/${item.path}/${originalUrl}`,
    );
    occurrences.push({
      schemaVersion: 1,
      id,
      linkId: await stableId(checkUrl(originalUrl)),
      originalUrl,
      collection: source.collection,
      contentId: document.id,
      slug: document.slug,
      locale: document.locale,
      title: document.title,
      path: item.path,
      text: item.text,
      pagePath: source.path
        .replaceAll("{slug}", encodeURIComponent(document.slug))
        .replaceAll("{locale}", encodeURIComponent(document.locale)),
      generation,
    });
  }
  return occurrences;
}

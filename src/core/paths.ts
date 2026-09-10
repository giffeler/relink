import type { CollectionSource } from "./schema.js";

/** Resolve only explicitly configured routes to the indexed content path. */
export function indexedPaths(
  pathname: string,
  source: CollectionSource,
): string[] {
  const paths = new Set<string>();
  for (const template of [source.path, ...source.pathAliases]) {
    const tokens: string[] = [];
    const pattern = template
      .split(/(\{slug\}|\{locale\})/u)
      .map((part) => {
        if (part === "{slug}" || part === "{locale}") {
          tokens.push(part);
          return "([^/]+)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      })
      .join("");
    const match = new RegExp(`^${pattern}$`, "u").exec(pathname);
    if (!match) continue;
    const values = new Map<string, string>();
    let valid = true;
    for (const [index, token] of tokens.entries()) {
      const value = match[index + 1];
      if (
        value === undefined ||
        (values.has(token) && values.get(token) !== value)
      ) {
        valid = false;
        break;
      }
      values.set(token, value);
    }
    if (!valid) continue;
    if (
      ![...source.path.matchAll(/\{slug\}|\{locale\}/gu)].every((token) =>
        values.has(token[0]),
      )
    )
      continue;
    paths.add(
      source.path.replace(
        /\{slug\}|\{locale\}/gu,
        (token) => values.get(token) ?? token,
      ),
    );
  }
  return [...paths];
}

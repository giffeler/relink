export function normalizeUrl(input: string, base?: string): string | null {
  try {
    const url = new URL(input, base);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function checkUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  return url.href;
}

export function isPublicUrl(input: string): boolean {
  const normalized = normalizeUrl(input);
  if (!normalized) return false;
  const host = new URL(normalized).hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    !host.includes(".") ||
    /\.(localhost|local|internal|test|invalid)$/u.test(host)
  )
    return false;
  if (host.includes(":")) return false;
  const octets = host.split(".").map(Number);
  if (
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    const [a = 0, b = 0, c = 0] = octets;
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 192 && b === 0)
    )
      return false;
  }
  return true;
}

export async function stableId(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function domainExcluded(
  host: string,
  domains: readonly string[],
): boolean {
  return domains.some(
    (domain) =>
      host === domain.toLowerCase() ||
      host.endsWith(`.${domain.toLowerCase()}`),
  );
}

export function baseLanguage(locale: string): string {
  return locale.toLowerCase().split("-")[0] ?? "en";
}

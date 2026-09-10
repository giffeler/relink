import { object } from "./extract.js";
import { pageEvidence } from "./html.js";
import type { CheckResult, Settings } from "./schema.js";
import { HOUR } from "./schema.js";
import { isPublicUrl } from "./url.js";

/** Production transports must enforce DNS-aware SSRF checks (EmDash ctx.http does). */
export interface HttpTransport {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}
export class BodyLimitError extends Error {
  override name = "BodyLimitError";
}
export async function readLimited(
  response: Response,
  limit = 512_000,
  timeoutMs = 10000,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  const state = { expired: false };
  const timeout = setTimeout(() => {
    state.expired = true;
    void reader.cancel().catch(() => undefined);
  }, timeoutMs);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (state.expired) throw new Error("Body timeout");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit)
        throw new BodyLimitError("Response body exceeds limit");
      result += decoder.decode(chunk.value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    clearTimeout(timeout);
    void reader.cancel().catch(() => undefined);
  }
}
export function retryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const numeric = Number(value);
  const time = Number.isFinite(numeric)
    ? now + numeric * 1000
    : Date.parse(value);
  return Number.isFinite(time)
    ? Math.max(now + 60_000, Math.min(now + 7 * 24 * HOUR, time))
    : null;
}

export class LinkChecker {
  constructor(
    private readonly transport: HttpTransport,
    private readonly settings: Settings,
    private readonly clock: () => number = Date.now,
  ) {}

  async request(url: string, method = "GET"): Promise<Response> {
    if (!isPublicUrl(url)) throw new Error("Unsafe URL");
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.settings.timeoutMs,
    );
    let current = url;
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (!isPublicUrl(current)) throw new Error("Unsafe URL");
        const response = await this.transport.fetch(current, {
          method,
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": "Relink/0.2 (+https://github.com/giffeler/relink)",
            Accept:
              "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
          },
        });
        if (![301, 302, 303, 307, 308].includes(response.status))
          return response;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) return response;
        current = new URL(location, current).href;
      }
      throw new Error("Too many redirects");
    } finally {
      clearTimeout(timeout);
    }
  }

  async check(
    url: string,
    inspectBody = true,
    method: "HEAD" | "GET" = "HEAD",
  ): Promise<CheckResult> {
    const now = this.clock();
    const unknown = (
      reason: Extract<CheckResult, { kind: "unverifiable" }>["reason"],
      status: number | null = null,
      next: number | null = null,
    ): CheckResult => ({
      kind: "unverifiable",
      checkedAt: now,
      finalUrl: url,
      status,
      reason,
      retryAt: next,
    });
    if (!isPublicUrl(url)) return unknown("unsafe-url");
    try {
      let response = await this.request(url, method);
      const contentType = response.headers.get("content-type") ?? "";
      // A non-2xx HEAD is not sufficient evidence of a dead resource.
      if (
        method === "HEAD" &&
        (!response.ok ||
          (inspectBody && (!contentType || /html/iu.test(contentType))))
      ) {
        await response.body?.cancel();
        response = await this.request(url, "GET");
      }
      const status = response.status;
      const finalUrl = response.url || url;
      if ([401, 407].includes(status)) {
        await response.body?.cancel();
        return unknown("authentication", status);
      }
      if ([403, 451].includes(status)) {
        await response.body?.cancel();
        return unknown("blocked", status);
      }
      if (status === 429) {
        const next = retryAfter(response.headers.get("retry-after"), now);
        await response.body?.cancel();
        return unknown("rate-limited", status, next);
      }
      if (status === 404 || status === 410 || status >= 500) {
        await response.body?.cancel();
        return {
          kind: "broken",
          checkedAt: now,
          finalUrl,
          status,
          reason: status >= 500 ? "server-error" : "not-found",
        };
      }
      if (!response.ok) {
        await response.body?.cancel();
        return unknown("unsupported-response", status);
      }
      const actualType = response.headers.get("content-type") ?? contentType;
      const body =
        inspectBody && /html/iu.test(actualType)
          ? await this.read(response)
          : "";
      if (!body) await response.body?.cancel();
      const evidence = body ? pageEvidence(body, finalUrl) : null;
      if (
        evidence &&
        /access denied|just a moment|page not found|404 not found|sign in|log in|seite nicht gefunden|captcha/iu.test(
          evidence.title,
        )
      )
        return unknown("soft-error", status);
      return {
        kind: "healthy",
        checkedAt: now,
        finalUrl,
        status,
        contentType: actualType,
        evidence,
      };
    } catch (error) {
      if (error instanceof BodyLimitError) return unknown("response-too-large");
      const code =
        error instanceof Error ? object(error.cause)?.["code"] : undefined;
      const details =
        error instanceof Error
          ? `${error.message} ${typeof code === "string" ? code : ""}`
          : "";
      // EmDash's DNS guard wraps NXDOMAIN in its blocked-fetch error. Retain
      // that evidence without treating an actual private-address refusal as DNS failure.
      if (/Hostname resolved to no addresses/iu.test(details))
        return {
          kind: "broken",
          checkedAt: now,
          finalUrl: url,
          status: null,
          reason: "dns",
        };
      if (/Could not resolve hostname/iu.test(details))
        return unknown("network-outage", null, now + HOUR);
      if (/unsafe|blocked fetch|private|SSRF/iu.test(details))
        return unknown("unsafe-url");
      return {
        kind: "broken",
        checkedAt: now,
        finalUrl: url,
        status: null,
        reason: /redirect/iu.test(details)
          ? "redirect-loop"
          : /abort|timeout/iu.test(details)
            ? "timeout"
            : /ENOTFOUND|EAI_AGAIN/iu.test(details)
              ? "dns"
              : "connection",
      };
    }
  }

  async read(response: Response): Promise<string> {
    return readLimited(response, 512_000, this.settings.timeoutMs);
  }

  /** Never count transport failures until an independent host answers. */
  async networkAvailable(probes: readonly string[]): Promise<boolean> {
    for (const url of probes) {
      try {
        const result = await this.request(url, "HEAD");
        await result.body?.cancel();
        if (result.status >= 200 && result.status < 500) return true;
      } catch {
        /* Try the second independent host. */
      }
    }
    return false;
  }
}

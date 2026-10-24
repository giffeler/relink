import { z } from "zod";

export const SEMANTIC_MODEL =
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";
export interface SemanticScorer {
  score(
    source: string,
    candidates: readonly string[],
  ): Promise<{ model: string; scores: number[] }>;
}
const resultSchema = z.object({
  model: z.literal(SEMANTIC_MODEL),
  scores: z.array(z.number().min(-1).max(1)).max(8),
});
/** Only a configured Unix socket is used. There is no remote inference fallback. */
export class LocalSemanticScorer implements SemanticScorer {
  constructor(private readonly socketPath: string) {}
  async score(
    source: string,
    candidates: readonly string[],
  ): Promise<{ model: string; scores: number[] }> {
    if (candidates.length > 8) throw new Error("Too many candidates");
    const { request } = await import("node:http");
    const body = JSON.stringify({
      source: source.slice(0, 2500),
      candidates: candidates.map((t) => t.slice(0, 2500)),
    });
    const raw = await new Promise<string>((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath,
          path: "/score",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error("Local scorer unavailable"));
            return;
          }
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            text += chunk;
            if (text.length > 8000)
              req.destroy(new Error("Invalid scorer response"));
          });
          res.on("end", () => resolve(text));
          res.on("error", reject);
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error("Local scorer timeout")),
        15000,
      );
      req.on("close", () => clearTimeout(timer));
      req.on("error", reject);
      req.end(body);
    });
    const result = resultSchema.parse(JSON.parse(raw));
    if (result.scores.length !== candidates.length)
      throw new Error("Invalid scorer result count");
    return result;
  }
}

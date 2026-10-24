import { expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSemanticScorer, SEMANTIC_MODEL } from "../src/core/semantic.js";

it("uses only the Unix socket and rejects mismatched model/count or oversized responses", async () => {
  const directory = await mkdtemp(join(tmpdir(), "relink-"));
  const socket = join(directory, "score.sock");
  let body = JSON.stringify({ model: SEMANTIC_MODEL, scores: [0.9] });
  let received = "";
  const server = createServer((request, response) => {
    expect(request.url).toBe("/score");
    expect(request.method).toBe("POST");
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      received += chunk;
    });
    request.on("end", () => {
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  try {
    const scorer = new LocalSemanticScorer(socket);
    expect(await scorer.score("source", ["target"])).toEqual({
      model: SEMANTIC_MODEL,
      scores: [0.9],
    });
    expect(JSON.parse(received)).toEqual({
      source: "source",
      candidates: ["target"],
    });
    for (const invalid of [
      { model: "different-model", scores: [0.9] },
      { model: SEMANTIC_MODEL, scores: [] },
      { model: SEMANTIC_MODEL, scores: [1.1] },
      { model: SEMANTIC_MODEL, scores: [0.9], padding: "x".repeat(9000) },
    ]) {
      body = JSON.stringify(invalid);
      await expect(scorer.score("source", ["target"])).rejects.toThrow();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

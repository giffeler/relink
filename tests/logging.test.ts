import {
  mkdtemp,
  readFile,
  rm,
  stat,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RelinkEngine, newLink } from "../src/core/engine.js";
import { maintenanceLogger } from "../src/logging.js";
import type { MaintenanceLog } from "../src/logging.js";
import { appendLog } from "../src/node-log.js";
import {
  contentAccess,
  createTestStore,
  document,
  NOW,
  options,
  response,
} from "./helpers.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const result = await createTestStore();
  cleanups.push(() => result.db.destroy());
  const logs: MaintenanceLog[] = [];
  const engine = new RelinkEngine({
    store: result.store,
    content: contentAccess([
      document({
        website: "https://external.example/article?token=private-value",
      }),
    ]),
    transport: { fetch: async () => response() },
    options,
    clock: () => NOW,
    log: async (record) => {
      logs.push(record);
    },
  });
  return { ...result, engine, logs };
}
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "relink-logs-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe("maintenance diagnostics", () => {
  it("correlates scans and checks, distinguishes idle runs, and excludes URL queries", async () => {
    const { engine, logs, store } = await fixture();
    await engine.tick();
    expect(logs.map((record) => record.event)).toEqual([
      "run.started",
      "scan.batch.completed",
      "link.checked",
      "run.completed",
    ]);
    expect(new Set(logs.map((record) => record.runId)).size).toBe(1);
    expect(logs.at(-1)).toMatchObject({
      processed: 1,
      totalProcessed: 1,
      enabled: true,
    });
    expect(
      logs.find((record) => record.event === "link.checked"),
    ).toMatchObject({
      host: "external.example",
      result: "healthy",
      status: 200,
    });
    expect(JSON.stringify(logs)).not.toContain("private-value");
    expect(JSON.stringify(logs)).not.toContain("/article");
    const firstRun = logs[0]?.runId;
    logs.length = 0;
    await engine.tick();
    expect(logs.map((record) => record.event)).toEqual([
      "run.started",
      "run.completed",
    ]);
    expect(logs[0]?.runId).not.toBe(firstRun);
    expect(logs.at(-1)).toMatchObject({ processed: 0, totalProcessed: 1 });
    expect((await store.state()).processed).toBe(1);
  });

  it("reports state-read failures without masking the error or leaking its message", async () => {
    const { engine, logs, store } = await fixture();
    const failure = new Error(
      "SQL contained private-value https://secret.example",
    );
    vi.spyOn(store, "state").mockRejectedValueOnce(failure);
    await expect(engine.tick()).rejects.toBe(failure);
    expect(logs.map((record) => record.event)).toEqual([
      "run.started",
      "run.failed",
    ]);
    expect(logs.at(-1)).toMatchObject({
      stage: "read-state",
      errorType: "Error",
    });
    expect(JSON.stringify(logs)).not.toContain("private-value");
  });

  it("does not report successful completion when state persistence fails", async () => {
    const { engine, logs, store } = await fixture();
    const failure = new Error("disk unavailable");
    vi.spyOn(store, "saveState").mockRejectedValue(failure);
    await expect(engine.tick()).rejects.toBe(failure);
    expect(logs.map((record) => record.event)).toEqual([
      "run.started",
      "run.failed",
      "state.save.failed",
    ]);
    expect(logs[1]).toMatchObject({ stage: "save-start" });
  });

  it("retains host diagnostics when the file is unwritable", async () => {
    const { engine, logs } = await fixture();
    await engine.tick();
    const record = logs[0];
    if (!record) throw new Error("Missing run record");
    const host = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    // Appending to a directory fails on every test platform, including root.
    const logger = maintenanceLogger(host, {
      ...options,
      logFile: await directory(),
    });
    await expect(logger(record)).resolves.toBeUndefined();
    expect(host.info).toHaveBeenCalledWith(JSON.stringify(record));
    expect(host.error).toHaveBeenCalledWith(
      expect.stringContaining('"event":"log.write.failed"'),
    );
  });

  it("waits for outstanding checks before reporting a failed batch", async () => {
    const { engine, logs, store } = await fixture();
    const state = await store.state();
    state.nextScanAt = NOW + 100000;
    await store.saveState(state);
    await store.links.put("a", newLink("a", "https://first.example/", NOW));
    await store.links.put("b", newLink("b", "https://second.example/", NOW));
    let release: () => void = () => {
      throw new Error("Uninitialized check");
    };
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {
      throw new Error("Uninitialized signal");
    };
    const secondStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const failure = new Error("check failed");
    vi.spyOn(engine, "checkLink").mockImplementation(async (link) => {
      if (link.id === "a") throw failure;
      started();
      await pending;
    });
    const tick = engine.tick();
    await secondStarted;
    expect(logs.some((record) => record.event === "run.failed")).toBe(false);
    release();
    await expect(tick).rejects.toBe(failure);
    expect(logs.at(-1)).toMatchObject({
      event: "run.failed",
      stage: "checks",
      processed: 1,
    });
    expect((await store.state()).lastCompletedAt).toBeNull();
  });

  it("serializes parallel JSON lines with restricted file permissions", async () => {
    const file = join(await directory(), "nested", "relink.jsonl");
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        appendLog(file, JSON.stringify({ index })),
      ),
    );
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(
      Array.from({ length: 20 }, (_, index) => ({ index })),
    );
    expect((await stat(file)).mode & 0o007).toBe(0);
  });

  it("rotates at 5 MiB and retains exactly five archives", async () => {
    const file = join(await directory(), "relink.jsonl");
    await writeFile(file, "original");
    await truncate(file, 5 * 1024 * 1024);
    for (let index = 1; index <= 5; index++)
      await writeFile(`${file}.${index}`, `archive-${index}`);
    await appendLog(file, '{"event":"run.started"}');
    expect(await readFile(file, "utf8")).toBe('{"event":"run.started"}\n');
    expect((await stat(`${file}.1`)).size).toBe(5 * 1024 * 1024);
    expect(await readFile(`${file}.5`, "utf8")).toBe("archive-4");
    await expect(stat(`${file}.6`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

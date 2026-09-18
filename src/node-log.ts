import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";

const queues = new Map<string, Promise<void>>();
const MAX_BYTES = 5 * 1024 * 1024;
const ARCHIVES = 5;

async function ifPresent(operation: () => Promise<unknown>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
}

/** Node-only, one writer process per file; host logging remains platform-neutral. */
export async function appendLog(file: string, line: string): Promise<void> {
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(file), { recursive: true, mode: 0o750 });
      let size = 0;
      await ifPresent(async () => {
        size = (await stat(file)).size;
      });
      if (size > 0 && size + Buffer.byteLength(line, "utf8") + 1 > MAX_BYTES) {
        await ifPresent(() => unlink(`${file}.${ARCHIVES}`));
        for (let index = ARCHIVES - 1; index >= 1; index--)
          await ifPresent(() =>
            rename(`${file}.${index}`, `${file}.${index + 1}`),
          );
        await rename(file, `${file}.1`);
      }
      await appendFile(file, `${line}\n`, { encoding: "utf8", mode: 0o640 });
    });
  queues.set(file, next);
  try {
    await next;
  } finally {
    if (queues.get(file) === next) queues.delete(file);
  }
}

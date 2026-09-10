import { copyFile } from "node:fs/promises";
await copyFile(
  new URL("../src/admin/styles.css", import.meta.url),
  new URL("../dist/admin/styles.css", import.meta.url),
);

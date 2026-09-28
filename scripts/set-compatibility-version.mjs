import { readFile, writeFile } from "node:fs/promises";

// Select a supported release in a disposable CI checkout before installation.
const version = process.argv[2];
if (!["0.38.0", "0.39.0", "0.40.0", "0.41.0", "0.42.0"].includes(version)) {
  throw new Error("Expected an EmDash version from the compatibility matrix");
}
for (const file of [
  "package.json",
  "examples/node/package.json",
  "examples/cloudflare/package.json",
]) {
  const url = new URL(`../${file}`, import.meta.url);
  const pkg = JSON.parse(await readFile(url, "utf8"));
  for (const section of ["dependencies", "devDependencies"]) {
    for (const name of [
      "emdash",
      "@emdash-cms/admin",
      "@emdash-cms/cloudflare",
    ]) {
      if (pkg[section]?.[name]) pkg[section][name] = version;
    }
  }
  await writeFile(url, `${JSON.stringify(pkg, null, 2)}\n`);
}
const workspace = new URL("../pnpm-workspace.yaml", import.meta.url);
await writeFile(
  workspace,
  (await readFile(workspace, "utf8")).replaceAll(
    /^ {2}- .*@0\.42\.0.*$/gmu,
    (line) =>
      version === "0.42.0"
        ? line
        : `${line}\n${line.replace("0.42.0", version)}`,
  ),
);

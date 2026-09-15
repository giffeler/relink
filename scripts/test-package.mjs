import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely } from "kysely";
import { createDialect } from "emdash/db/sqlite";
import { OptionsRepository, UserRepository } from "emdash";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "work/package-site");
const artifacts = resolve(root, "work/artifacts");
const rootPackage = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);
const run = (args, cwd = directory) =>
  execFileSync("pnpm", args, { cwd, stdio: "inherit" });
await mkdir(artifacts, { recursive: true });
run(["build"], root);
run(["pack", "--pack-destination", artifacts], root);
await rm(directory, { recursive: true, force: true });
await mkdir(directory, { recursive: true });
await cp(resolve(root, "examples/node"), directory, {
  recursive: true,
  filter: (path) =>
    !/(?:^|\/)(node_modules|dist|\.astro)(?:\/|$)|data\.db/u.test(path),
});
const pkg = JSON.parse(
  await readFile(resolve(directory, "package.json"), "utf8"),
);
pkg.dependencies["emdash-plugin-relink"] =
  `file:${resolve(artifacts, `emdash-plugin-relink-${rootPackage.version}.tgz`)}`;
await writeFile(
  resolve(directory, "package.json"),
  `${JSON.stringify(pkg, null, 2)}\n`,
);
// An empty workspace boundary prevents accidental use of the source checkout.
await writeFile(
  resolve(directory, "pnpm-workspace.yaml"),
  "packages:\n  - .\nallowBuilds:\n  esbuild: true\n  sharp: true\noverrides:\n  smol-toml: 1.7.1\n  kysely: 0.29.5\n  'sharp@<0.35.4': 0.35.4\n  'undici@>=7.0.0 <7.29.0': 7.29.0\n",
);
await cp(
  resolve(root, "tests/fixtures/local-auth.ts"),
  resolve(directory, "src/local-auth.ts"),
);
let config = await readFile(resolve(directory, "astro.config.mjs"), "utf8");
config = config.replace(
  "database: sqlite",
  `auth: { type: 'relink-fixture', entrypoint: ${JSON.stringify(resolve(directory, "src/local-auth.ts"))}, config: {} },\n    database: sqlite`,
);
await writeFile(resolve(directory, "astro.config.mjs"), config);
await mkdir(resolve(directory, "src/pages/test-fixture"), { recursive: true });
await writeFile(
  resolve(directory, "src/pages/test-fixture/login.ts"),
  `import type { APIRoute } from 'astro';\nexport const GET: APIRoute = ({ url }) => {\n  if (!['localhost', '127.0.0.1'].includes(url.hostname)) return new Response(null, { status: 403 });\n  return new Response(null, { status: 302, headers: { 'set-cookie': 'relink-fixture=admin; HttpOnly; SameSite=Strict; Path=/', location: '/_emdash/admin/plugins/relink/' } });\n};\n`,
);
run(["install", "--no-frozen-lockfile"]);
run(["seed"]);
const db = new Kysely({
  dialect: createDialect({ url: resolve(directory, "data.db") }),
});
const settings = new OptionsRepository(db);
await settings.set("emdash:setup_complete", true);
const users = new UserRepository(db);
if (!(await users.findByEmail("admin@relink.test")))
  await users.create({
    email: "admin@relink.test",
    role: 50,
    name: "Test administrator",
    data: { welcomeDismissed: true },
  });
await db.destroy();
run(["build"]);
if (process.argv.includes("--prepare-only")) process.exit(0);
const port = "4327";
const server = spawn(process.execPath, ["dist/server/entry.mjs"], {
  cwd: directory,
  env: { ...process.env, HOST: "127.0.0.1", PORT: port },
  stdio: "inherit",
});
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const result = await fetch(`http://127.0.0.1:${port}/`);
      if (result.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait for the local fixture server. */
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  if (!ready) throw new Error("Package example did not start");
  const page = await fetch(`http://127.0.0.1:${port}/posts/example`);
  if (!page.ok || !(await page.text()).includes("https://example.com/"))
    throw new Error("Published example page failed");
  const admin = await fetch(
    `http://127.0.0.1:${port}/_emdash/api/plugins/relink/snapshot`,
    { headers: { cookie: "relink-fixture=admin", "X-EmDash-Request": "1" } },
  );
  const snapshot = await admin.json();
  if (
    !admin.ok ||
    snapshot.success !== true ||
    !Array.isArray(snapshot.data?.links)
  )
    throw new Error("Packaged native plugin route failed");
  console.log(
    "Built-package installation, published SSR and authenticated plugin API passed.",
  );
} finally {
  server.kill("SIGTERM");
}

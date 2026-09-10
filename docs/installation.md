# Installation and operation

Relink 0.2.2 targets **EmDash 0.37.0**. It requires a server-rendered Astro site. `relink()` registers the native plugin and its admin extensions; `relinkAstro()` registers output middleware. Both registrations are required. Include `react()` so EmDash's admin can hydrate. Do not place native plugins in EmDash's sandboxed plugin list.

Read the [licensing terms](licensing.md) before use. Material governed by the Relink Noncommercial License requires a separate agreement for commercial use; existing MIT rights in the 0.1.0 baseline remain unaffected.

The package exports JavaScript and TypeScript declarations from `.`, `/astro`, `/runtime`, `/middleware`, `/admin` and `/core`, plus `/styles.css`. The host loads `/runtime` and `/admin` from the descriptor; applications normally import only `relink` and `relinkAstro`.

## Node and SQLite

Use the Node example under `examples/node`. After installing dependencies and building Relink:

```sh
pnpm --filter relink-example-node seed
pnpm --filter relink-example-node dev
```

Complete EmDash's normal setup and authentication. The sample seed creates one published article. The example does not include test authentication. EmDash schedules native cron tasks while the Node process is running. Keep the process supervised and retain its database on durable storage. Restart recovery uses the same persisted task and worker cursor.

Choose **Scan published content** once after installation. Configuration-registered native plugins do not reliably receive an install lifecycle callback on every existing deployment; the explicit action and content-change hooks initialize scheduling idempotently. The admin shows missing scheduling, queued actions, the last completed run and stalled work.

## Cloudflare and D1

Use the configuration in `examples/cloudflare`. Set a real D1 database binding before deployment, apply EmDash's supported migrations, and configure the site's normal authentication and storage. The repository contains a placeholder database identifier and does not create Cloudflare resources.

```ts
// src/worker.ts
export { default, PluginBridge } from "@emdash-cms/cloudflare/worker";
```

```jsonc
// Relevant wrangler.jsonc fields
{
  "main": "./src/worker.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "your-database",
      "database_id": "your-database-id",
    },
  ],
  "triggers": { "crons": ["* * * * *"] },
}
```

The supported EmDash Worker runs `runScheduledTasks()` from `scheduled()`. A request-only Worker cannot provide unattended link maintenance. Verify real Cron Trigger delivery and resource limits after deployment; the repository's D1 test runs in local workerd, and the Cloudflare example build checks the Worker entry and bindings. No remote deployment is part of package validation.

## Cache behaviour

Relink uses saved rules and local EmDash dispatch during rendering. Visitor requests never check external URLs. Public HTML receives a maximum five-minute shared-cache lifetime with no stale-while-revalidate allowance. When Astro's own route cache is active, its lifetime is capped at 300 seconds, its validators include replacement state, and downstream caches must revalidate to avoid stacking another five minutes on top. Explicit private/no-store responses keep their stronger policy.

Purge previously cached pages when first enabling Relink. A cache entry created before installation cannot be shortened retroactively. CDN rules that override origin cache headers must also enforce the five-minute bound. Static/prerendered pages require a rebuild and are outside this release's automatic replacement guarantee. Compressed responses must be transformed before compression; Relink preserves an already compressed response rather than damaging it.

## Disable and remove

Disabling maintenance in Relink Settings stops scanning/checking and output replacement after the queued settings action runs. Disabling the plugin through EmDash cancels its cron task; removing both registrations stops loading Relink entirely. Output falls back to originals. Stored data remains plugin-owned; back up the database before using EmDash's uninstall/data-removal options. No content rollback migration is required because content was never changed.

## Content route aliases

Set each source's `path` to its indexed route. If the same published content is also served through other routes, list those explicitly in `pathAliases`. Both templates support `{slug}` and `{locale}`; locale-bearing routes must preserve the locale. Aliases reuse the same occurrences and check history, and still require live publication validation. Unconfigured routes do not receive replacement rules. For example:

```ts
{
  collection: "posts",
  path: "/posts/{slug}",
  pathAliases: ["/{slug}", "/{slug}/", "/posts/{slug}/"],
  portableTextFields: ["content"],
}
```

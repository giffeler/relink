import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import { Kysely } from "kysely";
import { createDialect } from "emdash/db/sqlite";
import {
  ContentRepository,
  OptionsRepository,
  PluginStorageRepository,
} from "emdash";
import type { Database } from "emdash";
import { defaultSettings, linkSchema } from "../../src/core/schema.js";
import type { TextDirection } from "../../src/core/schema.js";
import { resolve } from "node:path";

async function settings(direction: TextDirection): Promise<void> {
  const db = new Kysely<Database>({
    dialect: createDialect({ url: resolve("work/package-site/data.db") }),
  });
  try {
    await new OptionsRepository(db).set("plugin:relink:settings:v1", {
      ...defaultSettings,
      direction,
    });
  } finally {
    await db.destroy();
  }
}
async function login(page: Page): Promise<void> {
  await page.goto("/test-fixture/login");
  await expect(page.locator(".relink")).toBeVisible();
}
test.beforeEach(async () => settings("auto"));

test("native navigation, indexed occurrences, details, focus, CSV and accessibility", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  await expect(
    page
      .getByRole("complementary")
      .getByRole("link", { name: "Relink", exact: true }),
  ).toBeVisible();
  const row = page
    .locator(".relink")
    .getByRole("button", { name: "https://example.com/", exact: true });
  await expect(row).toBeVisible();
  await row.click();
  await expect(
    page.getByRole("dialog", { name: "Link details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in editor" }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toBe("relink.csv");
  expect(
    (await new AxeBuilder({ page }).include(".relink").analyze()).violations,
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test("live host language switching, German messages and dark theme", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("complementary")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "Deutsch", exact: true }).click();
  await page
    .getByRole("complementary")
    .getByRole("link", { name: "Relink", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Veröffentlichte Inhalte prüfen" }),
  ).toBeVisible();
  await expect(page.locator(".relink")).toHaveAttribute("lang", "de");
  await expect(page.locator(".relink").getByRole("combobox")).toHaveCount(1);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(
    (await new AxeBuilder({ page }).include(".relink").analyze()).violations,
  ).toEqual([]);
});

test("forced RTL keeps URLs readable and dialogs local with keyboard focus", async ({
  page,
}) => {
  await settings("rtl");
  await login(page);
  await expect(page.locator(".relink")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const row = page
    .locator(".relink")
    .getByRole("button", { name: "https://example.com/", exact: true });
  await row.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Link details" });
  await expect(dialog).toHaveAttribute("dir", "rtl");
  await expect(dialog.locator("bdi").first()).toHaveAttribute("dir", "ltr");
  await page.keyboard.press("Shift+Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await expect(
    settingsDialog.getByRole("combobox", { name: "Text direction" }),
  ).toHaveValue("rtl");
  await settingsDialog
    .getByRole("combobox", { name: "Text direction" })
    .focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
});

test("replacement and rollback affect server HTML without changing CMS content", async ({
  request,
}) => {
  const db = new Kysely<Database>({
    dialect: createDialect({ url: resolve("work/package-site/data.db") }),
  });
  try {
    const repository = new PluginStorageRepository(db, "relink", "links", []);
    const item = (await repository.query({ limit: 1 })).items[0];
    if (!item) throw new Error("Missing browser link fixture");
    const link = linkSchema.parse(item.data);
    const content = new ContentRepository(db);
    const before = await content.findMany("posts");
    const revisions = await db.selectFrom("revisions").selectAll().execute();
    await repository.put(item.id, {
      ...link,
      replacement: {
        kind: "manual",
        url: "https://example.org/",
        verifiedAt: Date.now(),
        reason: "editor-override",
      },
    });
    const replaced = await request.get("/posts/example");
    expect(await replaced.text()).toContain('href="https://example.org/"');
    expect(replaced.headers()["cache-control"]).toContain("s-maxage=300");
    await repository.put(item.id, link);
    expect(await (await request.get("/posts/example")).text()).toContain(
      'href="https://example.com/"',
    );
    expect(await content.findMany("posts")).toEqual(before);
    expect(await db.selectFrom("revisions").selectAll().execute()).toEqual(
      revisions,
    );
  } finally {
    await db.destroy();
  }
});

test("private endpoints enforce authentication, CSRF and HTTP methods", async ({
  request,
}) => {
  const path = "/_emdash/api/plugins/relink/commands";
  expect(
    (await request.post(path, { data: { action: "scan" } })).status(),
  ).toBe(401);
  expect(
    (
      await request.post(path, {
        headers: { cookie: "relink-fixture=admin" },
        data: { action: "scan" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get(path, {
        headers: { cookie: "relink-fixture=admin", "X-EmDash-Request": "1" },
      })
    ).status(),
  ).toBe(405);
  expect(
    (
      await request.post(
        "/_emdash/api/plugins/relink/projection?path=/posts/example",
      )
    ).status(),
  ).toBe(405);
});

test("shows native dashboard and content-editor extensions scoped to the published entry", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("complementary", { name: "Admin navigation" })
    .getByRole("link", { name: "Dashboard", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Relink", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".rl-compact")
      .getByRole("button", { name: "https://example.com/", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: /Published Links in published content Posts/ })
    .click();
  const panel = page
    .getByRole("complementary", { name: "Settings", exact: true })
    .locator(".relink");
  await expect(
    panel.getByRole("button", { name: "https://example.com/", exact: true }),
  ).toBeVisible();
  await panel.getByRole("link", { name: "Open Relink" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Content item ID", exact: true }),
  ).not.toHaveValue("");
});

for (const [locale, expected] of [
  ["de-AT", "de"],
  ["de-CH", "de"],
  ["en-GB", "en-GB"],
  ["fr-FR", "en"],
] as const) {
  test.describe(`browser language ${locale}`, () => {
    test.use({ locale });
    test("follows the host language or uses English fallback", async ({
      page,
    }) => {
      await login(page);
      await expect(page.locator(".relink")).toHaveAttribute("lang", expected);
    });
  });
}

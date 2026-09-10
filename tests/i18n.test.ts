import { describe, expect, it } from "vitest";
import { en, de } from "../src/admin/messages.js";
import { resolveLanguage, translator } from "../src/admin/i18n.js";

describe("language contracts", () => {
  it.each([
    ["de-DE", "de"],
    ["de-AT", "de"],
    ["de-CH", "de"],
    ["de_CH", "de"],
    ["en-GB", "en"],
    ["en-US", "en"],
    ["ar", "en"],
    ["he", "en"],
    ["fr", "en"],
  ])("resolves %s to %s", (input, expected) =>
    expect(resolveLanguage(input)).toBe(expected),
  );
  it("ships complete catalogs without empty messages", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    expect(Object.values(en).every(Boolean)).toBe(true);
    expect(Object.values(de).every(Boolean)).toBe(true);
  });
  it("uses localized Lingui plural forms including zero", () => {
    expect(translator("en-US").t("linkCount", { count: 1 })).toBe("1 link");
    expect(translator("de-AT").t("linkCount", { count: 1 })).toBe("1 Link");
    expect(translator("de-CH").t("linkCount", { count: 0 })).toBe("0 Links");
    expect(translator("en").t("linkCount", { count: 2000 })).toBe(
      "2,000 links",
    );
  });
});

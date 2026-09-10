import { describe, expect, it } from "vitest";
import { createPlugin, requireMethod } from "../src/plugin.js";
import { relink } from "../src/index.js";
import { options } from "./helpers.js";

describe("native EmDash registration", () => {
  it("shares runtime and build-time admin metadata and uses host route names", () => {
    const plugin = createPlugin(options);
    const descriptor = relink(options);
    expect(plugin.admin.pages).toEqual(descriptor.adminPages);
    expect(plugin.admin.widgets).toEqual(descriptor.adminWidgets);
    expect(Object.keys(plugin.routes).sort()).toEqual([
      "commands",
      "detail",
      "projection",
      "snapshot",
    ]);
    expect(plugin.routes["commands"]?.public).not.toBe(true);
    expect(plugin.routes["projection"]?.public).toBe(true);
  });
  it.each(["GET", "HEAD", "PUT", "DELETE"])(
    "rejects %s for mutating commands",
    (method) => {
      expect(() =>
        requireMethod(new Request("https://site.example", { method }), "POST"),
      ).toThrow("Method not allowed");
    },
  );
});

import { describe, expect, it } from "vitest";
import { indexedPaths } from "../src/core/paths.js";
import { collectionSourceSchema } from "../src/core/schema.js";

describe("configured content aliases", () => {
  const source = collectionSourceSchema.parse({
    collection: "posts",
    path: "/posts/{slug}",
    pathAliases: ["/{slug}", "/{slug}/", "/posts/{slug}/"],
  });
  it.each(["/hello", "/hello/", "/posts/hello", "/posts/hello/"])(
    "maps %s without duplicating indexed occurrences",
    (path) => {
      expect(indexedPaths(path, source)).toEqual(["/posts/hello"]);
    },
  );
  it("preserves encoded slugs and rejects unrelated paths", () => {
    expect(indexedPaths("/caf%C3%A9/", source)).toEqual(["/posts/caf%C3%A9"]);
    expect(indexedPaths("/private/hello", source)).toEqual([]);
  });
  it("requires locale identity and escapes literal route syntax", () => {
    const localized = collectionSourceSchema.parse({
      collection: "posts",
      path: "/{locale}/posts/{slug}",
      pathAliases: ["/{locale}/blog.v1/{slug}", "/{slug}"],
    });
    expect(indexedPaths("/de/blog.v1/thema", localized)).toEqual([
      "/de/posts/thema",
    ]);
    expect(indexedPaths("/de/blogXv1/thema", localized)).toEqual([]);
    expect(indexedPaths("/thema", localized)).toEqual([]);
  });
});

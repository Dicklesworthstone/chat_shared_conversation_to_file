/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { slugify, uniquePath, renderHtmlDocument, publishToGhPages } from "./index";

describe("slugify", () => {
  it("slugifies and lowercases titles", () => {
    expect(slugify("Hello World!")).toBe("hello_world");
  });

  it("falls back to chatgpt_conversation when empty", () => {
    expect(slugify("!!!")).toBe("chatgpt_conversation");
  });

  it("handles emoji and trims underscores", () => {
    expect(slugify("  🚀 Rocket  Plan ")).toBe("rocket_plan");
  });

  it("appends suffix for reserved names", () => {
    expect(slugify("CON")).toBe("con_chatgpt");
  });

  it("truncates very long titles", () => {
    const long = "a".repeat(200);
    expect(slugify(long)).toHaveLength(120);
  });
});

describe("renderHtmlDocument", () => {
  it("renders HTML with inline styles, toc, and no script tags", () => {
    const md = "# Title\n\n## Section\n\nContent with `code`."
    const html = renderHtmlDocument(md, "Sample Title", "https://example.com", "2024-01-01T00:00:00.000Z")
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain("<style>")
    expect(html).toContain("Contents")
    expect(html).toContain("language-")
    expect(/<script/i.test(html)).toBe(false)
  });
});

describe("publishToGhPages (dry run)", () => {
  it("generates manifest and index without pushing", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "csctm-ghp-dry-"));
    const mdPath = path.join(tmp, "sample.md");
    const htmlPath = path.join(tmp, "sample.html");
    writeFileSync(mdPath, "# Test\n", "utf8");
    writeFileSync(htmlPath, "<!doctype html><html></html>", "utf8");

    const cfg = await publishToGhPages({
      files: [
        { path: mdPath, kind: "md" },
        { path: htmlPath, kind: "html" }
      ],
      repo: "example/example",
      branch: "gh-pages",
      dir: "site",
      quiet: true,
      dryRun: true,
      remember: false,
      config: {},
      entry: { title: "Sample Title", md: "sample.md", html: "sample.html", addedAt: "2024-01-01T00:00:00.000Z" }
    });

    // dry-run should not modify config or attempt network
    expect(cfg).toEqual({});
  });
});

describe("uniquePath", () => {
  it("returns a non-conflicting path by incrementing suffixes", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "csctm-slug-"));
    const first = path.join(tmp, "file.md");
    writeFileSync(first, "one", "utf8");
    const second = uniquePath(first);
    expect(second.endsWith("_2.md")).toBe(true);
    writeFileSync(second, "two", "utf8");
    const third = uniquePath(first);
    expect(third.endsWith("_3.md")).toBe(true);
  });
});


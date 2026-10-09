/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { matchesShareUrl, publishToGhPages, renderHtmlDocument, slugify, uniquePath } from "./index";

describe("CDP share tab selection", () => {
  const requested = "https://claude.ai/share/conversation-42";

  it("accepts the requested share with a fragment or canonical trailing slash", () => {
    expect(matchesShareUrl(requested + "#message-2", requested)).toBe(true);
    expect(matchesShareUrl(requested + "/", requested)).toBe(true);
  });

  it("rejects unrelated tabs even when their URL contains the same share identifier", () => {
    for (const candidate of [
      "about:blank",
      "https://claude.ai/share/different-conversation",
      "https://example.com/share/conversation-42",
      "https://claude.ai/share/conversation-42-extra",
      "https://claude.ai/other/conversation-42",
      requested + "?access=other",
    ]) {
      expect(matchesShareUrl(candidate, requested)).toBe(false);
    }
  });
});

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
  it("keeps raw active HTML as text while preserving ordinary Markdown formatting", () => {
    const markdown = [
      "**formatting survives**",
      '<img src="data:image/png;base64,AA==" onerror="document.documentElement.dataset.csctfInjection=\'fired\'">',
      '<svg onload="document.documentElement.dataset.csctfInjection=\'fired\'"></svg>',
      '<iframe srcdoc="<p>embedded content</p>"></iframe>',
    ].join("\n\n");
    const html = renderHtmlDocument(markdown, "Untrusted markup", "https://example.com", "2026-10-09T00:00:00.000Z");
    expect(html).toContain("<strong>formatting survives</strong>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;svg");
    expect(html).toContain("&lt;iframe");
    expect(html).not.toMatch(/<(?:img|svg|iframe)\b/i);
  });

  it("renders HTML with inline styles, toc, and no script tags", () => {
    const md = "# Title\n\n## Section\n\nContent with `code`.";
    const html = renderHtmlDocument(
      md,
      "Sample Title",
      "https://example.com",
      "2024-01-01T00:00:00.000Z",
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
    expect(html).toContain("Contents");
    expect(html).toContain('<article class="article">');
    expect(/<script/i.test(html)).toBe(false);
  });
});

describe("publishToGhPages (dry run)", () => {
  it("generates manifest and index without pushing", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "csctf-ghp-dry-"));
    const mdPath = path.join(tmp, "sample.md");
    const htmlPath = path.join(tmp, "sample.html");
    writeFileSync(mdPath, "# Test\n", "utf8");
    writeFileSync(htmlPath, "<!doctype html><html></html>", "utf8");

    const cfg = await publishToGhPages({
      files: [
        { path: mdPath, kind: "md" },
        { path: htmlPath, kind: "html" },
      ],
      repo: "example/example",
      branch: "gh-pages",
      dir: "site",
      quiet: true,
      verbose: false,
      dryRun: true,
      remember: false,
      config: {},
      entry: {
        title: "Sample Title",
        md: "sample.md",
        html: "sample.html",
        addedAt: "2024-01-01T00:00:00.000Z",
      },
    });

    // dry-run should not modify config or attempt network
    expect(cfg).toEqual({});
  });
});

describe("uniquePath", () => {
  it("returns a non-conflicting path by incrementing suffixes", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "csctf-slug-"));
    const first = path.join(tmp, "file.md");
    writeFileSync(first, "one", "utf8");
    const second = uniquePath(first);
    expect(second.endsWith("_2.md")).toBe(true);
    writeFileSync(second, "two", "utf8");
    const third = uniquePath(first);
    expect(third.endsWith("_3.md")).toBe(true);
  });
});

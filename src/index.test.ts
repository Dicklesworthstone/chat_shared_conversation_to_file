/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { spawn, spawnSync } from "child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import http from "http";
import os from "os";
import path from "path";
import {
  allocateLoopbackPort,
  AUTO_HIGHLIGHT_LANGUAGES,
  createPrivateCdpProfileDir,
  matchesShareUrl,
  publishToGhPages,
  renderHtmlDocument,
  resolveChromiumExecutablePath,
  scrape,
  slugify,
  terminateOwnedChild,
  uniquePath,
} from "./index";

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

describe("highlight.js auto-detection curation (GH #6)", () => {
  const fence = "\x60".repeat(3);

  it("labels common untagged code blocks accurately without dns/dart/n1ql/arcade drift", () => {
    const samples: { name: string; code: string; expected: string[] }[] = [
      {
        name: "typescript",
        code: [
          "export interface Config {",
          "  readonly host: string;",
          "  port?: number;",
          "}",
          "export function connect(cfg: Config): Promise<void> {",
          "  return fetch(`https://${cfg.host}:${cfg.port ?? 443}`).then(() => {});",
          "}",
        ].join("\n"),
        expected: ["typescript", "javascript"],
      },
      {
        name: "javascript",
        code: [
          "const count = 42;",
          "console.log(count);",
          "function greet(name) { return `Hello, ${name}!`; }",
        ].join("\n"),
        expected: ["javascript", "typescript"],
      },
      {
        name: "sql",
        code: [
          "SELECT u.id, u.email, COUNT(o.id) AS total",
          "FROM users u",
          "LEFT JOIN orders o ON o.user_id = u.id",
          "WHERE u.active = TRUE",
          "GROUP BY u.id, u.email",
          "ORDER BY total DESC;",
        ].join("\n"),
        expected: ["sql"],
      },
      {
        name: "diff",
        code: [
          "--- a/src/index.ts",
          "+++ b/src/index.ts",
          "@@ -10,3 +10,4 @@",
          " const a = 1;",
          "-const b = 2;",
          "+const b = 3;",
          "+const c = 4;",
        ].join("\n"),
        expected: ["diff"],
      },
      {
        name: "rust",
        code: ["pub fn sum(xs: &[i64]) -> i64 {", "    xs.iter().copied().sum()", "}"].join("\n"),
        expected: ["rust"],
      },
      {
        name: "go",
        code: ['package main', 'import "fmt"', 'func main() { fmt.Println("hello") }'].join("\n"),
        expected: ["go"],
      },
      {
        name: "python",
        code: [
          "def fibonacci(n: int) -> list[int]:",
          "    seq = [0, 1]",
          "    for _ in range(n):",
          "        seq.append(seq[-1] + seq[-2])",
          "    return seq[:n]",
        ].join("\n"),
        expected: ["python"],
      },
    ];

    expect(AUTO_HIGHLIGHT_LANGUAGES).not.toContain("dns");
    expect(AUTO_HIGHLIGHT_LANGUAGES).not.toContain("dart");

    for (const sample of samples) {
      const md = [fence, sample.code, fence].join("\n");
      const html = renderHtmlDocument(md, sample.name, "https://example.com", "2026-11-21T00:00:00.000Z");
      const match = html.match(/<span class="code-lang">([^<]+)<\/span>/);
      expect(match).not.toBeNull();
      const detected = match![1];
      expect(sample.expected).toContain(detected);
      expect(["dns", "dart", "n1ql", "arcade"]).not.toContain(detected);
    }
  });

  it("still honors explicit language tags outside the auto-detect subset", () => {
    const md = [
      fence + "dart",
      "void main() => print('hello');",
      fence,
      "",
      fence + "dns",
      "example.com. 3600 IN A 93.184.216.34",
      fence,
    ].join("\n");
    const html = renderHtmlDocument(md, "Explicit Tags", "https://example.com", "2026-11-21T00:00:00.000Z");
    expect(html).toContain('<span class="code-lang">dart</span>');
    expect(html).toContain('<span class="code-lang">dns</span>');
  });
});

describe("patch-playwright.js fail-closed behavior (GH #5)", () => {
  it("exits non-zero when playwright-core layout is missing instead of silently skipping", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "csctf-pw-patch-fail-"));
    const scriptSrc = readFileSync(path.resolve(import.meta.dir, "../scripts/patch-playwright.js"), "utf8");
    const fakeScripts = path.join(tmp, "scripts");
    const fakePw = path.join(tmp, "node_modules", "playwright-core", "lib");
    Bun.spawnSync(["mkdir", "-p", fakeScripts, fakePw]);
    writeFileSync(path.join(fakeScripts, "patch-playwright.js"), scriptSrc, "utf8");
    writeFileSync(
      path.join(tmp, "node_modules", "playwright-core", "package.json"),
      JSON.stringify({ name: "playwright-core", version: "9.9.9" }),
      "utf8",
    );
    const res = spawnSync(process.execPath, [path.join(fakeScripts, "patch-playwright.js")], {
      encoding: "utf8",
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("Unrecognized playwright-core 9.9.9 directory layout");
  });
});

describe("CDP lifecycle isolation and safety (GH #2)", () => {
  it("contains no broad Chrome process kills or fixed shared profile/tab files", () => {
    const src = readFileSync(path.resolve(import.meta.dir, "./index.ts"), "utf8");
    expect(src).not.toContain("pkill");
    expect(src).not.toContain("osascript");
    expect(src).not.toContain("csctf-chrome-debug");
    expect(src).not.toContain("csctf-chrome-tabs.json");
  });

  it("allocates distinct loopback ports and private 0700 per-invocation profile dirs", async () => {
    const p1 = await allocateLoopbackPort();
    const p2 = await allocateLoopbackPort();
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(0);

    const d1 = createPrivateCdpProfileDir();
    const d2 = createPrivateCdpProfileDir();
    expect(d1).not.toBe(d2);
    if (process.platform !== "win32") {
      expect(statSync(d1).mode & 0o777).toBe(0o700);
      expect(statSync(d2).mode & 0o777).toBe(0o700);
    }
  });

  it("terminates only the owned child process without disturbing sibling processes", async () => {
    const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const sibling = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    try {
      expect(owned.pid).toBeDefined();
      expect(sibling.pid).toBeDefined();
      await terminateOwnedChild(owned, 1500);
      expect(owned.exitCode !== null || owned.signalCode !== null).toBe(true);
      // Sibling must remain alive.
      expect(sibling.exitCode).toBeNull();
      expect(sibling.signalCode).toBeNull();
      expect(() => process.kill(sibling.pid!, 0)).not.toThrow();
    } finally {
      await terminateOwnedChild(sibling, 1500);
    }
  });

  it("fails closed on unreachable explicit --cdp endpoint without launching a browser", async () => {
    const closedPort = await allocateLoopbackPort();
    await expect(
      scrape("https://chatgpt.com/share/test-unreachable", 3000, "chatgpt", {
        headless: true,
        quiet: true,
        cdpEndpoint: `http://127.0.0.1:${closedPort}`,
      }),
    ).rejects.toThrow(`Could not connect to Chrome CDP endpoint http://127.0.0.1:${closedPort}`);
  });

  it(
    "isolated real Chrome CDP attach preserves incumbent Chrome/tabs on absent, present, error, and concurrent scrapes",
    async () => {
      const chromePath = resolveChromiumExecutablePath();
      if (!chromePath) return; // Skip only when no Chrome/Chromium binary is installed on host.

      const server = http.createServer((req, res) => {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        if (req.url === "/other/conversation-42") {
          res.end(
            "<!doctype html><html><head><title>Unrelated Other Tab</title></head><body>" +
              '<article><div data-message-author-role="user">WRONG_TAB_SENTINEL</div></article></body></html>',
          );
        } else if (req.url === "/share/conversation-42") {
          res.end(
            "<!doctype html><html><head><title>ChatGPT - Real Share 42</title></head><body>" +
              '<article><div data-message-author-role="user"><p>Question 42</p></div></article>' +
              '<article><div data-message-author-role="assistant"><p>Answer 42 exact payload</p></div></article>' +
              "</body></html>",
          );
        } else if (req.url === "/share/conversation-99") {
          res.end(
            "<!doctype html><html><head><title>ChatGPT - Real Share 99</title></head><body>" +
              '<article><div data-message-author-role="user"><p>Question 99</p></div></article>' +
              '<article><div data-message-author-role="assistant"><p>Answer 99 concurrent payload</p></div></article>' +
              "</body></html>",
          );
        } else {
          res.end("<!doctype html><html><head><title>Empty</title></head><body><div>nothing</div></body></html>");
        }
      });

      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const httpAddr = server.address();
      const httpPort = typeof httpAddr === "object" && httpAddr ? httpAddr.port : 0;

      const launchIsolatedChrome = async (initialUrl: string) => {
        const port = await allocateLoopbackPort();
        const profile = createPrivateCdpProfileDir("csctf-test-incumbent-");
        const child = spawn(
          chromePath,
          [
            "--headless=new",
            `--remote-debugging-port=${port}`,
            `--user-data-dir=${profile}`,
            "--no-first-run",
            "--no-default-browser-check",
            initialUrl,
          ],
          { stdio: "ignore" },
        );
        const endpoint = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          try {
            const r = await fetch(`${endpoint}/json/version`);
            if (r.ok) return { child, endpoint, profile };
          } catch {
            // Wait for Chrome CDP socket.
          }
          await new Promise(r => setTimeout(r, 150));
        }
        await terminateOwnedChild(child);
        throw new Error(`Isolated test Chrome failed to start on ${endpoint}`);
      };

      const listPageTargets = async (endpoint: string) => {
        const r = await fetch(`${endpoint}/json/list`);
        const items = (await r.json()) as { type: string; url: string }[];
        return items.filter(t => t.type === "page").map(t => t.url);
      };

      const incumbentA = await launchIsolatedChrome(`http://127.0.0.1:${httpPort}/other/conversation-42`);
      const incumbentB = await launchIsolatedChrome(`http://127.0.0.1:${httpPort}/other/conversation-42`);

      try {
        const share42 = `http://127.0.0.1:${httpPort}/share/conversation-42`;
        const share99 = `http://127.0.0.1:${httpPort}/share/conversation-99`;
        const emptyUrl = `http://127.0.0.1:${httpPort}/share/empty-404`;

        // 1. Share absent: must NOT scrape /other/conversation-42; opens own tab, scrapes share42,
        // closes ONLY its own tab, leaves incumbentA + unrelated tab alive.
        const r1 = await scrape(share42, 15000, "chatgpt", {
          headless: true,
          quiet: true,
          cdpEndpoint: incumbentA.endpoint,
        });
        expect(r1.markdown).toContain("Answer 42 exact payload");
        expect(r1.markdown).not.toContain("WRONG_TAB_SENTINEL");
        expect(() => process.kill(incumbentA.child.pid!, 0)).not.toThrow();
        const tabsAfter1 = await listPageTargets(incumbentA.endpoint);
        expect(tabsAfter1).toContain(`http://127.0.0.1:${httpPort}/other/conversation-42`);
        expect(tabsAfter1).not.toContain(share42);

        // 2. Selector failure: fails visibly and still closes its opened tab & preserves incumbentA.
        await expect(
          scrape(emptyUrl, 8000, "chatgpt", {
            headless: true,
            quiet: true,
            cdpEndpoint: incumbentA.endpoint,
          }),
        ).rejects.toThrow("Could not find conversation content");
        expect(() => process.kill(incumbentA.child.pid!, 0)).not.toThrow();
        const tabsAfterErr = await listPageTargets(incumbentA.endpoint);
        expect(tabsAfterErr).toContain(`http://127.0.0.1:${httpPort}/other/conversation-42`);
        expect(tabsAfterErr).not.toContain(emptyUrl);

        // 3. Concurrent scrapes against two separate isolated CDP endpoints simultaneously.
        const [concA, concB] = await Promise.all([
          scrape(share42, 15000, "chatgpt", { headless: true, quiet: true, cdpEndpoint: incumbentA.endpoint }),
          scrape(share99, 15000, "chatgpt", { headless: true, quiet: true, cdpEndpoint: incumbentB.endpoint }),
        ]);
        expect(concA.markdown).toContain("Answer 42 exact payload");
        expect(concB.markdown).toContain("Answer 99 concurrent payload");
        expect(() => process.kill(incumbentA.child.pid!, 0)).not.toThrow();
        expect(() => process.kill(incumbentB.child.pid!, 0)).not.toThrow();
      } finally {
        await terminateOwnedChild(incumbentA.child);
        await terminateOwnedChild(incumbentB.child);
        server.close();
      }
    },
    45000,
  );
});

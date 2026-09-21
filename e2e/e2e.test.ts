/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";

const RUN_E2E = process.env.CSCTF_E2E === "1";
const SHARE_URL =
  process.env.CSCTF_E2E_URL ?? "https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70";
const GEMINI_URL =
  process.env.CSCTF_E2E_GEMINI_URL ?? "https://gemini.google.com/share/66d944b0e6b9";
const GROK_URL =
  process.env.CSCTF_E2E_GROK_URL ??
  "https://grok.com/share/bGVnYWN5_d5329c61-f497-40b7-9472-c555fa71af9c";

import { fileURLToPath } from "url";

const ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));
const BINARY = process.platform === "win32" ? "csctf.exe" : "csctf";
const BIN_PATH = path.join(ROOT, "dist", BINARY);
const E2E_TIMEOUT_MS = process.env.CSCTF_E2E_TIMEOUT_MS ?? "60000";

const TEST_TIMEOUT_MS = Number.parseInt(process.env.CSCTF_E2E_TEST_TIMEOUT_MS ?? "120000", 10);
const describeFn = RUN_E2E ? describe : describe.skip;
const describeGemini = RUN_E2E ? describe : describe.skip;
const describeGrok = RUN_E2E ? describe : describe.skip;

describeFn("csctf end-to-end", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "csctf-e2e-"));
    const cachePath =
      process.env.PLAYWRIGHT_BROWSERS_PATH ??
      (process.platform === "win32"
        ? path.join(process.env.USERPROFILE ?? os.tmpdir(), "AppData", "Local", "ms-playwright")
        : path.join(os.homedir(), ".cache", "ms-playwright"));
    console.log(`Playwright cache: ${cachePath}`);
    const build = spawnSync("bun", ["run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (build.status !== 0) {
      throw new Error("Build failed");
    }
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "scrapes the shared conversation into a valid markdown file",
    () => {
      const run = spawnSync(BIN_PATH, [SHARE_URL, "--timeout-ms", E2E_TIMEOUT_MS], {
        cwd: tmpDir,
        stdio: "inherit",
      });
      expect(run.status).toBe(0);

      const mdFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".md"));
      const htmlFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".html"));
      expect(mdFiles.length).toBeGreaterThan(0);
      expect(htmlFiles.length).toBeGreaterThan(0);

      const outfile = path.join(tmpDir, mdFiles[0]);
      const htmlOutfile = path.join(tmpDir, htmlFiles[0]);
      const content = readFileSync(outfile, "utf8");
      const normalized = content.replace(/\r\n/g, "\n");

      expect(path.basename(outfile)).toContain("phage_explorer_design_plan");
      expect(content.length).toBeGreaterThan(5000); // ensure reasonably large output
      expect(normalized.split("\n").length).toBeGreaterThan(200); // ensure many lines
      expect(normalized).toContain("# ChatGPT Conversation:");
      expect(normalized).toContain(`Source: ${SHARE_URL}`);
      expect(normalized).not.toMatch(/[\u2028\u2029\0]/); // no problematic unicode or nulls
      expect(normalized).not.toMatch(/\r(?!\n)/); // no stray CRs
      const retrievedLine = normalized.split("\n").find((line) => line.startsWith("Retrieved:"));
      expect(retrievedLine).toBeTruthy();
      expect(retrievedLine).toMatch(/^Retrieved:\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      // crude markdown fence balance check
      const fenceCount = (normalized.match(/```/g) || []).length;
      expect(fenceCount % 2).toBe(0);

      const html = readFileSync(htmlOutfile, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('<article class="article">');
      expect(html).toContain("Source:");
      expect(html).not.toMatch(/<script/i); // ensure no JS in output
      expect(html).toContain("<style>");
    },
    TEST_TIMEOUT_MS,
  );
});

describeGemini("csctf end-to-end (Gemini share)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "csctf-e2e-gemini-"));
    const build = spawnSync("bun", ["run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (build.status !== 0) {
      throw new Error("Build failed");
    }
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "scrapes the Gemini shared conversation into valid outputs",
    () => {
      const run = spawnSync(BIN_PATH, [GEMINI_URL as string], {
        cwd: tmpDir,
        stdio: "inherit",
      });
      expect(run.status).toBe(0);

      const mdFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".md"));
      const htmlFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".html"));
      expect(mdFiles.length).toBeGreaterThan(0);
      expect(htmlFiles.length).toBeGreaterThan(0);

      const outfile = path.join(tmpDir, mdFiles[0]);
      const htmlOutfile = path.join(tmpDir, htmlFiles[0]);
      const content = readFileSync(outfile, "utf8");
      const normalized = content.replace(/\r\n/g, "\n");

      expect(content.length).toBeGreaterThan(500);
      expect(normalized.split("\n").length).toBeGreaterThan(20);
      expect(normalized).toContain("Conversation:");
      expect(normalized).toContain(`Source: ${GEMINI_URL}`);
      expect(normalized).not.toMatch(/[\u2028\u2029\0]/);
      expect(normalized).not.toMatch(/\r(?!\n)/);
      const fenceCount = (normalized.match(/```/g) || []).length;
      expect(fenceCount % 2).toBe(0);

      const html = readFileSync(htmlOutfile, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('<article class="article">');
      expect(html).toContain("Source:");
      expect(html).not.toMatch(/<script/i);
      expect(html).toContain("<style>");
    },
    TEST_TIMEOUT_MS,
  );
});

describeGrok("csctf end-to-end (Grok share)", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "csctf-e2e-grok-"));
    const build = spawnSync("bun", ["run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
    });
    if (build.status !== 0) {
      throw new Error("Build failed");
    }
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "scrapes the Grok shared conversation into valid outputs",
    () => {
      const run = spawnSync(BIN_PATH, [GROK_URL as string], {
        cwd: tmpDir,
        stdio: "inherit",
      });
      expect(run.status).toBe(0);

      const mdFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".md"));
      const htmlFiles = readdirSync(tmpDir).filter((f) => f.endsWith(".html"));
      expect(mdFiles.length).toBeGreaterThan(0);
      expect(htmlFiles.length).toBeGreaterThan(0);

      const outfile = path.join(tmpDir, mdFiles[0]);
      const htmlOutfile = path.join(tmpDir, htmlFiles[0]);
      const content = readFileSync(outfile, "utf8");
      const normalized = content.replace(/\r\n/g, "\n");

      expect(content.length).toBeGreaterThan(500);
      expect(normalized.split("\n").length).toBeGreaterThan(20);
      expect(normalized).toContain("Conversation:");
      expect(normalized).toContain(`Source: ${GROK_URL}`);
      expect(normalized).not.toMatch(/[\u2028\u2029\0]/);
      expect(normalized).not.toMatch(/\r(?!\n)/);
      const fenceCount = (normalized.match(/```/g) || []).length;
      expect(fenceCount % 2).toBe(0);

      const html = readFileSync(htmlOutfile, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain('<article class="article">');
      expect(html).toContain("Source:");
      expect(html).not.toMatch(/<script/i);
      expect(html).toContain("<style>");
    },
    TEST_TIMEOUT_MS,
  );
});

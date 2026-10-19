/// <reference types="bun-types" />
import { beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { chromium } from "playwright-chromium";
import { renderHtmlDocument } from "../src/index";

const RUN_E2E = process.env.CSCTF_E2E === "1";
const SHARE_URL =
  process.env.CSCTF_E2E_URL ?? "https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70";
const GEMINI_URL =
  process.env.CSCTF_E2E_GEMINI_URL ?? "https://gemini.google.com/share/66d944b0e6b9";
const GROK_URL =
  process.env.CSCTF_E2E_GROK_URL ??
  "https://grok.com/share/bGVnYWN5_d5329c61-f497-40b7-9472-c555fa71af9c";

const BIN_PATH = process.env.CSCTF_E2E_BINARY;
const E2E_TIMEOUT_MS = process.env.CSCTF_E2E_TIMEOUT_MS ?? "60000";

const TEST_TIMEOUT_MS = Number.parseInt(process.env.CSCTF_E2E_TEST_TIMEOUT_MS ?? "120000", 10);
const describeFn = RUN_E2E ? describe : describe.skip;
const describeGemini = RUN_E2E ? describe : describe.skip;
const describeGrok = RUN_E2E ? describe : describe.skip;
const describeHtmlSecurity = process.env.CSCTF_HTML_SECURITY_E2E === "1" ? describe : describe.skip;

function retainedOutput(prefix: string): string {
  const parent = process.env.CSCTF_E2E_ARTIFACT_DIR;
  if (!parent || !existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error("Require an existing retained CSCTF_E2E_ARTIFACT_DIR; outputs are not auto-cleaned");
  }
  const output = mkdtempSync(path.join(parent, prefix));
  console.error("Retaining E2E outputs:", output);
  return output;
}

function requireRealBinary(): string {
  if (!BIN_PATH || !existsSync(BIN_PATH) || !statSync(BIN_PATH).isFile()) {
    throw new Error("Set CSCTF_E2E_BINARY to the actual artifact built through the admitted release lane");
  }
  return BIN_PATH;
}

const describeInstaller = process.env.CSCTF_INSTALL_E2E === "1" ? describe : describe.skip;
const INSTALLER_PATH = path.resolve(import.meta.dir, "../install.sh");
const INSTALL_TEST_TIMEOUT_MS = 600_000;
let commandSequence = 0;
let installerFixturePromise: ReturnType<typeof prepareInstallerFixture> | undefined;

async function runActual(command: string[], output: string, env: Record<string, string | undefined> = {}, input?: string) {
  const child = Bun.spawn(command, {
    env: { ...process.env, ...env }, stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  if (input !== undefined) child.stdin.write(input);
  child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  writeFileSync(path.join(output, "command-" + ++commandSequence + ".json"), JSON.stringify({ command, code, stdout, stderr }, null, 2));
  return { stdout, stderr, code };
}

function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

async function prepareInstallerFixture() {
  const version = process.env.CSCTF_INSTALL_E2E_VERSION;
  if (!version || !/^[a-zA-Z0-9._+-]+$/.test(version)) throw new Error("Require a freshly bound CSCTF_INSTALL_E2E_VERSION");
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("Separate admitted native Windows installer adaptation is required");
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : undefined;
  if (!arch) throw new Error("Unsupported actual host architecture: " + process.arch);
  const root = retainedOutput("csctf-installer-");
  const asset = "csctf-" + (process.platform === "darwin" ? "macos" : "linux") + "-" + arch;
  const base = "https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/download/" + encodeURIComponent(version);
  for (const name of [asset + ".sha256", asset]) {
    const downloaded = await runActual(["curl", "-fSL", "--max-time", "180", "-A", "csctf-installer-e2e (+https://github.com/Dicklesworthstone/chat_shared_conversation_to_file)", base + "/" + name, "-o", path.join(root, name)], root);
    if (downloaded.code !== 0) throw new Error("Real published artifact download failed: " + downloaded.stderr);
  }
  const row = readFileSync(path.join(root, asset + ".sha256"), "utf8").trim().split(/\s+/);
  expect(row).toHaveLength(2);
  expect(row[0]).toMatch(/^[a-fA-F0-9]{64}$/);
  expect(row[1].replace(/^\*/, "")).toBe(asset);
  const expected = row[0].toLowerCase();
  expect(digest(path.join(root, asset))).toBe(expected);
  return { root, asset, version, base, expected, bash: process.platform === "darwin" ? "/bin/bash" : Bun.which("bash") ?? "/bin/bash" };
}

function installerFixture() {
  installerFixturePromise ??= prepareInstallerFixture();
  return installerFixturePromise;
}

function installerTarget(root: string) {
  const output = mkdtempSync(path.join(root, "case-"));
  const bin = path.join(output, "bin with spaces");
  mkdirSync(bin);
  return { output, bin, binary: path.join(bin, "csctf") };
}

async function runInstaller(f: Awaited<ReturnType<typeof installerFixture>>, target: ReturnType<typeof installerTarget>, args: string[] = [], env: Record<string, string | undefined> = {}) {
  return runActual([f.bash, "-s", "--", ...args], target.output, {
    DEST: target.bin, VERSION: f.version,
    ...(process.platform === "darwin" ? { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } : {}),
    ...env,
  }, readFileSync(INSTALLER_PATH, "utf8"));
}

describeInstaller("csctf real public installer", () => {
  it("installs published bytes through stdin with an exact digest and native version", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    const installed = await runInstaller(f, target);
    expect(installed.code).toBe(0);
    expect(installed.stdout).toContain("Checksum verified: " + f.asset);
    expect(digest(target.binary)).toBe(f.expected);
    const version = await runActual([target.binary, "--version"], target.output);
    expect(version.code).toBe(0);
    expect(version.stdout).toBe("csctf v" + f.version.replace(/^v/, "") + "\n");
  }, INSTALL_TEST_TIMEOUT_MS);

  it("skips an exact reinstall without a new stage, backup or download; --force reinstalls", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    const leftovers = () => readdirSync(target.bin).filter((name) => name.startsWith(".csctf-stage.") || name.includes(".previous")).sort();
    expect((await runInstaller(f, target)).code).toBe(0);
    const afterFirst = leftovers();
    expect(afterFirst).toEqual([]);
    const again = await runInstaller(f, target);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("is already installed");
    expect(again.stdout).not.toContain("Checksum verified");
    expect(leftovers()).toEqual(afterFirst);
    expect(digest(target.binary)).toBe(f.expected);
    const forced = await runInstaller(f, target, ["--force"]);
    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain("Checksum verified: " + f.asset);
    // The stage is removed and the incumbent is kept as the single rollback copy.
    expect(leftovers()).toEqual(["csctf.previous"]);
    expect(digest(target.binary)).toBe(f.expected);
    expect(digest(target.binary + ".previous")).toBe(f.expected);
  }, INSTALL_TEST_TIMEOUT_MS);

  it("names, but never removes, stages and backups left by earlier installers", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    writeFileSync(target.binary, "#!/bin/sh\necho 'csctf v0.0.0-other'\n", { mode: 0o755 });
    mkdirSync(path.join(target.bin, ".csctf-stage.OLDRUN"));
    writeFileSync(path.join(target.bin, "csctf.previous.OLDRUN"), "older incumbent", { mode: 0o755 });
    const installed = await runInstaller(f, target, ["--quiet"]);
    expect(installed.code).toBe(0);
    expect(installed.stderr).toContain("2 stage dir(s)/backup(s) left in");
    expect(readdirSync(target.bin).sort()).toEqual([".csctf-install.lock", ".csctf-stage.OLDRUN", "csctf", "csctf.previous", "csctf.previous.OLDRUN"]);
    expect(readFileSync(path.join(target.bin, "csctf.previous.OLDRUN"), "utf8")).toBe("older incumbent");
    expect(digest(target.binary)).toBe(f.expected);
  }, INSTALL_TEST_TIMEOUT_MS);

  it("replaces an incumbent that reports a different version", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    writeFileSync(target.binary, "#!/bin/sh\necho 'csctf v0.0.0-other'\n", { mode: 0o755 });
    const installed = await runInstaller(f, target);
    expect(installed.code).toBe(0);
    expect(installed.stdout).not.toContain("is already installed");
    expect(installed.stdout).toContain("Checksum verified: " + f.asset);
    expect(digest(target.binary)).toBe(f.expected);
  }, INSTALL_TEST_TIMEOUT_MS);

  it("keeps an incumbent on real missing-release failure without building unrelated source", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    writeFileSync(target.binary, "retain incumbent bytes", { mode: 0o755 });
    const failed = await runInstaller(f, target, [], { VERSION: f.version + "-missing-" + randomUUID() });
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("Binary download failed");
    expect(failed.stdout).not.toContain("Building from source");
    expect(failed.stdout).not.toContain("Done. Run:");
    expect(readFileSync(target.binary, "utf8")).toBe("retain incumbent bytes");
    expect(readdirSync(target.bin).sort()).toEqual([".csctf-install.lock", "csctf"]);
  }, INSTALL_TEST_TIMEOUT_MS);

  it("missing actual hash tools is fatal even in quiet mode", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    writeFileSync(target.binary, "retain incumbent bytes", { mode: 0o755 });
    const tools = path.join(target.output, "real-tools-without-sha");
    mkdirSync(tools);
    for (const name of ["bash", "perl", "curl", "awk", "mkdir", "uname", "tr", "grep", "sed", "mktemp"]) {
      const executable = name === "bash" ? f.bash : Bun.which(name);
      if (!executable) throw new Error("Real prerequisite unavailable: " + name);
      symlinkSync(executable, path.join(tools, name));
    }
    const failed = await runInstaller(f, target, ["--quiet"], { PATH: tools });
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("sha256sum or shasum is required");
    expect(failed.stdout).not.toContain("Checksum verified");
    expect(readFileSync(target.binary, "utf8")).toBe("retain incumbent bytes");
  }, INSTALL_TEST_TIMEOUT_MS);

  it("actual checksum consumer rejects corrupted public bytes and ambiguous or malformed manifests", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    const verify = (binary: string, manifest: string) => runActual([
      f.bash, "-c", 'source "$1"; ASSET="$3"; verify_artifact "$2" "$4"',
      "csctf-integrity", INSTALLER_PATH, binary, f.asset, manifest,
    ], target.output);
    const published = path.join(f.root, f.asset);
    const sidecar = path.join(f.root, f.asset + ".sha256");
    expect((await verify(published, sidecar)).code).toBe(0);
    const corrupt = path.join(target.output, "corrupted-published-binary");
    copyFileSync(published, corrupt);
    appendFileSync(corrupt, new Uint8Array([0]));
    const changed = await verify(corrupt, sidecar);
    expect(changed.code).not.toBe(0);
    expect(changed.stderr).toContain("Checksum verification failed");
    for (const [name, rows] of [
      ["duplicate", (f.expected + "  " + f.asset + "\n").repeat(2)],
      ["malformed", f.expected + "  " + f.asset + " unexpected-field\n"],
      ["missing", f.expected + "  wrong-asset-name\n"],
    ]) {
      const manifest = path.join(target.output, name + ".sha256");
      writeFileSync(manifest, rows);
      const failed = await verify(published, manifest);
      expect(failed.code).not.toBe(0);
      expect(failed.stderr).toContain("Missing, malformed, or duplicate checksum");
      expect(failed.stdout).not.toContain("Checksum verified");
    }
  }, INSTALL_TEST_TIMEOUT_MS);

  it("explicit opt-out warns and does not report checksum verification", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    const installed = await runInstaller(f, target, ["--no-verify"], { CHECKSUM_URL: f.base + "/checksum-missing-" + randomUUID() });
    expect(installed.code).toBe(0);
    expect(installed.stderr).toContain("Checksum verification explicitly disabled");
    expect(installed.stdout).not.toContain("Checksum verified");
    expect(digest(target.binary)).toBe(f.expected);
  }, INSTALL_TEST_TIMEOUT_MS);

  it("actual competing kernel lock prevents download, then allows installation after release", async () => {
    const f = await installerFixture();
    const target = installerTarget(f.root);
    writeFileSync(target.binary, "retain incumbent bytes", { mode: 0o755 });
    const perl = Bun.which("perl");
    if (!perl) throw new Error("Independent real kernel-lock probe requires Perl");
    const holder = Bun.spawn([perl, "-MFcntl=:flock", "-e",
      'open my $f, ">>", $ARGV[0] or die $!; flock($f, LOCK_EX) or die $!; $|=1; print "LOCKED\\n"; <STDIN>;',
      path.join(target.bin, ".csctf-install.lock")],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    try {
      const reader = holder.stdout.getReader();
      let ready = "";
      while (!ready.includes("\n")) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Kernel-lock holder exited before acquiring its lock");
        ready += new TextDecoder().decode(chunk.value);
      }
      reader.releaseLock();
      expect(ready).toBe("LOCKED\n");
      const failed = await runInstaller(f, target);
      expect(failed.code).not.toBe(0);
      expect(failed.stdout).not.toContain("Downloading");
      expect(readdirSync(target.bin).some(name => name.startsWith(".csctf-stage."))).toBe(false);
      expect(readFileSync(target.binary, "utf8")).toBe("retain incumbent bytes");
    } finally {
      holder.stdin.end();
      const [code, stderr] = await Promise.all([holder.exited, new Response(holder.stderr).text()]);
      writeFileSync(path.join(target.output, "independent-lock-holder.json"), JSON.stringify({ code, stderr }));
      expect(code).toBe(0);
      expect(stderr).toBe("");
    }
    const installed = await runInstaller(f, target);
    expect(installed.code).toBe(0);
    expect(digest(target.binary)).toBe(f.expected);
    expect(readdirSync(target.bin).sort()).toEqual([".csctf-install.lock", "csctf", "csctf.previous"]);
    expect(readFileSync(target.binary + ".previous", "utf8")).toBe("retain incumbent bytes");
  }, INSTALL_TEST_TIMEOUT_MS);
});

describeHtmlSecurity("csctf static HTML in a real browser", () => {
  it("does not execute raw active markup and displays fenced examples literally", async () => {
    const output = retainedOutput("csctf-html-security-");
    const fence = "\x60".repeat(3);
    const example = "<script>document.documentElement.dataset.csctfInjection='fenced'</script>";
    const untaggedExample = "const count = 42;\nconsole.log(count)";
    const markdown = [
      "**formatting survives**",
      '<img src="data:image/png;base64,AA==" onerror="document.documentElement.dataset.csctfInjection=\'fired\'">',
      '<svg onload="document.documentElement.dataset.csctfInjection=\'fired\'"></svg>',
      '<iframe srcdoc="<p>embedded content</p>"></iframe>',
      [fence + "html", example, fence].join("\n"),
      [fence, untaggedExample, fence].join("\n"),
    ].join("\n\n");
    const html = renderHtmlDocument(markdown, "Untrusted markup", "https://example.com", "2026-10-09T00:00:00.000Z");
    writeFileSync(path.join(output, "rendered.html"), html);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const observed = await page.evaluate(() => ({
        injection: document.documentElement.dataset.csctfInjection ?? null,
        embeddedElements: document.querySelectorAll(".content img, .content svg, .content iframe").length,
        bold: document.querySelector(".content strong")?.textContent,
        code: Array.from(document.querySelectorAll(".content pre code")).map(node => node.textContent?.trim()),
        text: document.querySelector(".content")?.textContent,
      }));
      writeFileSync(path.join(output, "browser-observation.json"), JSON.stringify(observed, null, 2));
      expect(observed.injection).toBeNull();
      expect(observed.embeddedElements).toBe(0);
      expect(observed.bold).toBe("formatting survives");
      expect(observed.code).toEqual([example, untaggedExample]);
      expect(observed.text).toContain("<img");
      expect(observed.text).toContain("<svg");
      expect(observed.text).toContain("<iframe");
    } finally {
      await browser.close();
    }
  }, TEST_TIMEOUT_MS);
});

describeFn("csctf end-to-end", () => {
  let tmpDir: string;

  beforeAll(() => {
    requireRealBinary();
    tmpDir = retainedOutput("csctf-e2e-");
    const cachePath =
      process.env.PLAYWRIGHT_BROWSERS_PATH ??
      (process.platform === "win32"
        ? path.join(process.env.USERPROFILE ?? os.tmpdir(), "AppData", "Local", "ms-playwright")
        : path.join(os.homedir(), ".cache", "ms-playwright"));
    console.log(`Playwright cache: ${cachePath}`);
  });

  it(
    "scrapes the shared conversation into a valid markdown file",
    () => {
      const run = spawnSync(requireRealBinary(), [SHARE_URL, "--timeout-ms", E2E_TIMEOUT_MS], {
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
    requireRealBinary();
    tmpDir = retainedOutput("csctf-e2e-gemini-");
  });

  it(
    "scrapes the Gemini shared conversation into valid outputs",
    () => {
      const run = spawnSync(requireRealBinary(), [GEMINI_URL as string], {
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
    requireRealBinary();
    tmpDir = retainedOutput("csctf-e2e-grok-");
  });

  it(
    "scrapes the Grok shared conversation into valid outputs",
    () => {
      const run = spawnSync(requireRealBinary(), [GROK_URL as string], {
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

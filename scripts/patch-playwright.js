#!/usr/bin/env node
/**
 * Patch Playwright for Bun standalone executable (`bun build --compile`) compatibility.
 *
 * Problem: Playwright uses dynamic require() / require.resolve() calls against
 * __dirname / packageRoot to load package.json and browsers.json at runtime.
 * When bundled with `bun build --compile`, __dirname resolves to build-machine
 * or virtual /$bunfs paths that do not exist when the compiled binary runs on
 * another path or host.
 *
 * Solution: Inline the required JSON metadata and fallbacks directly into
 * playwright-core's runtime files before compilation, supporting both:
 *   - Bundled layout (playwright-core >= 1.60.0):
 *       lib/package.js, lib/serverRegistry.js, lib/coreBundle.js
 *   - Legacy unbundled layout (playwright-core <= 1.59.x):
 *       lib/server/utils/nodePlatform.js, lib/server/utils/userAgent.js,
 *       lib/server/registry/dependencies.js, lib/cli/program.js
 *
 * Fails closed (non-zero exit) if playwright-core is missing or any required
 * patch target cannot be located/matched, so upstream layout changes can never
 * silently produce a broken standalone binary.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const playwrightCorePath = path.join(rootDir, "node_modules", "playwright-core");

function fail(message) {
  console.error(`[patch-playwright] ERROR: ${message}`);
  process.exit(1);
}

const pkgPath = path.join(playwrightCorePath, "package.json");
if (!fs.existsSync(pkgPath)) {
  fail(`playwright-core package.json not found at ${pkgPath}`);
}

let playwrightPkg;
try {
  playwrightPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
} catch (err) {
  fail(`Could not parse playwright-core package.json: ${err.message}`);
}

const playwrightVersion = playwrightPkg.version;
if (!playwrightVersion) {
  fail("playwright-core package.json is missing version");
}

const inlinePackageJson = JSON.stringify({
  name: playwrightPkg.name || "playwright-core",
  version: playwrightVersion,
});

console.log(`[patch-playwright] Detected playwright-core version: ${playwrightVersion}`);

/**
 * Apply required patches to a file. Idempotent across repeated installs via
 * marker checks; fails closed if a required file or pattern is missing.
 */
function applyPatches(relativePath, patches) {
  const filePath = path.join(playwrightCorePath, relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`Required target file not found: ${relativePath}`);
  }

  let content = fs.readFileSync(filePath, "utf8");
  let modified = false;

  for (const { pattern, replacement, marker, description } of patches) {
    if (content.includes(marker)) {
      console.log(`[patch-playwright] ${relativePath}: already patched (${description})`);
      continue;
    }
    if (!pattern.test(content)) {
      fail(`Expected pattern not found in ${relativePath}: ${description}`);
    }
    pattern.lastIndex = 0;
    content = content.replace(pattern, replacement);
    console.log(`[patch-playwright] ${relativePath}: ${description}`);
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

const isBundledLayout = fs.existsSync(path.join(playwrightCorePath, "lib", "coreBundle.js"));
const isLegacyLayout = fs.existsSync(
  path.join(playwrightCorePath, "lib", "server", "utils", "nodePlatform.js")
);

if (isBundledLayout) {
  console.log("[patch-playwright] Applying bundled layout patches (playwright-core >= 1.60)...");

  const browsersPath = path.join(playwrightCorePath, "browsers.json");
  if (!fs.existsSync(browsersPath)) {
    fail(`playwright-core browsers.json not found at ${browsersPath}`);
  }
  let browsersJson;
  try {
    browsersJson = JSON.parse(fs.readFileSync(browsersPath, "utf8"));
  } catch (err) {
    fail(`Could not parse playwright-core browsers.json: ${err.message}`);
  }
  const inlineBrowsersJson = JSON.stringify(browsersJson);

  applyPatches("lib/package.js", [
    {
      marker: "/* PATCHED_PACKAGE_JSON_LIB_PACKAGE */",
      pattern:
        /const packageJSON = require\([A-Za-z0-9_$]+\.default\.join\(packageRoot,\s*"package\.json"\)\);/g,
      replacement: `/* PATCHED_PACKAGE_JSON_LIB_PACKAGE */ const packageJSON = ${inlinePackageJson};`,
      description: "inlined packageJSON",
    },
  ]);

  applyPatches("lib/serverRegistry.js", [
    {
      marker: "/* PATCHED_PACKAGE_JSON_SERVER_REGISTRY */",
      pattern:
        /var packageJSON = require\([A-Za-z0-9_$]+\.default\.join\(packageRoot,\s*"package\.json"\)\);/g,
      replacement: `/* PATCHED_PACKAGE_JSON_SERVER_REGISTRY */ var packageJSON = ${inlinePackageJson};`,
      description: "inlined packageJSON",
    },
  ]);

  applyPatches("lib/coreBundle.js", [
    {
      marker: "/* PATCHED_PACKAGE_JSON_CORE_BUNDLE */",
      pattern:
        /packageJSON = require\([A-Za-z0-9_$]+\.default\.join\(packageRoot,\s*"package\.json"\)\);/g,
      replacement: `/* PATCHED_PACKAGE_JSON_CORE_BUNDLE */ packageJSON = ${inlinePackageJson};`,
      description: "inlined packageJSON",
    },
    {
      marker: "/* PATCHED_BROWSERS_JSON_CORE_BUNDLE */",
      pattern:
        /registry = new Registry\(require\([A-Za-z0-9_$]+\.default\.join\(packageRoot,\s*"browsers\.json"\)\)\);/g,
      replacement: `/* PATCHED_BROWSERS_JSON_CORE_BUNDLE */ registry = new Registry(${inlineBrowsersJson});`,
      description: "inlined browsers.json registry metadata",
    },
    {
      marker: "/* PATCHED_REF_PACKAGE_JSON_CORE_BUNDLE */",
      pattern:
        /const packageJSON2 = require\([A-Za-z0-9_$]+\.default\.join\(browser\.referenceDir,\s*"package\.json"\)\);/g,
      replacement: `/* PATCHED_REF_PACKAGE_JSON_CORE_BUNDLE */ const packageJSON2 = { version: "unknown" };`,
      description: "replaced dynamic browser referenceDir package.json require with fallback",
    },
  ]);
} else if (isLegacyLayout) {
  console.log("[patch-playwright] Applying legacy layout patches (playwright-core <= 1.59)...");

  applyPatches("lib/server/utils/nodePlatform.js", [
    {
      marker: "/* PATCHED_LEGACY_CORE_DIR */",
      pattern:
        /const coreDir = import_path\.default\.dirname\(require\.resolve\("\.\.\/\.\.\/\.\.\/package\.json"\)\);/g,
      replacement: `/* PATCHED_LEGACY_CORE_DIR */ const coreDir = "";`,
      description: "replaced coreDir require.resolve with empty string",
    },
  ]);

  applyPatches("lib/server/utils/userAgent.js", [
    {
      marker: "/* PATCHED_LEGACY_USER_AGENT */",
      pattern:
        /const version = process\.env\.PW_VERSION_OVERRIDE \|\| require\("[^"]+package\.json"\)\.version;/g,
      replacement: `/* PATCHED_LEGACY_USER_AGENT */ const version = process.env.PW_VERSION_OVERRIDE || "${playwrightVersion}";`,
      description: "inlined playwright version string",
    },
  ]);

  applyPatches("lib/server/registry/dependencies.js", [
    {
      marker: "/* PATCHED_LEGACY_DEPENDENCIES */",
      pattern:
        /const languageBindingVersion = process\.env\.PW_CLI_DISPLAY_VERSION \|\| require\("\.\.\/\.\.\/\.\.\/package\.json"\)\.version;/g,
      replacement: `/* PATCHED_LEGACY_DEPENDENCIES */ const languageBindingVersion = process.env.PW_CLI_DISPLAY_VERSION || "${playwrightVersion}";`,
      description: "inlined languageBindingVersion string",
    },
  ]);

  applyPatches("lib/cli/program.js", [
    {
      marker: "/* PATCHED_LEGACY_PROGRAM_PKG */",
      pattern: /const packageJSON = require\("\.\.\/\.\.\/package\.json"\);/g,
      replacement: `/* PATCHED_LEGACY_PROGRAM_PKG */ const packageJSON = ${inlinePackageJson};`,
      description: "inlined packageJSON object",
    },
    {
      marker: "/* PATCHED_LEGACY_PROGRAM_REF */",
      pattern:
        /const packageJSON2 = require\(import_path\.default\.join\(browser\.referenceDir, "package\.json"\)\);/g,
      replacement: `/* PATCHED_LEGACY_PROGRAM_REF */ const packageJSON2 = { version: "unknown" };`,
      description: "replaced dynamic browser packageJSON require with fallback",
    },
  ]);
} else {
  fail(
    `Unrecognized playwright-core ${playwrightVersion} directory layout under ${playwrightCorePath}/lib`
  );
}

console.log("[patch-playwright] Patching complete!");

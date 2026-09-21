#!/usr/bin/env node
/**
 * Patch Playwright for Bun bundling compatibility.
 *
 * Problem: Playwright uses dynamic require.resolve() calls to find package.json
 * files at runtime. When bundled with `bun build --compile`, these paths get
 * baked in as absolute paths from the build machine, which don't exist at runtime.
 *
 * Solution: Replace the problematic require.resolve() calls with:
 * 1. Inline version strings (from package.json at patch time)
 * 2. Fallback coreDir that won't cause errors
 *
 * Files patched:
 * - node_modules/playwright-core/lib/server/utils/nodePlatform.js
 * - node_modules/playwright-core/lib/server/utils/userAgent.js
 * - node_modules/playwright-core/lib/server/registry/dependencies.js
 * - node_modules/playwright-core/lib/cli/program.js
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const playwrightCorePath = path.join(rootDir, "node_modules", "playwright-core");

// Read the playwright-core version
let playwrightVersion = "unknown";
try {
  const pkgPath = path.join(playwrightCorePath, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  playwrightVersion = pkg.version || "unknown";
  console.log(`[patch-playwright] Detected playwright-core version: ${playwrightVersion}`);
} catch (err) {
  console.error("[patch-playwright] Could not read playwright-core version:", err.message);
}

/**
 * Patch a file by replacing patterns
 */
function patchFile(relativePath, patches) {
  const filePath = path.join(playwrightCorePath, relativePath);

  if (!fs.existsSync(filePath)) {
    console.log(`[patch-playwright] Skipping ${relativePath} (not found)`);
    return false;
  }

  let content = fs.readFileSync(filePath, "utf8");
  let modified = false;

  for (const { pattern, replacement, description } of patches) {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      console.log(`[patch-playwright] ${relativePath}: ${description}`);
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, "utf8");
  }

  return modified;
}

// Patch 1: nodePlatform.js - Replace require.resolve for coreDir
patchFile("lib/server/utils/nodePlatform.js", [
  {
    pattern:
      /const coreDir = import_path\.default\.dirname\(require\.resolve\("\.\.\/\.\.\/\.\.\/package\.json"\)\);/g,
    replacement: `// PATCHED: Avoid require.resolve which breaks bun compile
const coreDir = "";`,
    description:
      "Replaced coreDir require.resolve with empty string (only used for stack trace filtering)",
  },
]);

// Patch 2: userAgent.js - Replace require for version
patchFile("lib/server/utils/userAgent.js", [
  {
    pattern:
      /const version = process\.env\.PW_VERSION_OVERRIDE \|\| require\("[^"]+package\.json"\)\.version;/g,
    replacement: `// PATCHED: Inline version to avoid require which breaks bun compile
const version = process.env.PW_VERSION_OVERRIDE || "${playwrightVersion}";`,
    description: "Inlined playwright version string",
  },
]);

// Patch 3: dependencies.js - Replace require for version
patchFile("lib/server/registry/dependencies.js", [
  {
    pattern:
      /const languageBindingVersion = process\.env\.PW_CLI_DISPLAY_VERSION \|\| require\("\.\.\/\.\.\/\.\.\/package\.json"\)\.version;/g,
    replacement: `// PATCHED: Inline version to avoid require which breaks bun compile
const languageBindingVersion = process.env.PW_CLI_DISPLAY_VERSION || "${playwrightVersion}";`,
    description: "Inlined languageBindingVersion string",
  },
]);

// Patch 4: program.js - Multiple requires
patchFile("lib/cli/program.js", [
  {
    pattern: /const packageJSON = require\("\.\.\/\.\.\/package\.json"\);/g,
    replacement: `// PATCHED: Inline package info to avoid require which breaks bun compile
const packageJSON = { version: "${playwrightVersion}", name: "playwright-core" };`,
    description: "Inlined packageJSON object",
  },
  {
    pattern:
      /const packageJSON2 = require\(import_path\.default\.join\(browser\.referenceDir, "package\.json"\)\);/g,
    replacement: `// PATCHED: Use fallback for browser packageJSON
const packageJSON2 = { version: "unknown" };`,
    description: "Replaced dynamic browser packageJSON require with fallback",
  },
]);

console.log("[patch-playwright] Patching complete!");

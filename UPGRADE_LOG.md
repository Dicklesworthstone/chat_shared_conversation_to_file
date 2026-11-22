# Dependency Upgrade Log

**Date:** 2026-11-21  |  **Project:** chat_shared_conversation_to_file  |  **Language:** TypeScript (Bun)

## Summary
- **Updated:** 11
- **Removed:** 1 (`@types/markdown-it`, superseded by `markdown-it@15` built-in declarations)
- **Held:** 1 (`typescript` at `~6.0.3` because `typescript-eslint@8.73.0` peerDependencies cap TypeScript at `<6.1.0`; tracked in #7)
- **Security audit (`bun audit`):** 57 vulnerabilities (1 critical, 35 high, 20 moderate, 1 low) -> **0 vulnerabilities** (`overrides.picomatch >=4.0.4`)

## Updates

| Package | Old | New | Notes |
|---------|-----|-----|-------|
| chalk | 5.6.2 | 6.0.1 | Latest major |
| highlight.js | 11.11.1 | 11.12.0 | Fixes C/C++ grammar ReDoS; paired with curated `AUTO_HIGHLIGHT_LANGUAGES` (#6) |
| markdown-it | 14.1.0 | 15.0.3 | Built-in TypeScript types; fixes 6 markdown-it & linkify-it advisories |
| playwright-chromium | 1.57.0 | 1.65.1 | `scripts/patch-playwright.js` updated for 1.60+ bundled layout & fail-closed checks (#5) |
| puppeteer-core | 24.35.0 | 25.18.1 | Fixes transitive `basic-ftp`, `ws`, and `zod` advisories |
| turndown | 7.2.2 | 7.2.5 | Latest patch |
| @types/node | 24.10.9 | 24.19.2 | Latest Node 24 LTS types |
| bun-types | 1.3.6 | 1.4.5 | Matches Bun 1.4 toolchain |
| eslint | 9.39.2 | 10.15.0 | Fixes transitive `@humanfs/node`, `ajv`, `brace-expansion`, `js-yaml`, `minimatch` advisories |
| typescript | 5.9.3 | 6.0.3 | Updated JSON import attribute to `with { type: 'json' }`; TS 7 held on `typescript-eslint` (#7) |
| typescript-eslint | 8.53.0 | 8.73.0 | Compatible with ESLint 10 and TypeScript 6.0.3 |

## Verification

- `bun run check` (`eslint --max-warnings=0` + `tsc --noEmit`) — PASS
- `bun test` (unit + real isolated Chrome CDP integration tests) — PASS
- `bun audit` — 0 vulnerabilities
- `bun scripts/patch-playwright.js` (idempotent + fail-closed) + standalone binary cross-path execution — PASS

# Changelog

All notable changes to **csctf** (Chat Shared Conversation to File) are documented here.

Versions follow [Semantic Versioning](https://semver.org/). Each tagged version has a corresponding
[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases)
unless noted otherwise.

Link format: commit links point to
`https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/<hash>`;
comparison links point to
`https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/<old>...<new>`.

---

## [Unreleased]

Changes on `main` after v0.4.5 that have not yet been tagged.

### CI / Infrastructure
- Add ACFS checksum update notification workflow ([`c515391`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c515391fd37f208712d5eca2305c802b44a0f317))
- Add ACFS checksum dispatch ([`92244ec`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/92244ec7cc208001bb285443e4d2792169a83d74))
- Skip ACFS dispatch when `ACFS_TOKEN` is not set ([`e451907`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e451907f70777ac9f90d1585804bf1308cbfc3fe))

### Dependencies
- Update Node.js dependencies to latest stable versions ([`0998dd6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0998dd642054abdb88c828d2fc43eacde4d0f41e))

### Documentation / Metadata
- Update AGENTS.md and documentation ([`8fd16ef`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/8fd16ef43dd866c3758a29180fd6816c342126c7), [`ff994cd`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ff994cda525c6cc3c6a6874120da379bccc782e1))
- Add MIT License file ([`b833b33`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b833b333651e635ad19bb56c41cf431331213792))
- Update license to MIT with OpenAI/Anthropic Rider ([`b628e4a`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b628e4ae5dff8ee8203b88d201b3856369c1a934), [`e9f7e03`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e9f7e03aaaad899ad868d28320b49c6a165ccf31))
- Add GitHub social preview image ([`1aa3b5c`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/1aa3b5c23ec3c6592d907b91f6e0fe3225aca608))

---

## [v0.4.5] -- 2026-01-03 -- GPT-5.2 Support & CLI Fixes

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.5) (latest)
| [Compare v0.4.4...v0.4.5](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.4...v0.4.5)

### Provider Compatibility
- **GPT-5.2 role detection**: OpenAI changed share-page DOM to use visible "You said:" / "ChatGPT said:" text headers instead of `data-message-author-role` attributes. Added text-based role detection fallback with anchored regex to prevent false positives; strip header artifacts from final markdown ([`c5a1819`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c5a1819dcc7740c6ba4d9de77cc7fdf2da65dae5))

### Bug Fixes
- **CLI argument validation**: `--outfile` and `--output-dir` now reject flag-shaped values (previously `csctf --outfile --quiet <url>` would create a file literally named `--quiet.md`); removed undocumented `--format` from usage text ([`3153181`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/31531813d32beae344625d6c2450d159afbd5073))
- **Quiet mode consistency**: Chrome tab-restoration messages now respect `--quiet` ([`fd50d85`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/fd50d856201f4d4ebc1aecc9c6faf68ebe4778c5))

---

## [v0.4.4] -- 2025-12-20 -- Complete Claude Support & Output Normalization

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.4)
| [Compare v0.4.3...v0.4.4](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.3...v0.4.4)

### Provider Support
- Complete Claude provider support: enhanced `stripProviderPrefix()` handles Claude's `"Title | Claude"` suffix pattern; heading prefix now correctly shows "Claude Conversation:" in both CDP and Playwright modes ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))
- Added `grok.x.ai` to share-URL validation pattern (was detected but then rejected) ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))

### Bug Fixes
- Pass `cdpEndpoint` and `quiet` through to `scrape()` -- both were parsed from CLI flags but silently dropped ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))

### Output Format Normalization
- CDP mode now produces identical markdown format to Playwright mode: removed blockquote markers from Source/Retrieved lines, switched to ISO date format, applied provider-prefixed headings, used `stripProviderPrefix()` consistently ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))

### Output Stream Compliance
- Route all progress/status messages to stderr so `csctf <url> > output.md` works correctly ([`811f250`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/811f250921f481ac5871fb83559016232462fbfd))

---

## [v0.4.3] -- 2025-12-20 -- CDP Extraction Ordering & Resource Cleanup

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.3)
| [Compare v0.4.2...v0.4.3](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.2...v0.4.3)

### Bug Fixes
- **Message ordering**: CDP extraction collected all user messages first then all assistant messages, producing wrong conversation order. Fixed by using combined CSS selectors and determining roles from element attributes, preserving DOM order ([`4693e9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4693e9be0b9a3942fb57558bf591ee73f858ded8))
- **Context variable scoping**: `BrowserContext` was inaccessible in catch block during CDP fallback ([`4693e9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4693e9be0b9a3942fb57558bf591ee73f858ded8))
- **Resource leak**: Playwright persistent context was never closed in finally block; added proper cleanup in both catch and finally paths ([`4693e9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4693e9be0b9a3942fb57558bf591ee73f858ded8))

---

## [v0.4.2] -- 2025-12-20 -- Provider-Aware CDP Extraction

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.2)
| [Compare v0.4.1...v0.4.2](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.1...v0.4.2)

### Bug Fixes
- Make CDP extraction provider-aware for all providers, not just Claude ([`121e487`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/121e487257b1f3e22446e93fd5282ee53f1d716d))

---

## [v0.4.1] -- 2025-12-20 -- Automatic CDP Fallback

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.1)
| [Compare v0.4.0...v0.4.1](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.0...v0.4.1)

### Features
- Automatic CDP fallback when Playwright is blocked by bot detection -- transparently retries via Chrome DevTools Protocol without user intervention ([`2991865`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/299186526393342761420cf71dedfca418091b30))

---

## [v0.4.0] -- 2025-12-19 -- Claude.ai Provider Support

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.0)
| [Compare v0.3.0...v0.4.0](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.3.0...v0.4.0)

This is the largest feature release since the initial version. Claude.ai uses Cloudflare
protection that blocks standard browser automation, so csctf adopts a fundamentally
different extraction strategy for this provider.

### Features
- **Claude.ai support via CDP mode**: copies Chrome session cookies to a temporary profile, launches Chrome with remote debugging, and connects via Chrome DevTools Protocol to extract conversations ([`0bc3661`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0bc3661a686b6175466b89da8edfcb6a643748e6))
- **Chrome session restoration**: if Chrome is already running, the tool saves open tabs, restarts Chrome with debugging enabled, and restores tabs afterward ([`0bc3661`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0bc3661a686b6175466b89da8edfcb6a643748e6))
- Provider count goes from 3 (ChatGPT, Gemini, Grok) to 4 (+ Claude)

### Documentation
- Add AGENTS.md with project context and agent coding guidelines ([`3063b74`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/3063b74f2033e07c830c6c9e81588fafca8865bb))

---

## [v0.3.0] -- 2025-12-07 -- Enhanced Anti-Bot Stealth Mode

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.3.0)
| [Compare v0.2.9...v0.3.0](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.9...v0.3.0)

Addresses ChatGPT's increased Cloudflare protection that began blocking headless scraping.

### Features
- **Browser fingerprint spoofing** (enabled by default): realistic navigator properties, plugins array, WebGL vendor/renderer, canvas fingerprint randomization ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- **Updated Chrome user agent**: mimics Chrome 131 with proper `sec-ch-ua` headers ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- **Chrome runtime shim**: provides realistic `window.chrome` object with `loadTimes()` and `csi()` ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- **Smarter challenge detection**: no longer false-positives on conversations that mention "cloudflare"; progressive wait times (3s/5s/8s/10s/12s) ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- **Automatic headful fallback**: retries with a visible browser window when headless is blocked ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- New CLI options: `--use-chrome-profile`, `--stealth`, `--headful` ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))

### Bug Fixes
- Fix eslint `Function` type error in WebGL proxy handler ([`55686ea`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/55686ea085f26cd087b3cf0d98417ebbc5660dec))
- Fix TypeScript errors in stealth script ([`fa0b069`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/fa0b0693068510e4db47d7cadc37b085659b2c10))

---

## [v0.2.9] -- 2025-12-06 -- Playwright Bundling Fix

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.9)
| [Compare v0.2.8...v0.2.9](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.8...v0.2.9)

### Bug Fixes
- **Standalone executable bundling**: fixed "Cannot find module playwright-core/package.json" error in pre-built binaries. `bun build --compile` baked absolute CI runner paths into the binary; added a postinstall patch that inlines Playwright's dynamic requires (`nodePlatform.js`, `userAgent.js`, `dependencies.js`, `program.js`) at install time ([`bd2e090`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bd2e090ee11030a6f73d238fdc1d5bc0d08a064a))

### CI
- Added verification step to ensure Playwright patch is applied before building; added test step to verify built binaries run without errors ([`bd2e090`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bd2e090ee11030a6f73d238fdc1d5bc0d08a064a))

---

## [v0.2.8] -- 2025-12-06 -- Compile Build Fixes

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.8)
| [Compare v0.2.7...v0.2.8](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.7...v0.2.8)

### Bug Fixes
- Ensure `bun build --compile` produces working binaries ([`5aeadc1`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/5aeadc1dec217d4f1b8906bfe4c2521a7198ef8a))

### Documentation
- Add cache-busting timestamp to install command in README ([`4a1f8d6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4a1f8d6429c4a11c3ecffbcef5ec1931a0efb902))

---

## [v0.2.7] -- 2025-12-06 -- Bun 1.3.3 Upgrade

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.7)
| [Compare v0.2.6...v0.2.7](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.6...v0.2.7)

### Build
- Update Bun to 1.3.3 for release bundling ([`93f599e`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/93f599ed7d1d8a745043b99abe1dd3e35aad5da0))

---

## [v0.2.6] -- 2025-12-06 -- Bundled Dependencies

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.6)
| [Compare v0.2.5...v0.2.6](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.5...v0.2.6)

### Build
- Bundle all dependencies into standalone binaries so users do not need `bun install` ([`0a95aeb`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0a95aeb80c94bfeb65fd1623829cb4ca5e8d7aa1))

---

## [v0.2.5] -- 2025-12-06 -- macOS ARM64 Install Fix

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.5)
| [Compare v0.2.4...v0.2.5](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.4...v0.2.5)

### Bug Fixes
- Fix macOS ARM64 (Apple Silicon) architecture mapping in install script ([`463a800`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/463a800288d16919c9ef9f74e02afebc51fc7f3e))

---

## [v0.2.4] -- 2025-12-06 -- Code Block Rendering & Simplified Publishing

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.4)
| [Compare v0.2.3...v0.2.4](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.3...v0.2.4)

### Features
- Add `--publish-to-gh-pages` one-flag shortcut for streamlined GitHub Pages publishing ([`3dee412`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/3dee41226455fb54d03ec169145b644174b3bb26))

### Bug Fixes
- Improve syntax highlighting and edge-case handling for `<pre>` / `<code>` elements; new TurndownService rules ensure proper conversion of inline and block code ([`03011ca`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/03011ca169cb232fd8e6b993898510b38794e661))

---

## [v0.2.3] -- 2025-12-06 -- HTML Security & Theming Overhaul

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.3)
| [Compare v0.2.2...v0.2.3](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.2...v0.2.3)

### Features
- Switch from GitHub token to `gh auth` for publishing; update installer hint ([`ea9c58b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ea9c58b0eafecbbabb6f67481ac9e8df434b6924))
- CSS variables for theming, improved code-block rendering with headers/dots, hero section and card layout for index pages ([`e717f80`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e717f80c5011e96243ad8656be5d29f562b141b1))
- Create `.nojekyll` files in publish directory to prevent Jekyll processing ([`27d79c6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/27d79c6a704c32be34df90c7983455d87d6171d4))

### Bug Fixes
- Escape `<script>` and `<style>` tags in HTML rendering so code examples display as text, not executable markup ([`ce28173`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ce281738c2f56247ec8856b3f97397445ae97dc3))

### Changes
- Remove Claude support (provider was unreliable at the time; re-added properly in v0.4.0) ([`8c394d1`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/8c394d1abde1c05e1a0ce128187ad25a618a4353))
- Replace Google Fonts (Inter, JetBrains Mono) with system font stack for faster loading ([`dda8603`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/dda8603dc8d5f82e8a42695bec510d12b49aa1d6))
- Remove scroll-to-top button and associated script from HTML output ([`029e91b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/029e91ba24da681a6503ff6a4de9b50f947a02c7))

---

## [v0.2.2] -- 2025-12-06 -- Release Asset Fix

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.2)
| [Compare v0.2.1...v0.2.2](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.1...v0.2.2)

### Bug Fixes
- Adjust release assets list to avoid duplicate uploads in CI ([`489f7c4`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/489f7c4ccac788525b3b0f7da7aa2bd41c62072c))

---

## [v0.2.1] -- 2025-12-06 -- Lint Fix

[GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.1)
| [Compare v0.2.0...v0.2.1](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.0...v0.2.1)

### Bug Fixes
- Fix lint issues that blocked CI ([`69353a5`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/69353a53c04412c07cce19b63a1f6184673705e5))

---

## [v0.2.0] -- 2025-12-06 -- First Tagged Release

Tag only (no GitHub Release page). This tag captures all initial development from
the repository's creation on 2025-12-06.

[Browse at v0.2.0](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/tree/v0.2.0)

### Core Capabilities (from inception)
- **ChatGPT scraping**: headless Playwright Chromium with stealth configuration, spoofed navigator properties, realistic headers ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- **Gemini support**: provider-specific selectors, Shadow DOM traversal for web components ([`f1185a7`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/f1185a763c4b3a1ec17700637ecb3f191bf99c70), [`4c8a0a2`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4c8a0a286a4322e55ffd02829333be7eff31435c))
- **Grok support**: flexible `data-testid` patterns with fallbacks ([`7b79207`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/7b7920793cbd98cfc8782726de606c662d95e639))
- **Claude support** (experimental, later removed in v0.2.3): initial multi-provider detection ([`9389865`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/938986563b8f9e2a061339c085fd6a5ee1b27917))

### Markdown Pipeline
- Turndown with fenced-code-block rule; language detected via `class="language-*"` ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- Citation-pill stripping, data-start/end attribute removal ([`c74c8c9`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c74c8c92450ff99e509d5c48ebe60c1f723e9a9e), [`3ae3864`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/3ae38646bb12f702d6ffd908bc81a75d11a34a37))
- Newline normalization (Unicode LS/PS, excessive blank lines) ([`c4e8acd`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c4e8acd10eec0bf282d343d344e6ad9bc137ec63))

### HTML Output
- Static HTML twin with Markdown-it + highlight.js, inline CSS for light/dark/print, zero JS ([`7f62819`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/7f6281988cacfa65942fe60df4c5b2ecd9a90881))
- Table of contents with slug de-duplication, metadata pills ([`1b04cec`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/1b04cecd46c51437dcac41d6b156f32179a5889c))

### Filename Handling
- Slugify: lowercase, non-alphanumerics to `_`, trimmed, max 120 chars, Windows reserved-name suffixing ([`b6a01c0`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b6a01c0dce85ec87dee21307045d1612b29ec871))
- Collision-proof unique-path resolution with `_2`, `_3`, ... suffixes ([`ae0c579`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ae0c5795d72f1cb5b51cbe144e39883ffdb5d273))

### GitHub Pages Publishing
- One-command `--publish-to-gh-pages` with `gh` auth, manifest.json and index.html regeneration, `--remember` / `--forget-gh-pages` for persistent settings ([`1b04cec`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/1b04cecd46c51437dcac41d6b156f32179a5889c))
- `--dry-run` mode for testing without network ([`96146e9`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/96146e9ab54f32fbfd633c1ccdc809dd9619bb95))
- `--yes` / `--no-confirm` to skip `PROCEED` prompt ([`bad1e05`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bad1e050462eed924afdb15beae518460a9cea5d))

### CLI
- Flags: `--timeout-ms`, `--outfile`, `--output-dir`, `--no-html` / `--html-only` / `--md-only`, `--quiet`, `--check-updates`, `--version`, `--debug`, `--wait-for-selector` ([`9d0930c`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/9d0930cfe37388e1582ac12f8f51db9dbe1f0a10), [`bad1e05`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bad1e050462eed924afdb15beae518460a9cea5d))
- Clipboard copy and file-open commands post-export ([`dff1fab`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/dff1fabf9b334335238808d62918a712b6d28489))
- Type-safe `MessageRole` enum, provider-prefix stripping utility ([`4ef9b7b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4ef9b7b7d7b1f8fd5bab3063c7b661b805b4c64b))
- Secure `readSecret` for GitHub token input with masking ([`f1ebba7`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/f1ebba76b583bd3e2f71336e73ec254223204081))
- Fast-fail on bot-blocking challenge pages ([`30ea5ca`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/30ea5caa851649944802a8431e6cb6ecc3e4df28))

### Naming
- Project renamed from `csctm` to `csctf`; all scripts, docs, config paths updated ([`66f71fc`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/66f71fc0d0d3fcc2ea123f121e8ce3148ca0a733))

### Installer
- `install.sh`: curl-based installer with platform detection, PATH update instructions, `VERSION` / `DEST` / `CHECKSUM_URL` env-var overrides ([`e057e41`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e057e4141e02165a6a9f7e5f37e1f848b75372a0), [`b6a01c0`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b6a01c0dce85ec87dee21307045d1612b29ec871))
- Checksum verification support ([`b6a01c0`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b6a01c0dce85ec87dee21307045d1612b29ec871))

### Build & CI
- ESLint + TypeScript configuration ([`65649c8`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/65649c89625809187c6dd58bcbbb4d740ee6e1b0))
- CI workflow: lint, typecheck, unit tests, matrix builds (macOS/Linux/Windows), Playwright browser caching ([`c4e8acd`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c4e8acd10eec0bf282d343d344e6ad9bc137ec63), [`8b7adf6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/8b7adf6ecf7f4d2ee0087de8e52f29a5ae8e8826))
- Cross-platform build scripts: `build:mac-arm64`, `build:mac-x64`, `build:linux-x64`, `build:linux-arm64`, `build:windows-x64` ([`65649c8`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/65649c89625809187c6dd58bcbbb4d740ee6e1b0))
- E2E tests with provider-specific default URLs and configurable timeout ([`e057e41`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e057e4141e02165a6a9f7e5f37e1f848b75372a0), [`332a858`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/332a858bd79bc3c42052abd0f07a1d34c8922ab8))
- Release workflow: tagged pushes (`v*`) create GitHub releases with binaries and `sha256.txt` ([`7f2a974`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/7f2a97426955370ac51ece11fae8aa3ff2388906))

---

## Version / Tag Summary

| Version | Date | GitHub Release | Type |
|---------|------|----------------|------|
| [v0.4.5] | 2026-01-03 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.5) | Bug fix (GPT-5.2 compat) |
| [v0.4.4] | 2025-12-20 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.4) | Feature (Claude completion) |
| [v0.4.3] | 2025-12-20 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.3) | Bug fix (CDP ordering) |
| [v0.4.2] | 2025-12-20 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.2) | Bug fix (CDP provider-aware) |
| [v0.4.1] | 2025-12-20 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.1) | Feature (CDP fallback) |
| [v0.4.0] | 2025-12-19 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.4.0) | Feature (Claude.ai support) |
| [v0.3.0] | 2025-12-07 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.3.0) | Feature (anti-bot stealth) |
| [v0.2.9] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.9) | Bug fix (Playwright bundling) |
| [v0.2.8] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.8) | Bug fix (compile builds) |
| [v0.2.7] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.7) | Build (Bun 1.3.3) |
| [v0.2.6] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.6) | Build (bundled deps) |
| [v0.2.5] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.5) | Bug fix (macOS ARM64) |
| [v0.2.4] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.4) | Feature (publish flag) |
| [v0.2.3] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.3) | Feature (theming, security) |
| [v0.2.2] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.2) | Bug fix (release assets) |
| [v0.2.1] | 2025-12-06 | [Yes](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases/tag/v0.2.1) | Bug fix (lint) |
| [v0.2.0] | 2025-12-06 | No | First tagged release |

[Unreleased]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.5...HEAD
[v0.4.5]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.4...v0.4.5
[v0.4.4]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.3...v0.4.4
[v0.4.3]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.2...v0.4.3
[v0.4.2]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.1...v0.4.2
[v0.4.1]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.4.0...v0.4.1
[v0.4.0]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.3.0...v0.4.0
[v0.3.0]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.9...v0.3.0
[v0.2.9]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.8...v0.2.9
[v0.2.8]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.7...v0.2.8
[v0.2.7]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.6...v0.2.7
[v0.2.6]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.5...v0.2.6
[v0.2.5]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.4...v0.2.5
[v0.2.4]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.3...v0.2.4
[v0.2.3]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.2...v0.2.3
[v0.2.2]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.1...v0.2.2
[v0.2.1]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/tree/v0.2.0

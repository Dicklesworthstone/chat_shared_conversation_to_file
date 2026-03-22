# Changelog

All notable changes to **csctf** (Chat Shared Conversation to File) are documented here.

Versions follow [Semantic Versioning](https://semver.org/). Each tagged version has a corresponding [GitHub Release](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/releases) unless noted otherwise. Commit links point to the canonical repository at `Dicklesworthstone/chat_shared_conversation_to_file`.

---

## [Unreleased] (after v0.4.5)

Changes on `main` since the v0.4.5 tag, not yet part of any release.

### CI / Infrastructure

- Add ACFS checksum dispatch and notification workflow ([`92244ec`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/92244ec7cc208001bb285443e4d2792169a83d74), [`c515391`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c515391fd37f208712d5eca2305c802b44a0f317))
- Skip ACFS dispatch when `ACFS_TOKEN` is missing ([`e451907`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e451907f70777ac9f90d1585804bf1308cbfc3fe))

### Licensing

- Add MIT License with OpenAI/Anthropic Rider ([`b833b33`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b833b333651e635ad19bb56c41cf431331213792), [`b628e4a`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b628e4ae5dff8ee8203b88d201b3856369c1a934), [`e9f7e03`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e9f7e03aaaad899ad868d28320b49c6a165ccf31))

### Maintenance

- Update Node.js dependencies to latest stable versions ([`0998dd6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0998dd642054abdb88c828d2fc43eacde4d0f41e))
- Add GitHub social preview image ([`1aa3b5c`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/1aa3b5c23ec3c6592d907b91f6e0fe3225aca608))
- Update AGENTS.md with project context ([`ff994cd`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ff994cda525c6cc3c6a6874120da379bccc782e1), [`8fd16ef`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/8fd16ef43dd866c3758a29180fd6816c342126c7))

---

## [v0.4.5] -- 2026-01-03 (Release)

GPT-5.2 compatibility and CLI hardening.

### Provider Compatibility

- **GPT-5.2 role detection**: OpenAI changed the share page DOM to use visible "You said:" / "ChatGPT said:" text headers instead of `data-message-author-role` attributes. Added text-based role detection with anchored regex patterns, alternating-role fallback, and header artifact stripping so conversations render correctly again ([`c5a1819`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c5a1819dcc7740c6ba4d9de77cc7fdf2da65dae5))

### CLI Robustness

- **Argument validation for `--outfile` / `--output-dir`**: previously `csctf --outfile --quiet <url>` would silently create a file named `--quiet.md`; now throws a clear error when the required path is missing or looks like a flag. Also removed undocumented `--format` from usage text ([`3153181`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/31531813d32beae344625d6c2450d159afbd5073))
- **Quiet-mode consistency**: Chrome tab restoration messages now respect `--quiet` ([`fd50d85`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/fd50d856201f4d4ebc1aecc9c6faf68ebe4778c5))

---

## [v0.4.4] -- 2025-12-19 (Release)

Complete Claude provider support and output normalization across extraction modes.

### Claude Provider

- Handle Claude's unique `"Title | Claude"` suffix in `stripProviderPrefix()`, and add Claude to `headingPrefix` so both CDP and Playwright modes show "Claude Conversation:" instead of defaulting to "ChatGPT" ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))

### Output Normalization

- CDP mode now produces the same Markdown format as Playwright mode: proper heading, blockquote metadata with ISO date, and consistent whitespace. Previously CDP output had raw page titles and locale-formatted dates ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))

### Bug Fixes

- Pass `cdpEndpoint` and `quiet` arguments through to `scrape()` -- they were parsed from CLI flags but silently dropped ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))
- Add `grok.x.ai` to `sharePattern` so Grok's alternate domain passes URL validation ([`6d6fe57`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/6d6fe577f153fa35124751e33efb91ce74b67ea1))
- Route all progress output to stderr so only file paths reach stdout, per AGENTS.md specification ([`811f250`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/811f250921f481ac5871fb83559016232462fbfd))

---

## [v0.4.3] -- 2025-12-19 (Release)

Fixes for CDP extraction fidelity and resource management.

### Extraction Quality

- **Message ordering**: CDP extraction previously collected all user messages first, then all assistant messages, producing garbled conversation order. Now uses combined CSS selectors and determines roles from element attributes, preserving DOM order ([`4693e9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4693e9be0b9a3942fb57558bf591ee73f858ded8))

### Resource Cleanup

- Fix `BrowserContext` variable scoping so it is accessible in the catch block during CDP fallback ([`4693e9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4693e9be0b9a3942fb57558bf591ee73f858ded8))
- Close `BrowserContext` in the finally block when using Playwright persistent-context mode; previously leaked ([`4693e9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4693e9be0b9a3942fb57558bf591ee73f858ded8))

---

## [v0.4.2] -- 2025-12-19 (Release)

### CDP Generalization

- Make CDP extraction provider-aware for all providers, not just Claude. Selectors and role-detection logic now adapt to the detected provider when using the CDP path ([`121e487`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/121e487257b1f3e22446e93fd5282ee53f1d716d))

---

## [v0.4.1] -- 2025-12-19 (Release)

### Resilience

- **Automatic CDP fallback**: when Playwright is blocked (Cloudflare challenge, bot detection), the tool now automatically retries via Chrome DevTools Protocol instead of failing outright ([`2991865`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/299186526393342761420cf71dedfca418091b30))

---

## [v0.4.0] -- 2025-12-19 (Release)

Major feature release: Claude.ai support.

### Claude.ai Provider

- **Full Claude.ai share-link support** via Chrome DevTools Protocol (CDP). Claude.ai uses Cloudflare protection that blocks standard headless automation; csctf now copies your Chrome session cookies to a temporary profile, launches Chrome with remote debugging, and connects via CDP to extract the conversation ([`0bc3661`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0bc3661a686b6175466b89da8edfcb6a643748e6))
- **Chrome session restoration**: if Chrome is already running, offers to save open tabs, restart Chrome with debugging, and restore tabs afterward ([`0bc3661`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0bc3661a686b6175466b89da8edfcb6a643748e6))

### Documentation

- Add AGENTS.md and update README for Claude.ai support ([`3063b74`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/3063b74f2033e07c830c6c9e81588fafca8865bb))

---

## [v0.3.0] -- 2025-12-07 (Release)

Anti-bot stealth overhaul for ChatGPT scraping.

### Stealth Engine (enabled by default)

- Browser fingerprint spoofing: realistic `navigator` properties, `plugins` array, WebGL vendor/renderer strings ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- Canvas fingerprint randomization to defeat tracking ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- Chrome 131 user-agent with proper `sec-ch-ua` headers ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- `window.chrome` runtime shim with `loadTimes()` and `csi()` ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))

### Challenge Detection

- Smarter Cloudflare challenge detection: no longer false-positives on conversations that merely mention "cloudflare"; only triggers on actual challenge pages (short body text, specific titles) ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- Progressive wait times (3 s, 5 s, 8 s, 10 s, 12 s) instead of fixed timeouts ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))

### New CLI Flags

- `--use-chrome-profile` -- leverage real Chrome session cookies to bypass authentication challenges ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- `--stealth` -- explicitly enable enhanced stealth (now on by default) ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))
- `--headful` -- run with a visible browser window ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))

### Automatic Headful Fallback

- When headless mode is blocked, the tool automatically retries with a visible browser window ([`da0f824`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/da0f824515ed2ff86b867595fde61322b2ef5a9f))

### Code Quality

- Fix ESLint `Function` type error in WebGL proxy handler ([`55686ea`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/55686ea085f26cd087b3cf0d98417ebbc5660dec))
- Fix TypeScript errors in stealth script ([`fa0b069`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/fa0b0693068510e4db47d7cadc37b085659b2c10))

---

## [v0.2.9] -- 2025-12-06 (Release)

### Standalone Binary Fix

- **Playwright bundling for `bun build --compile`**: fixed "Cannot find module playwright-core/package.json" error in pre-built binaries. Playwright's `require.resolve()` bakes absolute paths from the build machine; a postinstall patch now inlines the required values (`coreDir`, Playwright version, language binding version, `packageJSON`) so binaries are self-contained ([`bd2e090`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bd2e090ee11030a6f73d238fdc1d5bc0d08a064a))

### CI

- Add verification step to ensure Playwright patch is applied before building; add test step to verify built binaries run without errors ([`bd2e090`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bd2e090ee11030a6f73d238fdc1d5bc0d08a064a))

---

## [v0.2.8] -- 2025-12-06 (Release)

### Build

- Ensure `bun compile` builds succeed; bump version ([`5aeadc1`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/5aeadc1dec217d4f1b8906bfe4c2521a7198ef8a))

### Documentation

- Add cache-busting timestamp to install command in README ([`4a1f8d6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4a1f8d6429c4a11c3ecffbcef5ec1931a0efb902))

---

## [v0.2.7] -- 2025-12-06 (Release)

### Build

- Update Bun to 1.3.3 for release bundling ([`93f599e`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/93f599ed7d1d8a745043b99abe1dd3e35aad5da0))

---

## [v0.2.6] -- 2025-12-06 (Release)

### Build / Distribution

- Bundle all dependencies into compiled binaries so they are fully self-contained ([`0a95aeb`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/0a95aeb80c94bfeb65fd1623829cb4ca5e8d7aa1))

---

## [v0.2.5] -- 2025-12-06 (Release)

### Installer

- Fix macOS ARM64 (`aarch64` / `arm64`) install mapping -- the installer was downloading the wrong binary for Apple Silicon ([`463a800`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/463a800288d16919c9ef9f74e02afebc51fc7f3e))

---

## [v0.2.4] -- 2025-12-06 (Release)

### Code-Block Rendering

- Refactor TurndownService rules for `<pre>` and `<code>` elements to properly distinguish inline code from fenced code blocks, fixing syntax highlighting edge cases in HTML output ([`03011ca`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/03011ca169cb232fd8e6b993898510b38794e661))

### GitHub Pages Publishing

- Add simplified `--publish-to-gh-pages` flag for one-command publishing; update argument parsing and usage text ([`3dee412`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/3dee41226455fb54d03ec169145b644174b3bb26))

---

## [v0.2.3] -- 2025-12-06 (Release)

### HTML Output Quality

- Escape `<script>` and `<style>` tags in rendered HTML so code examples display correctly instead of executing ([`ce28173`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ce281738c2f56247ec8856b3f97397445ae97dc3))
- Create `.nojekyll` files in the publish directory to prevent GitHub Pages Jekyll processing ([`27d79c6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/27d79c6a704c32be34df90c7983455d87d6171d4))
- Replace Google Fonts (`Inter`, `JetBrains Mono`) with system font stacks to eliminate external requests and improve load performance ([`dda8603`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/dda8603dc8d5f82e8a42695bec510d12b49aa1d6))
- Remove scroll-to-top button and its inline JavaScript to keep HTML output strictly zero-JS ([`029e91b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/029e91ba24da681a6503ff6a4de9b50f947a02c7))

### Styling

- Introduce CSS variables for theming; add code-block headers with colored dots; improve card layout and hero section in the index renderer ([`e717f80`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e717f80c5011e96243ad8656be5d29f562b141b1))

### Auth / Publishing

- Switch GitHub Pages publishing from token-based auth to `gh auth`, and update the installer hint accordingly ([`ea9c58b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ea9c58b0eafecbbabb6f67481ac9e8df434b6924))

### Provider Scope

- Temporarily remove Claude support (re-added in v0.4.0); restrict providers to ChatGPT, Gemini, and Grok ([`8c394d1`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/8c394d1abde1c05e1a0ce128187ad25a618a4353))

---

## [v0.2.2] -- 2025-12-06 (Release)

### CI / Release Packaging

- Fix duplicate-upload issue in release asset list ([`489f7c4`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/489f7c4ccac788525b3b0f7da7aa2bd41c62072c))

---

## [v0.2.1] -- 2025-12-06 (Release)

### Code Quality

- Fix ESLint issues introduced during rapid v0.2.0 development ([`69353a5`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/69353a53c04412c07cce19b63a1f6184673705e5))

---

## [v0.2.0] -- 2025-12-06 (Tag only -- no GitHub Release)

First tagged version. This tag captures the full initial development sprint (30 commits in a single day) that took the project from zero to a feature-complete multi-provider CLI.

### Core Scraping Engine

- Headless Playwright Chromium with stealth configuration (spoofed navigator properties, realistic headers) ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- Double-navigate strategy (`domcontentloaded` then `networkidle`) to tame late-loading assets ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- Provider auto-detection from URL hostname; provider-specific CSS selector chains with fallback ([`9389865`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/938986563b8f9e2a061339c085fd6a5ee1b27917))
- Shadow DOM traversal for Gemini web components ([`dba0ecb`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/dba0ecb2785d4415bcb1dcf1c2e7dc27521acaf6))
- Bot-blocking fast-fail detection and retry with backoff ([`30ea5ca`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/30ea5caa851649944802a8431e6cb6ecc3e4df28), [`f1ebba7`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/f1ebba76b583bd3e2f71336e73ec254223204081))
- OS-aware Chromium executable resolution ([`5a52794`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/5a527948563f52eb1ccae1a1a305caf6d9822ca6))

### Multi-Provider Support

- ChatGPT (`chatgpt.com/share`) -- initial and primary target ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- Claude (`claude.ai/share`) -- initial support (later removed in v0.2.3, re-added properly in v0.4.0) ([`9389865`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/938986563b8f9e2a061339c085fd6a5ee1b27917))
- Gemini (`gemini.google.com/share`) ([`f1185a7`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/f1185a763c4b3a1ec17700637ecb3f191bf99c70), [`4c8a0a2`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4c8a0a286a4322e55ffd02829333be7eff31435c))
- Grok (`grok.com/share`) ([`7b79207`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/7b7920793cbd98cfc8782726de606c662d95e639))

### Markdown Generation

- Turndown with custom fenced-code rule; language detected from `class="language-*"` ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- Citation pill and `data-start`/`data-end` attribute stripping ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- Newline normalization (Unicode LS/PS removal, excessive blank-line collapse) ([`c4e8acd`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c4e8acd10eec0bf282d343d344e6ad9bc137ec63))
- Artifact and badge-like token filtering for cleaner output ([`c74c8c9`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c74c8c92450ff99e509d5c48ebe60c1f723e9a9e), [`3ae3864`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/3ae38646bb12f702d6ffd908bc81a75d11a34a37))

### Deterministic Filenames

- Slugify function: lowercase, non-alphanumerics to `_`, trim, max 120 chars, Windows reserved-name suffixing ([`b6a01c0`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b6a01c0dce85ec87dee21307045d1612b29ec871))
- Collision-proof unique paths with `_2`, `_3`, ... suffixes ([`b6a01c0`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b6a01c0dce85ec87dee21307045d1612b29ec871))
- Provider-prefix stripping from titles ([`4ef9b7b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4ef9b7b7d7b1f8fd5bab3063c7b661b805b4c64b))

### HTML Output

- Static HTML twin with Markdown-it + highlight.js rendering, inline CSS for light/dark/print, zero JavaScript ([`7f62819`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/7f6281988cacfa65942fe60df4c5b2ecd9a90881))
- Table of contents with de-duplicated heading slugs; metadata pills ([`1b04cec`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/1b04cecd46c51437dcac41d6b156f32179a5889c))
- Language badges on code blocks ([`7f62819`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/7f6281988cacfa65942fe60df4c5b2ecd9a90881))

### GitHub Pages Publishing

- One-command publish: clone (or create via `gh`), copy files, regenerate `manifest.json` and `index.html`, commit + push ([`1b04cec`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/1b04cecd46c51437dcac41d6b156f32179a5889c))
- `--remember` / `--forget-gh-pages` for persistent repo/branch/dir config under `~/.config/csctf/config.json` ([`1b04cec`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/1b04cecd46c51437dcac41d6b156f32179a5889c))
- `--dry-run` to build index without pushing ([`96146e9`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/96146e9ab54f32fbfd633c1ccdc809dd9619bb95))
- `--yes` / `--no-confirm` to skip the `PROCEED` confirmation gate ([`bad1e05`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bad1e050462eed924afdb15beae518460a9cea5d))
- Auto-install `gh` via `--gh-install` (brew/apt/dnf/yum/winget/choco) ([`21f87f9`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/21f87f90ad3670523436d62081787d59cdd6d2d2))

### CLI

- `--timeout-ms`, `--outfile`, `--output-dir`, `--quiet`, `--check-updates`, `--version` ([`bad1e05`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bad1e050462eed924afdb15beae518460a9cea5d), [`9d0930c`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/9d0930cfe37388e1582ac12f8f51db9dbe1f0a10))
- `--no-html` / `--md-only` / `--html-only` output format switches ([`bad1e05`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/bad1e050462eed924afdb15beae518460a9cea5d))
- `--debug`, `--wait-for-selector` ([`9d0930c`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/9d0930cfe37388e1582ac12f8f51db9dbe1f0a10))
- Clipboard copy and file-open after export ([`dff1fab`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/dff1fabf9b334335238808d62918a712b6d28489))
- Colorized, step-based console output via `chalk` ([`2818a9b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/2818a9b64d6d045f5e0932999b77c141e94c2ec4))
- Secure `readSecret` function for GitHub token input with masking ([`f1ebba7`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/f1ebba76b583bd3e2f71336e73ec254223204081))

### Safety

- Atomic writes via temp + rename pattern ([`ae0c579`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/ae0c5795d72f1cb5b51cbe144e39883ffdb5d273))
- `MessageRole` type for type-safe role handling ([`4ef9b7b`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/4ef9b7b7d7b1f8fd5bab3063c7b661b805b4c64b))

### Installer

- `curl | bash` installer with OS/arch detection, optional `--verify` checksum, `DEST` / `VERSION` overrides ([`e057e41`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e057e4141e02165a6a9f7e5f37e1f848b75372a0), [`b6a01c0`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/b6a01c0dce85ec87dee21307045d1612b29ec871))
- Detailed PATH update instructions per platform ([`9389865`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/938986563b8f9e2a061339c085fd6a5ee1b27917))

### Build / CI

- Cross-platform binary targets: macOS ARM64/x64, Linux x64/ARM64, Windows x64 ([`65649c8`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/65649c89625809187c6dd58bcbbb4d740ee6e1b0))
- ESLint + TypeScript (`tsc --noEmit`) linting ([`65649c8`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/65649c89625809187c6dd58bcbbb4d740ee6e1b0))
- CI: lint, typecheck, unit tests, matrix builds, binary verification, artifact upload ([`c4e8acd`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/c4e8acd10eec0bf282d343d344e6ad9bc137ec63))
- E2E tests with per-provider default URLs and configurable timeout ([`e057e41`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/e057e4141e02165a6a9f7e5f37e1f848b75372a0), [`332a858`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/332a858bd79bc3c42052abd0f07a1d34c8922ab8))
- Playwright browser caching in CI ([`8b7adf6`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/8b7adf6ecf7f4d2ee0087de8e52f29a5ae8e8826))
- Tagged pushes (`v*`) create GitHub Release with binaries and `sha256.txt` ([`7f2a974`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/7f2a97426955370ac51ece11fae8aa3ff2388906))

### Project Rename

- Renamed CLI binary from `csctm` to `csctf`; updated all scripts, docs, and config paths ([`66f71fc`](https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commit/66f71fc0d0d3fcc2ea123f121e8ce3148ca0a733))

---

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
[v0.2.0]: https://github.com/Dicklesworthstone/chat_shared_conversation_to_file/commits/v0.2.0

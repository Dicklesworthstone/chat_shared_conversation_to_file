# csctf — Chat Shared Conversation → File

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)
![Runtime](https://img.shields.io/badge/runtime-Bun%201.3+-purple)
![Status](https://img.shields.io/badge/status-alpha-orange)
![License](https://img.shields.io/badge/License-MIT%2BOpenAI%2FAnthropic%20Rider-blue)

Single-file Bun-native CLI that turns public ChatGPT, Gemini, Grok, and Claude share links into clean Markdown + HTML transcripts with preserved code fences, stable filenames, and rich terminal output.

<div align="center">

```bash
curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/chat_shared_conversation_to_file/main/install.sh?$(date +%s)" \
  | bash
```

</div>

---

## ✨ Highlights
- **Zero-setup binaries**: Installer prefers published release binaries per-OS; falls back to Bun source build automatically.
- **Accurate Markdown + HTML**: Preserves fenced code blocks with detected language, strips citation pills, normalizes whitespace and line terminators, and renders a styled HTML twin.
- **Deterministic filenames**: Slugifies the conversation title and auto-increments to avoid clobbering existing files.
- **Readable progress**: Colorized, step-based console output powered by `chalk`.
- **Multi-provider**: Works with public shares from ChatGPT (`chatgpt.com/share`), Gemini (`gemini.google.com/share`), Grok (`grok.com/share`), and Claude (`claude.ai/share`).

## 💡 Why csctf exists
- Copy/pasting AI share links often breaks fenced code blocks, loses language hints, and produces messy filenames. csctf fixes that with stable slugs, language-preserving fences, and collision-proof outputs.
- Exports both Markdown and a static HTML twin (no JS) for easy hosting/archiving, with normalized whitespace and cleaned citations.
- Optional GitHub Pages publishing turns a single command into a shareable, indexed microsite.

## 🧭 Design principles
- Determinism: slugging and collision handling are explicit; writes are temp+rename to avoid partial files.
- Minimal network surface: only the share URL is fetched unless you opt into update checks or publishing.
- Safety: static HTML (inline CSS/HLJS), no scripts emitted.
- Clarity: colorized, step-based logging; confirmation gate for publishing (`PROCEED` unless `--yes`).

## 🧠 Processing details (algorithms)
- Selector strategy: provider-specific selectors with fallback chains—ChatGPT uses `article [data-message-author-role]`, Gemini uses custom web components (`share-turn-viewer`, `response-container`), Grok uses flexible `data-testid` patterns, Claude uses `[data-testid="user-message"]` and streaming indicators. Each has multiple fallbacks tried with short timeouts.
- Turndown customization: injects fenced code blocks; detects language via `class="language-*"`, strips citation pills and data-start/end attributes.
- Normalization: converts newlines to `\n`, removes Unicode LS/PS, collapses excessive blank lines.
- Slugging: lowercase, non-alphanumerics → `_`, trimmed, max 120 chars, Windows reserved-name suffixing, collision suffix `_2`, `_3`, ….
- Unique-path resolution: if `<name>.md` exists, auto-bump suffixes; HTML shares the base name.
- HTML rendering: Markdown-it + highlight.js, heading slug de-dupe to build a TOC, inline CSS tuned for light/dark/print, zero JS.

## 🔍 How it works (end-to-end)

**For ChatGPT, Gemini, and Grok:**
1) Launch headless Playwright Chromium with stealth configuration (spoofed navigator properties, realistic headers).
2) Navigate twice (`domcontentloaded` then `networkidle`) to tame late-loading assets.
3) Detect provider from URL hostname; wait for provider-specific selectors with retry/fallback.
4) Extract each role's inner HTML (assistant/user), traversing Shadow DOM for web components.
5) Clean pills/metadata, run Turndown with fenced-code rule, normalize whitespace and newlines.
6) Emit Markdown to a temp file, rename atomically; render HTML twin with inline CSS/TOC/HLJS.

**For Claude.ai:**
Claude.ai uses Cloudflare protection that blocks standard browser automation. csctf handles this automatically:
1) Copies your Chrome session cookies to a temporary profile (preserving your logged-in state).
2) Launches Chrome with remote debugging enabled using the temporary profile.
3) Connects via Chrome DevTools Protocol to extract the conversation.
4) If Chrome is already running, offers to save your open tabs, restart Chrome with debugging, and restore tabs afterward.

This approach requires Chrome to be installed and you to be logged into claude.ai in your regular Chrome session.

**Publishing (optional, all providers):**
- If requested, publish: resolve repo/branch/dir, clone (or create via gh), copy files, regenerate `manifest.json` and `index.html`, commit+push.
- Log steps with timing, print saved paths and optional viewer hint.

## 🛡️ Security & privacy (deep dive)
- Network: only the share URL plus optional update check; publish uses git/gh over HTTPS. No other calls.
- Auth: GitHub CLI (`gh`) for publishing; no tokens are stored; confirmation gate unless `--yes`.
- HTML output: no JS, inline styles only; removes citation pills and data-start/end attributes; highlight.js used in a static way.
- Filesystem: temp+rename write pattern; collision-proof naming; config stored under `~/.config/csctf/config.json` (GH settings/history).
- Claude.ai: session cookies are copied to a temporary directory and used only for that scraping session; original Chrome profile is never modified.

## 🏎️ Performance profile
- First run: pays Playwright Chromium download; cached thereafter.
- Navigation: 60s default timeout, 3-attempt backoff for load and selector waits.
- Rendering: single page/context, linear Turndown + Markdown-it pass; suitable for long chats.
- I/O: atomic writes; HTML and MD generated in-memory once.

## 🧭 Failure modes & remedies
- "No messages were found": link is private or provider layout changed; ensure it's a public share, retry with `--timeout-ms 90000`.
- Bot detection / challenge page: the tool uses stealth techniques but extreme bot-blocks may still occur; retry or verify link is accessible in a regular browser.
- Timeout or blank page: slow network/CDN; raise `--timeout-ms`, verify connectivity, ensure provider is reachable.
- Publish fails (auth): ensure `gh auth status` passes; verify `--gh-pages-repo owner/name`.
- Publish fails (branch/dir): pass `--gh-pages-branch` / `--gh-pages-dir`; use `--remember` to persist.
- Filename collisions: expected; tool appends `_2`, `_3`, … instead of clobbering.
- Claude.ai Cloudflare challenge: if prompted, complete the verification in the Chrome window that opens, then press Enter.

## 📚 Recipes (more examples)
- Quiet CI scrape (MD only):
  `csctf <url> --md-only --quiet --outfile /tmp/chat.md`
- HTML-only for embedding:
  `csctf <url> --html-only --outfile site/chat.html`
- Publish with remembered settings:
  `csctf <url> --publish-to-gh-pages --remember --yes`
- Custom browser cache:
  `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright csctf <url>`
- Longer/slower shares:
  `csctf <url> --timeout-ms 90000`

## ⚡ Quickstart
- macOS/Linux:
  ```bash
  curl -fsSL "https://raw.githubusercontent.com/Dicklesworthstone/chat_shared_conversation_to_file/main/install.sh?ts=$(date +%s)" | bash
  csctf https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70
  ```
- Windows: run the installer via Git Bash or WSL (native Windows binary also produced in `dist/`).
- First run downloads Playwright Chromium; cache is typically `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows).

## 🚀 Using it (one-liners)
After install, just pass a share URL:

```bash
csctf https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70
csctf https://grok.com/share/bGVnYWN5_d5329c61-f497-40b7-9472-c555fa71af9c
csctf https://gemini.google.com/share/66d944b0e6b9
csctf https://claude.ai/share/549c846d-f6c8-411c-9039-a9a14db376cf
```

You'll get two files in your current directory with a clean, collision-proof name:
- `<name>.md` (Markdown)
- `<name>.html` (static HTML, zero JS)

## 🧭 Usage
```bash
csctf <share-url> \
  [--timeout-ms 60000] [--outfile path] [--quiet] [--check-updates] [--version] \
  [--no-html] [--html-only] [--md-only] \
  [--publish-to-gh-pages] [--gh-pages-repo owner/name] [--gh-pages-branch gh-pages] [--gh-pages-dir csctf] \
  [--remember] [--forget-gh-pages] [--dry-run] [--yes] [--gh-install]

csctf https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70 --timeout-ms 90000
```
Swap in Gemini, Grok, or Claude share URLs—flow is identical.

What you'll see:
- Chromium launch (first run downloads the Playwright bundle; Claude.ai uses your installed Chrome instead).
- Provider auto-detection from URL hostname; provider-specific selectors applied automatically.
- `✔ Saved <file>.md` plus the absolute path; an HTML twin (`.html`) is also written by default. Use `--no-html` to skip.
- One-flag publish: `--publish-to-gh-pages` uses your logged-in `gh` user and the default repo name `my_shared_conversations` (or remembered settings). Confirm by typing `PROCEED` unless you pass `--yes`. Use `--remember` to persist repo/branch/dir; `--forget-gh-pages` to clear; `--dry-run` to simulate.

## 📋 Flags at a glance
| Flag | Default | Purpose | Notes |
| --- | --- | --- | --- |
| `--timeout-ms` | `60000` | Navigation + selector waits | Raise to handle slow shares (e.g., `90000`). |
| `--outfile` | auto slug | Override output path | Base name used for both `.md` and `.html`. |
| `--no-html` / `--md-only` | html on | Skip HTML twin | `--html-only` writes only HTML. |
| `--quiet` | verbose | Minimal logging | Errors still print. |
| `--check-updates` | off | Print latest release tag | No network otherwise. |
| `--version` | off | Print version and exit | |
| `--publish-to-gh-pages` | off | Publish with defaults | Uses `gh` login + `my_shared_conversations` (or remembered). |
| `--gh-pages-repo` | remembered / `my_shared_conversations` | Target repo for publish | Requires `gh` authenticated. |
| `--gh-pages-branch` | `gh-pages` | Publish branch | Created if missing. |
| `--gh-pages-dir` | `csctf` | Subdirectory in repo | Keeps exports isolated. |
| `--remember` / `--forget-gh-pages` | off | Persist/clear GH config | Stored under `~/.config/csctf/config.json`. |
| `--dry-run` | off | Build index without push | Skips commit/push. |
| `--yes` / `--no-confirm` | off | Skip `PROCEED` prompt | Use in CI or scripted runs. |
| `--gh-install` | off | Auto-install `gh` | Tries brew/apt/dnf/yum/winget/choco. |

## 🗂️ Outputs
- Markdown header: `# Conversation: <title>`, plus `Source` and `Retrieved` lines.
- Per message: `## User` / `## Assistant`, fenced code with language preserved when present.
- Filenames: titles are slugified (non-alphanumerics → `_`, trimmed, max 120 chars, Windows reserved names suffixed), collisions auto-suffix `_2`, `_3`, etc.
- HTML twin: standalone, zero-JS, inline CSS + highlight.js theme, light/dark (prefers-color-scheme), language badges on code blocks, TOC, metadata pills, print-friendly tweaks. Shares the base name with `.md`.

## 🔒 Security & network behavior
- Network calls: only the share URL, plus optional `--check-updates` and GitHub publish flows.
- Uses the GitHub CLI (`gh`) for publish auth; no tokens are stored.
- Chromium downloaded once and cached for ChatGPT/Gemini/Grok; Claude.ai uses your installed Chrome with copied session cookies.

## 📈 Performance notes
- Playwright browsers are cached; first run pays the download, later runs reuse the bundle.
- Limited retries with small backoff for navigation and selector waits to ride over transient flakiness.
- Linear processing of the harvested HTML keeps memory modest; no extra browser contexts are opened.
- Atomic writes prevent partial outputs on interruption.

## 🌐 GitHub Pages quick recipe
```bash
csctf <share-url> --publish-to-gh-pages --yes
```
- Requirements: `gh` installed and authenticated (`gh auth status`).
- Defaults: repo `<your-gh-username>/my_shared_conversations`, branch `gh-pages`, dir `csctf`.
- One-time remember for even shorter runs:
  - First: `csctf <share-url> --publish-to-gh-pages --remember --yes`
  - Then: `csctf <share-url> --yes` (reuses remembered repo/branch/dir)
- Customize anytime: `--gh-pages-repo owner/name`, `--gh-pages-branch`, `--gh-pages-dir`.
- Preview without pushing: `--dry-run`.
- Without `--yes`, you must type `PROCEED`. Use `--forget-gh-pages` to clear remembered settings.

## 🌱 Environment variables
- CLI:
  - `PLAYWRIGHT_BROWSERS_PATH`: reuse a cached Chromium bundle.
- Installer:
  - `VERSION=vX.Y.Z`: pin release tag (otherwise `latest`).
  - `DEST=/path`: install dir (default `~/.local/bin`; `--system` → `/usr/local/bin`).
  - `OWNER` / `REPO` / `BINARY`: override download target/name.
  - `CHECKSUM_URL`: override checksum location; `--verify` requires it.

## 🛠️ Local build & dev
```bash
bun install                   # also runs postinstall to patch Playwright
bun run build                 # dist/csctf for current platform

# Dev helpers
bun run lint                  # eslint
bun run typecheck             # tsc --noEmit
bun run check                 # lint + typecheck

# Cross-platform binaries (emit into dist/)
bun run build:mac-arm64
bun run build:mac-x64
bun run build:linux-x64
bun run build:linux-arm64
bun run build:windows-x64     # dist/csctf-windows-x64.exe
bun run build:all
```

The `postinstall` script patches Playwright's dynamic path resolution for compatibility with Bun's standalone executable compilation.

## 🧪 Testing
- Unit: `bun test` (includes slugify/html render/unique-path checks).
- E2E (networked, builds binary, hits the shared URL):
  ```bash
  CSCTF_E2E=1 bun run test:e2e
  ```
- What E2E checks: exit code 0, `.md` + `.html` exist, minimum length/lines, correct headers/source URL, balanced fences, sanitized HTML (no `<script>`), normalized newlines.
- Additional defaults are baked in for provider E2Es:
  - Gemini: `https://gemini.google.com/share/66d944b0e6b9`
  - Grok: `https://grok.com/share/bGVnYWN5_d5329c61-f497-40b7-9472-c555fa71af9c`
  Set `CSCTF_E2E_GEMINI_URL` or `CSCTF_E2E_GROK_URL` to override.

## 🧭 Examples (outputs)
- Example input: `https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70`
- Outputs:
  - `phage_explorer_design_plan.md` (or `_2`, `_3`, … if collisions)
  - `phage_explorer_design_plan.html`
- Properties: fenced code with languages preserved, TOC present, inline CSS for light/dark/print, no scripts, normalized newlines.

## ⚙️ CI & releases
- Workflow: lint → typecheck → unit tests → matrix builds (macOS/Linux/Windows) → verify binaries → upload artifacts.
- Tagged pushes (`v*`) create a GitHub release with binaries and `sha256.txt` (installer can `--verify`).
- Build process includes automatic patching of Playwright for standalone executable compatibility.
- Playwright browsers are cached between runs.

## 🔁 Operational notes
- Playwright cache: `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows).
- Typical runtime: seconds for small/medium conversations after the first download; first run pays Chromium fetch.
- Idempotent on repeat: slug collisions are handled via suffixes; reruns won't clobber existing exports.

## 🔍 Comparison
- Compared to copy/paste or generic webpage → Markdown:
  - Preserves fenced code blocks with language detection.
  - Emits deterministic filenames with collision handling.
  - Ships a static, styled HTML twin (no JS) ready for hosting.
  - One-command GitHub Pages publishing with manifest/index regeneration.

## 🧰 Troubleshooting
| Symptom | Fix |
| --- | --- |
| Playwright download slow | Set `PLAYWRIGHT_BROWSERS_PATH` to a pre-cached bundle; rerun after first download. |
| 403/redirect/login page | Ensure the link is a public share (ChatGPT, Gemini, Grok, or Claude); retry with `--timeout-ms 90000`. |
| "No messages found" | Share layout may have changed or link is private; provider-specific selectors are tried with fallbacks. |
| Binary not on PATH | Add `~/.local/bin` (or `DEST`) to PATH; re-open shell. |
| Download stalls | Retry with cache; verify network; increase `--timeout-ms`. |
| Filename conflicts/invalid names | Filenames are slugified/truncated; auto-suffix `_2`, `_3`, … to avoid clobbering. |
| Partial writes | Files are written temp+rename; re-run if interrupted. |
| GitHub Pages publish fails | Ensure `gh auth status` passes; ensure branch exists or pass `--gh-pages-branch`; use `--gh-pages-dir` to isolate exports. |
| Repo not found (publish) | Provide `--gh-pages-repo owner/name`; ensure `gh` is logged in if relying on defaults. |
| Claude.ai won't load | Ensure you're logged into claude.ai in Chrome; close Chrome if prompted and let the tool restart it. |
| Cloudflare challenge loop | Complete the challenge manually in the Chrome window, then press Enter when prompted. |

## ⚠️ Limitations & known behaviors
- ChatGPT, Gemini, and Grok use headless Chromium; Claude.ai requires your installed Chrome with an active login session.
- Requires public share links; private/authenticated shares are not supported (except Claude.ai which uses your session).
- Provider layouts may change; selectors are maintained for ChatGPT, Gemini, Grok, and Claude with fallback chains.
- Markdown/HTML exports require the share to remain available at scrape time.
- Update checks and GH publishing are opt-in; otherwise no outbound calls beyond fetching the share page.
- Claude.ai on macOS: if Chrome is running, the tool will offer to save your tabs, restart Chrome with debugging, and restore your tabs afterward.

## ❓ FAQ
- **Where do the binaries come from?** CI builds macOS/Linux/Windows artifacts on tagged releases; the installer fetches from the latest tag unless you pin `VERSION=vX.Y.Z`.
- **How are filenames generated?** Conversation titles are lowercased, non-alphanumerics → `_`, trimmed of leading/trailing `_`; collisions append `_2`, `_3`, ….
- **Where does Playwright cache browsers?** Default: `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows). CI caches this directory between runs.
- **Why does first run take longer?** Playwright downloads Chromium once. Subsequent runs reuse the cached bundle.
- **Can I control timeouts?** Yes: `--timeout-ms` sets both navigation and selector waits (default 60000ms).
- **Can I override the output path?** Yes: `--outfile /path/to/output.md` bypasses slug-based naming.
- **Can I reduce console output?** `--quiet` minimizes progress logs; errors still print.
- **Can I verify downloads?** The installer fetches adjacent `.sha256` files when present; use `--verify` to require a checksum.
- **Can I add support for a new provider?** Add hostname patterns to `PROVIDER_PATTERNS`, selector candidates to `PROVIDER_SELECTOR_CANDIDATES`, and rebuild.
- **How do I verify installs?** Run `csctf --help` and invoke the bundled E2E: `CSCTF_E2E=1 bun run test:e2e` (network + browser download required).
- **Which Markdown rules are customized?** A turndown rule injects fenced code blocks with detected language from `class="language-..."`; citation pills and data-start/end attributes are stripped.
- **Why does Claude.ai need my Chrome?** Claude.ai uses Cloudflare protection that blocks headless browsers. By using your real Chrome with your existing login cookies, the tool can bypass this protection.
- **Are my Chrome cookies safe?** Yes. Cookies are copied to a temporary directory for the scraping session only; your original Chrome profile is never modified.

## 📝 About Contributions

> *About Contributions:* Please don't take this the wrong way, but I do not accept outside contributions for any of my projects. I simply don't have the mental bandwidth to review anything, and it's my name on the thing, so I'm responsible for any problems it causes; thus, the risk-reward is highly asymmetric from my perspective. I'd also have to worry about other "stakeholders," which seems unwise for tools I mostly make for myself for free. Feel free to submit issues, and even PRs if you want to illustrate a proposed fix, but know I won't merge them directly. Instead, I'll have Claude or Codex review submissions via `gh` and independently decide whether and how to address them. Bug reports in particular are welcome. Sorry if this offends, but I want to avoid wasted time and hurt feelings. I understand this isn't in sync with the prevailing open-source ethos that seeks community contributions, but it's the only way I can move at this velocity and keep my sanity.

## 📜 License
MIT License (with OpenAI/Anthropic Rider). See [LICENSE](LICENSE).

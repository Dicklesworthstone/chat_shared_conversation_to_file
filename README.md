# csctm — ChatGPT Shared Conversation → Markdown

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)
![Runtime](https://img.shields.io/badge/runtime-Bun%201.3+-purple)
![Status](https://img.shields.io/badge/status-alpha-orange)
![License](https://img.shields.io/badge/license-MIT-green)

Single-file Bun-native CLI that downloads a ChatGPT share link (or share links from Claude, Gemini, and Grok) and saves a clean Markdown transcript with fenced code blocks, stable filenames, and rich terminal output.

<div align="center">

```bash
curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/chatgpt_shared_conversation_to_markdown_file/main/install.sh \
  | bash
```

</div>

---

## ✨ Highlights
- **Zero-setup binaries**: Installer prefers published release binaries per-OS; falls back to Bun source build automatically.
- **Accurate Markdown**: Preserves fenced code blocks with detected language, strips citation pills, normalizes whitespace and line terminators.
- **Deterministic filenames**: Slugifies the conversation title and auto-increments to avoid clobbering existing files.
- **Readable progress**: Colorized, step-based console output powered by `chalk`.
- **Multi-provider**: Works with public shares from ChatGPT (`chatgpt.com/share`), Claude (`claude.ai/share`), Gemini (`gemini.google.com/share`), and Grok (`grok.com/share`).

## 💡 Why csctm exists
- Copy/pasting ChatGPT shares often breaks fenced code blocks, loses language hints, and produces messy filenames. csctm fixes that with stable slugs, language-preserving fences, and collision-proof outputs.
- Exports a static HTML twin (no JS) for easy hosting/archiving, alongside Markdown with normalized whitespace and cleaned citations.
- Optional GitHub Pages publishing turns a single command into a shareable, indexed microsite.

## 🧭 Design principles
- Determinism: slugging and collision handling are explicit; writes are temp+rename to avoid partial files.
- Minimal network surface: only the share URL is fetched unless you opt into update checks or publishing.
- Safety: headless-only, static HTML (inline CSS/HLJS), no scripts emitted.
- Clarity: colorized, step-based logging; confirmation gate for publishing (`PROCEED` unless `--yes`).

## 🧠 Processing details (algorithms)
- Selector strategy: waits for `article [data-message-author-role]` to ensure conversation content is present.
- Turndown customization: injects fenced code blocks; detects language via `class="language-*"`, strips citation pills and data-start/end attributes.
- Normalization: converts newlines to `\n`, removes Unicode LS/PS, collapses excessive blank lines.
- Slugging: lowercase, non-alphanumerics → `_`, trimmed, max 120 chars, Windows reserved-name suffixing, collision suffix `_2`, `_3`, ….
- Unique-path resolution: if `<name>.md` exists, auto-bump suffixes; HTML shares the base name.
- HTML rendering: Markdown-it + highlight.js, heading slug de-dupe to build a TOC, inline CSS tuned for light/dark/print, zero JS.

## 🔍 How it works (end-to-end)
1) Launch headless Playwright Chromium with a stable UA.  
2) Navigate twice (`domcontentloaded` then `networkidle`) to tame late-loading assets.  
3) Wait for `article [data-message-author-role]`; fail fast if absent.  
4) Extract each role’s inner HTML (assistant/user) as-is.  
5) Clean pills/metadata, run Turndown with fenced-code rule, normalize whitespace and newlines.  
6) Emit Markdown to a temp file, rename atomically; render HTML twin with inline CSS/TOC/HLJS.  
7) If requested, publish: resolve repo/branch/dir, clone (or create via gh), copy files, regenerate `manifest.json` and `index.html`, commit+push.  
8) Log steps with timing, print saved paths and optional viewer hint.

## 🛡️ Security & privacy (deep dive)
- Network: only the share URL plus optional update check; publish uses git/gh over HTTPS. No other calls.  
- Tokens: only `GITHUB_TOKEN`; never stored; confirmation gate unless `--yes`.  
- HTML output: no JS, inline styles only; removes citation pills and data-start/end attributes; highlight.js used in a static way.  
- Filesystem: temp+rename write pattern; collision-proof naming; config stored under `~/.config/csctm/config.json` (GH settings/history).

## 🏎️ Performance profile
- First run: pays Playwright Chromium download; cached thereafter.  
- Navigation: 60s default timeout, 3-attempt backoff for load and selector waits.  
- Rendering: single page/context, linear Turndown + Markdown-it pass; suitable for long chats.  
- I/O: atomic writes; HTML and MD generated in-memory once.

## 🧭 Failure modes & remedies
- “No messages were found”: link is private or layout changed; ensure it’s a public share, retry with `--timeout-ms 90000`, report the URL.  
- Timeout or blank page: slow network/CDN; raise `--timeout-ms`, verify connectivity, ensure provider is reachable.  
- Publish fails (auth): set `GITHUB_TOKEN` with repo write access; verify `--gh-pages-repo owner/name`; run `gh auth status`.  
- Publish fails (branch/dir): pass `--gh-pages-branch` / `--gh-pages-dir`; use `--remember` to persist.  
- Filename collisions: expected; tool appends `_2`, `_3`, … instead of clobbering.

## 📚 Recipes (more examples)
- Quiet CI scrape (MD only):  
  `csctm <url> --md-only --quiet --outfile /tmp/chat.md`
- HTML-only for embedding:  
  `csctm <url> --html-only --outfile site/chat.html`
- Publish with remembered settings:  
  `csctm <url> --gh-pages-repo you/repo --remember --yes`
- Custom browser cache:  
  `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright csctm <url>`
- Longer/slower shares:  
  `csctm <url> --timeout-ms 90000`

## 🛠️ Internals for contributors
- CLI entry + flow: `src/index.ts` (arg parsing, scrape, render, publish).  
- Tests: `bun test` (unit), `CSCTM_E2E=1 bun run test:e2e` (full scrape/build/publish assertions).  
- Build: `bun run build[:target]` emits single-file binaries in `dist/`.  
- Lint/typecheck: `bun run lint`, `bun run typecheck`.  
- Installer: `install.sh` prefers release binaries; falls back to Bun build with git+bun.

## ⚡ Quickstart
- macOS/Linux:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/chatgpt_shared_conversation_to_markdown_file/main/install.sh | bash
  csctm https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70
  ```
- Windows: run the installer via Git Bash or WSL (native Windows binary also produced in `dist/`).
- First run downloads Playwright Chromium; cache is typically `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows).

## 🧭 Usage
```bash
csctm <chatgpt-share-url> \
  [--timeout-ms 60000] [--outfile path] [--quiet] [--check-updates] [--version] \
  [--no-html] [--html-only] [--md-only] \
  [--gh-pages-repo owner/name] [--gh-pages-branch gh-pages] [--gh-pages-dir csctm] \
  [--remember] [--forget-gh-pages] [--dry-run] [--yes] [--gh-install]

csctm https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70 --timeout-ms 90000
```

What you’ll see:
- Headless Chromium launch (first run downloads the Playwright bundle).
- `✔ Saved <file>.md` plus the absolute path; an HTML twin (`.html`) is also written by default. Use `--no-html` to skip.
- (Optional) Publish to GitHub Pages with `--gh-pages-repo <owner/name>` (defaults to remembered repo or `my_shared_chatgpt_conversations`). Confirm by typing `PROCEED` unless you pass `--yes`. Use `--remember` to persist repo/branch/dir; `--forget-gh-pages` to clear; `--dry-run` to simulate.
- (Optional) Publish HTML/MD to GitHub Pages via `--gh-pages-repo <repo> [--gh-pages-branch gh-pages] [--gh-pages-dir csctm]` with `GITHUB_TOKEN` set.
- Also works with Claude, Gemini, and Grok share links (public).

## 📋 Flags at a glance
| Flag | Default | Purpose | Notes |
| --- | --- | --- | --- |
| `--timeout-ms` | `60000` | Navigation + selector waits | Raise to handle slow shares (e.g., `90000`). |
| `--outfile` | auto slug | Override output path | Base name used for both `.md` and `.html`. |
| `--no-html` / `--md-only` | html on | Skip HTML twin | `--html-only` writes only HTML. |
| `--quiet` | verbose | Minimal logging | Errors still print. |
| `--check-updates` | off | Print latest release tag | No network otherwise. |
| `--version` | off | Print version and exit | |
| `--gh-pages-repo` | remembered / `my_shared_chatgpt_conversations` | Target repo for publish | Requires `GITHUB_TOKEN`. |
| `--gh-pages-branch` | `gh-pages` | Publish branch | Created if missing. |
| `--gh-pages-dir` | `csctm` | Subdirectory in repo | Keeps exports isolated. |
| `--remember` / `--forget-gh-pages` | off | Persist/clear GH config | Stored under `~/.config/csctm/config.json`. |
| `--dry-run` | off | Build index without push | Skips commit/push. |
| `--yes` / `--no-confirm` | off | Skip `PROCEED` prompt | Use in CI or scripted runs. |
| `--gh-install` | off | Auto-install `gh` | Tries brew/apt/dnf/yum/winget/choco. |

## 🗂️ Outputs
- Markdown header: `# ChatGPT Conversation: <title>`, plus `Source` and `Retrieved` lines.
- Per message: `## User` / `## Assistant`, fenced code with language preserved when present.
- Filenames: titles are slugified (non-alphanumerics → `_`, trimmed, max 120 chars, Windows reserved names suffixed), collisions auto-suffix `_2`, `_3`, etc.
- HTML twin: standalone, zero-JS, inline CSS + highlight.js theme, light/dark (prefers-color-scheme), language badges on code blocks, TOC, metadata pills, print-friendly tweaks. Shares the base name with `.md`.

## 🔒 Security & network behavior
- Network calls: only the ChatGPT share URL, plus optional `--check-updates` and GitHub publish flows.
- Tokens: only `GITHUB_TOKEN` is read (for publishing). No tokens are stored.
- Headless-only for speed/determinism; Chromium downloaded once and cached.

## 📈 Performance notes
- Playwright browsers are cached; first run pays the download, later runs reuse the bundle.
- Limited retries with small backoff for navigation and selector waits to ride over transient flakiness.
- Linear processing of the harvested HTML keeps memory modest; no extra browser contexts are opened.
- Atomic writes prevent partial outputs on interruption.

## 🌐 GitHub Pages quick recipe
```bash
GITHUB_TOKEN=... csctm <share-url> \
  --gh-pages-repo youruser/my_shared_chatgpt_conversations \
  --gh-pages-branch gh-pages \
  --gh-pages-dir csctm \
  --yes
```
- Without `--yes`, you must type `PROCEED`. Use `--remember` to persist repo/branch/dir; `--forget-gh-pages` to clear. `--dry-run` clones/builds the index but skips commit/push.

## 🌱 Environment variables
- CLI:
  - `PLAYWRIGHT_BROWSERS_PATH`: reuse a cached Chromium bundle.
  - `GITHUB_TOKEN`: required for publishing.
- Installer:
  - `VERSION=vX.Y.Z`: pin release tag (otherwise `latest`).
  - `DEST=/path`: install dir (default `~/.local/bin`; `--system` → `/usr/local/bin`).
  - `OWNER` / `REPO` / `BINARY`: override download target/name.
  - `CHECKSUM_URL`: override checksum location; `--verify` requires it.

## 🛠️ Local build & dev
```bash
bun install
bun run build                 # dist/csctm for current platform

# Dev helpers
bun run lint                  # eslint
bun run typecheck             # tsc --noEmit
bun run check                 # lint + typecheck

# Cross-platform binaries (emit into dist/)
bun run build:mac-arm64
bun run build:mac-x64
bun run build:linux-x64
bun run build:linux-arm64
bun run build:windows-x64     # dist/csctm-windows-x64.exe
bun run build:all
```

## 🔧 Contributing details
- Stack: Bun + TypeScript (strict), eslint via `bun run lint`.
- Adding a flag: wire it in `parseArgs`, thread through main, document in the flags table.
- Tests: prefer unit coverage for helpers (`slugify`, `uniquePath`, HTML render); use `e2e/e2e.test.ts` for scrape-sensitive behavior.
- Releases: tag `v*` → CI builds artifacts + `sha256.txt`; installer fetches latest unless pinned via `VERSION`.

## 🧪 Testing
- Unit: `bun test` (includes slugify/html render/unique-path checks).
- E2E (networked, builds binary, hits the shared URL):
  ```bash
  CSCTM_E2E=1 bun run test:e2e
  ```
- What E2E checks: exit code 0, `.md` + `.html` exist, minimum length/lines, correct headers/source URL, balanced fences, sanitized HTML (no `<script>`), normalized newlines.
- Additional defaults are baked in for provider E2Es:
  - Claude: `https://claude.ai/share/a957d022-c2f1-4efb-ac58-81395f4331fe`
  - Gemini: `https://gemini.google.com/share/66d944b0e6b9`
  - Grok: `https://grok.com/share/bGVnYWN5_d5329c61-f497-40b7-9472-c555fa71af9c`
  Set `CSCTM_E2E_CLAUDE_URL`, `CSCTM_E2E_GEMINI_URL`, or `CSCTM_E2E_GROK_URL` to override.

## 🧭 Examples (outputs)
- Example input: `https://chatgpt.com/share/69343092-91ac-800b-996c-7552461b9b70`
- Outputs:
  - `phage_explorer_design_plan.md` (or `_2`, `_3`, … if collisions)
  - `phage_explorer_design_plan.html`
- Properties: fenced code with languages preserved, TOC present, inline CSS for light/dark/print, no scripts, normalized newlines.

## ⚙️ CI & releases
- Workflow: lint → typecheck → unit tests → e2e scrape (Ubuntu) → matrix builds (macOS/Linux/Windows) → upload artifacts.
- Tagged pushes (`v*`) create a GitHub release with binaries and `sha256.txt` (installer can `--verify`).
- Playwright browsers are cached between e2e runs; README links are checked (chatgpt share link excluded).

## 🔁 Operational notes
- Playwright cache: `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows).
- Typical runtime: seconds for small/medium conversations after the first download; first run pays Chromium fetch.
- Idempotent on repeat: slug collisions are handled via suffixes; reruns won’t clobber existing exports.

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
| 403/redirect/login page | Ensure the link is a public ChatGPT share; retry with `--timeout-ms 90000`. |
| “No messages found” | Share layout may have changed; selectors target `article [data-message-author-role]`. Please report the URL. |
| Binary not on PATH | Add `~/.local/bin` (or `DEST`) to PATH; re-open shell. |
| Download stalls | Retry with cache; verify network; increase `--timeout-ms`. |
| Filename conflicts/invalid names | Filenames are slugified/truncated; auto-suffix `_2`, `_3`, … to avoid clobbering. |
| Partial writes | Files are written temp+rename; re-run if interrupted. |
| GitHub Pages publish fails | Set `GITHUB_TOKEN` with repo write access; ensure branch exists or pass `--gh-pages-branch`; use `--gh-pages-dir` to isolate exports. |
| Repo not found (publish) | Provide `--gh-pages-repo owner/name`; ensure `gh` is logged in if relying on defaults. |

## ⚠️ Limitations & known behaviors
- Headless-only; no headful mode today.
- Assumes public ChatGPT share layout; selectors are `article [data-message-author-role]`.
- Markdown/HTML exports require the share to remain available at scrape time.
- Update checks and GH publishing are opt-in; otherwise no outbound calls beyond fetching the share page.

## ❓ FAQ
- **Where do the binaries come from?** CI builds macOS/Linux/Windows artifacts on tagged releases; the installer fetches from the latest tag unless you pin `VERSION=vX.Y.Z`.
- **How are filenames generated?** Conversation titles are lowercased, non-alphanumerics → `_`, trimmed of leading/trailing `_`; collisions append `_2`, `_3`, ….
- **Where does Playwright cache browsers?** Default: `~/.cache/ms-playwright` (Linux/macOS) or `%USERPROFILE%\AppData\Local\ms-playwright` (Windows). CI caches this directory between runs.
- **Why does first run take longer?** Playwright downloads Chromium once. Subsequent runs reuse the cached bundle.
- **Can I control timeouts?** Yes: `--timeout-ms` sets both navigation and selector waits (default 60000ms).
- **Can I override the output path?** Yes: `--outfile /path/to/output.md` bypasses slug-based naming.
- **Can I reduce console output?** `--quiet` minimizes progress logs; errors still print.
- **Can I verify downloads?** The installer fetches adjacent `.sha256` files when present; use `--verify` to require a checksum.
- **Can I change the user agent or selectors?** Edit `src/index.ts` (`chromium.launch` options and `page.waitForSelector` target) and rebuild.
- **How do I verify installs?** Run `csctm --help` and invoke the bundled E2E: `CSCTM_E2E=1 bun run test:e2e` (network + browser download required).
- **Which Markdown rules are customized?** A turndown rule injects fenced code blocks with detected language from `class="language-..."`; citation pills and data-start/end attributes are stripped.

## 📜 License
MIT


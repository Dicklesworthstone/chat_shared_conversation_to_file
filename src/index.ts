#!/usr/bin/env bun
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-chromium'
import puppeteer, { type Browser as PuppeteerBrowser, type Page as PuppeteerPage } from 'puppeteer-core'
import TurndownService, { type Rule } from 'turndown'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import MarkdownIt from 'markdown-it'
import type { Options as MdOptions } from 'markdown-it'
import hljs from 'highlight.js'
import { spawnSync, spawn } from 'child_process'
import os from 'os'
import readline from 'readline'
import pkg from '../package.json' assert { type: 'json' }

type Provider = 'chatgpt' | 'gemini' | 'grok' | 'claude'
const PROVIDER_PATTERNS: { id: Provider; patterns: RegExp[] }[] = [
  { id: 'gemini', patterns: [/gemini\.google\.com$/i] },
  { id: 'grok', patterns: [/grok\.com$/i, /grok\.x\.ai$/i] },
  { id: 'claude', patterns: [/claude\.ai$/i] },
  { id: 'chatgpt', patterns: [/chatgpt\.com$/i, /openai\.com$/i, /share\.chatgpt\.com$/i] }
]
const PROVIDER_SELECTOR_CANDIDATES: Record<Provider, string[][]> = {
  chatgpt: [['article [data-message-author-role]'], ['[data-message-author-role]'], ['main article'], ['article']],
  gemini: [
    ['share-turn-viewer user-query', 'share-turn-viewer response-container'],
    ['share-viewer user-query', 'share-viewer response-container'],
    ['.share-viewer_chat-container user-query', '.share-viewer_chat-container response-container'],
    ['[data-test-id="chat-app"] user-query', '[data-test-id="chat-app"] response-container'],
    ['main [data-message-author-role]', 'main [data-author-role]', 'main [data-utterance]'],
    ['main [data-testid*="message"]', '[data-testid*="message"]'],
    ['article [data-message-author-role]'],
    ['article', 'section', '[role="article"]']
  ],
  grok: [
    ['main [data-testid*="message"]', '[data-testid*="message"]'],
    ['main [data-message-author-role]', 'main [data-author]'],
    ['article [data-message-author-role]'],
    ['article', 'section', '[role="article"]', 'main article'],
    ['.message-bubble', '.response-content-markdown', '.markdown'],
    ['div[class*="message"]', 'div[class*="chat"]']
  ],
  claude: [
    // Claude.ai share page selectors - confirmed from DOM inspection Dec 2025
    // User messages: [data-testid="user-message"], Assistant: [data-is-streaming]
    // Container: div.flex-1.flex.flex-col.px-4.max-w-3xl with gap-3
    ['[data-testid="user-message"]', '[data-is-streaming]'],
    ['[data-testid="user-message"]'],
    ['[data-is-streaming]'],
    // Fallback patterns
    ['.max-w-3xl.mx-auto [data-testid]', '.max-w-3xl.mx-auto [data-is-streaming]'],
    ['div.gap-3 > div > [data-testid="user-message"]', 'div.gap-3 > div [data-is-streaming]']
  ]
}
class AppError extends Error {
  hint?: string
  constructor(message: string, hint?: string) {
    super(message)
    this.hint = hint
  }
}

type MessageRole = 'assistant' | 'user' | 'system' | 'tool' | 'unknown'

type ScrapedMessage = {
  role: MessageRole
  html: string
}

type CliOptions = {
  timeoutMs: number
  outfile?: string
  outputDir?: string
  quiet: boolean
  verbose: boolean
  format: 'both' | 'md' | 'html'
  headless: boolean
  openAfter: boolean
  copy: boolean
  json: boolean
  titleOverride?: string
  debug: boolean
  waitForSelector?: string
  checkUpdates: boolean
  skipUpdates: boolean
  versionOnly: boolean
  generateHtml: boolean
  htmlOnly: boolean
  mdOnly: boolean
  rememberGh: boolean
  forgetGh: boolean
  dryRun: boolean
  yes: boolean
  publishGhPages: boolean
  ghPagesRepo?: string
  ghPagesBranch: string
  ghPagesDir: string
  autoInstallGh: boolean
  useChromeProfile: boolean
  stealthMode: boolean
  cdpEndpoint?: string
}

type ParsedArgs = CliOptions & { url: string }

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_SLUG_LEN = 120
const DEFAULT_GH_REPO = 'my_shared_conversations'
const CONFIG_DIR = path.join(os.homedir(), '.config', 'csctf')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
const UPDATE_CACHE_PATH = path.join(CONFIG_DIR, 'last-update.json')
const CLIP_HELP =
  'Clipboard copy not available (requires pbcopy | wl-copy | xclip | clip.exe). You can copy the saved file manually.'
const VIEWER_CMD = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'

type GhConfig = {
  repo: string
  branch: string
  dir: string
}

type PublishHistoryItem = {
  title: string
  md?: string
  html?: string
  addedAt: string
}

type AppConfig = {
  gh?: GhConfig
}

function ensureGhAvailable(autoInstall: boolean): void {
  const hasGh = isGhCliAvailable()
  if (hasGh) return
  if (!autoInstall) {
    throw new Error(
      'GitHub CLI (gh) is required for publishing. Install it (brew install gh / apt install gh / winget install GitHub.cli) or pass --gh-install to auto-attempt.'
    )
  }
  const platform = os.platform()
  const tryInstall = (cmd: string[], label: string) => {
    const res = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit' })
    if (res.status !== 0) {
      throw new Error(`Failed to install gh via ${label}. Install manually and retry.`)
    }
  }
  if (platform === 'darwin') {
    tryInstall(['brew', 'install', 'gh'], 'brew')
  } else if (platform === 'linux') {
    if (spawnSync('apt-get', ['--version']).status === 0) {
      tryInstall(['sudo', 'apt-get', 'update'], 'apt-get update')
      tryInstall(['sudo', 'apt-get', 'install', '-y', 'gh'], 'apt-get install gh')
    } else if (spawnSync('dnf', ['--version']).status === 0) {
      tryInstall(['sudo', 'dnf', 'install', '-y', 'gh'], 'dnf install gh')
    } else if (spawnSync('yum', ['--version']).status === 0) {
      tryInstall(['sudo', 'yum', 'install', '-y', 'gh'], 'yum install gh')
    } else {
      throw new Error('Unsupported Linux package manager for auto gh install. Please install GitHub CLI manually: https://cli.github.com')
    }
  } else if (platform === 'win32') {
    if (spawnSync('winget', ['--version']).status === 0) {
      tryInstall(['winget', 'install', '--id', 'GitHub.cli', '-e', '--silent'], 'winget')
    } else if (spawnSync('choco', ['--version']).status === 0) {
      tryInstall(['choco', 'install', '-y', 'gh'], 'choco')
    } else {
      throw new Error('Install gh manually on Windows (winget install GitHub.cli).')
    }
  } else {
    throw new Error('Unsupported platform for auto gh install. Install gh manually.')
  }
  if (!isGhCliAvailable()) {
    throw new Error('gh installation did not succeed. Install manually and retry.')
  }
}

function ensureGhAuth(): void {
  if (!isGhCliAvailable()) {
    throw new Error('GitHub CLI (gh) is required for publishing. Install via gh install / brew install gh / winget install GitHub.cli.')
  }
  const authStatus = spawnSync('gh', ['auth', 'status'], { stdio: 'ignore' })
  if (authStatus.status !== 0) {
    throw new Error('gh CLI is not authenticated. Run "gh auth login" first.')
  }
}

function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as AppConfig
    if (parsed.gh) {
      const { repo, branch, dir } = parsed.gh as any
      const validGh =
        (!repo || typeof repo === 'string') && (!branch || typeof branch === 'string') && (!dir || typeof dir === 'string')
      if (!validGh) return {}
    }
    return parsed
  } catch {
    console.error(chalk.gray('Ignoring malformed config; using defaults.'))
    return {}
  }
}

function saveConfig(cfg: AppConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8')
}

function forgetGhConfig(): void {
  const cfg = loadConfig()
  delete cfg.gh
  saveConfig(cfg)
}
const INLINE_STYLE = `
:root {
  --color-bg: #f8fafc;
  --color-bg-alt: #ffffff;
  --color-text: #0f172a;
  --color-text-muted: #64748b;
  --color-text-subtle: #94a3b8;
  --color-border: #e2e8f0;
  --color-border-hover: #cbd5e1;
  --color-accent: #6366f1;
  --color-accent-light: #818cf8;
  --color-accent-bg: rgba(99, 102, 241, 0.08);
  --color-success: #10b981;
  --color-code-bg: #1e293b;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.04);
  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
  --shadow-lg: 0 12px 40px rgba(15, 23, 42, 0.12);
  --shadow-xl: 0 24px 64px rgba(15, 23, 42, 0.16);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", Arial, sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, "Roboto Mono", "Ubuntu Monospace", "Lucida Console", monospace;
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-base: 200ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-slow: 300ms cubic-bezier(0.4, 0, 0.2, 1);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #0f172a;
    --color-bg-alt: #1e293b;
    --color-text: #f1f5f9;
    --color-text-muted: #94a3b8;
    --color-text-subtle: #64748b;
    --color-border: #334155;
    --color-border-hover: #475569;
    --color-accent: #818cf8;
    --color-accent-light: #a5b4fc;
    --color-accent-bg: rgba(129, 140, 248, 0.12);
    --color-code-bg: #0f172a;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.2);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.4);
    --shadow-xl: 0 24px 64px rgba(0, 0, 0, 0.5);
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.7;
  color: var(--color-text);
  background: var(--color-bg);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.page-wrapper {
  position: relative;
  min-height: 100vh;
  padding: clamp(24px, 5vw, 64px);
}
.page-wrapper::before {
  content: '';
  position: fixed;
  inset: 0;
  background:
    radial-gradient(ellipse 80% 60% at 10% 0%, var(--color-accent-bg), transparent 50%),
    radial-gradient(ellipse 60% 50% at 90% 10%, rgba(45, 212, 191, 0.06), transparent 40%),
    radial-gradient(ellipse 50% 80% at 50% 100%, rgba(251, 146, 60, 0.04), transparent 50%);
  pointer-events: none;
  z-index: -1;
}
.container {
  max-width: 860px;
  margin: 0 auto;
  position: relative;
}
h1, h2, h3, h4, h5, h6 {
  color: var(--color-text);
  line-height: 1.3;
  margin: 0 0 0.5em;
  font-weight: 600;
  letter-spacing: -0.02em;
}
h1 {
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin-bottom: 0.75em;
}
h2 {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 2.5em;
  margin-bottom: 1em;
  padding-bottom: 0.5em;
  border-bottom: 1px solid var(--color-border);
}
h2::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 1em;
  background: var(--color-accent);
  border-radius: 2px;
  margin-right: 0.75em;
  vertical-align: middle;
}
h3 { font-size: 1.25rem; margin-top: 1.75em; }
h4 { font-size: 1.125rem; margin-top: 1.5em; }
p {
  margin: 0 0 1.25em;
  color: var(--color-text);
}
a {
  color: var(--color-accent);
  text-decoration: none;
  font-weight: 500;
  transition: color var(--transition-fast);
}
a:hover {
  color: var(--color-accent-light);
  text-decoration: underline;
  text-underline-offset: 2px;
}
code, pre {
  font-family: var(--font-mono);
  font-feature-settings: "calt" 1, "liga" 1, "ss01" 1;
}
code {
  background: var(--color-accent-bg);
  color: var(--color-accent);
  padding: 0.2em 0.45em;
  border-radius: var(--radius-sm);
  font-size: 0.875em;
  font-weight: 500;
}
.code-block {
  position: relative;
  margin: 1.5em 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lg);
  background: var(--color-code-bg);
}
.code-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.code-dots {
  display: flex;
  gap: 6px;
}
.code-dots span {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
}
.code-dots span:nth-child(1) { background: #ff5f57; }
.code-dots span:nth-child(2) { background: #febc2e; }
.code-dots span:nth-child(3) { background: #28c840; }
.code-lang {
  font-size: 0.75rem;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
pre {
  background: transparent;
  color: #e2e8f0;
  padding: 56px 20px 20px;
  overflow: auto;
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.7;
}
pre code { background: none; padding: 0; color: inherit; }
blockquote {
  margin: 1.5em 0;
  padding: 1em 1.25em;
  border-left: 3px solid var(--color-accent);
  background: var(--color-accent-bg);
  color: var(--color-text);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  font-style: italic;
}
blockquote p:last-child { margin-bottom: 0; }
table {
  border-collapse: collapse;
  margin: 1.5em 0;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  background: var(--color-bg-alt);
}
th, td {
  padding: 12px 16px;
  border: 1px solid var(--color-border);
  text-align: left;
}
th {
  background: var(--color-accent-bg);
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--color-text-muted);
}
tr:hover { background: var(--color-accent-bg); }
ul, ol {
  padding-left: 1.5em;
  margin: 1em 0;
}
li { margin: 0.5em 0; }
li::marker { color: var(--color-accent); }
hr {
  border: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--color-border), transparent);
  margin: 3em 0;
}
.article {
  background: var(--color-bg-alt);
  padding: clamp(28px, 5vw, 48px);
  border-radius: var(--radius-xl);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-xl);
  position: relative;
  overflow: hidden;
}
.article::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--color-accent), #06b6d4, #10b981);
}
.header {
  margin-bottom: 2em;
  padding-bottom: 1.5em;
  border-bottom: 1px solid var(--color-border);
}
.meta-row {
  display: inline-flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 1em;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 9999px;
  background: var(--color-accent-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  font-size: 0.8125rem;
  font-weight: 500;
  transition: all var(--transition-fast);
}
.pill:hover {
  border-color: var(--color-accent);
  background: var(--color-accent-bg);
}
.pill a {
  color: inherit;
  font-weight: inherit;
}
.toc {
  margin: 0 0 2em;
  padding: 20px 24px;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}
.toc-title {
  margin: 0 0 0.75em;
  font-size: 0.875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}
.toc ul { margin: 0; padding-left: 0; list-style: none; }
.toc li { margin: 0.4em 0; }
.toc a {
  color: var(--color-text-muted);
  font-size: 0.9375rem;
  transition: color var(--transition-fast);
}
.toc a:hover { color: var(--color-accent); }
.message { margin-bottom: 2em; }
.message:last-child { margin-bottom: 0; }
.hljs { color: #e2e8f0; background: transparent; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-section, .hljs-link { color: #c4b5fd; }
.hljs-function .hljs-title, .hljs-title.class_, .hljs-title.function_ { color: #67e8f9; }
.hljs-attr, .hljs-name, .hljs-tag { color: #7dd3fc; }
.hljs-string, .hljs-meta .hljs-string { color: #a5f3c4; }
.hljs-number, .hljs-regexp, .hljs-variable { color: #fda4af; }
.hljs-built_in, .hljs-builtin-name { color: #fcd34d; }
.hljs-comment, .hljs-quote { color: #64748b; font-style: italic; }
.hljs-addition { color: #4ade80; background: rgba(74, 222, 128, 0.1); }
.hljs-deletion { color: #f87171; background: rgba(248, 113, 113, 0.1); }
.footer {
  margin-top: 3em;
  padding-top: 1.5em;
  border-top: 1px solid var(--color-border);
  text-align: center;
  color: var(--color-text-subtle);
  font-size: 0.875rem;
}
.scroll-top {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--color-accent);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  visibility: hidden;
  transition: all var(--transition-base);
  box-shadow: var(--shadow-lg);
}
.scroll-top.visible { opacity: 1; visibility: visible; }
.scroll-top:hover { transform: translateY(-2px); box-shadow: var(--shadow-xl); }
@media print {
  body { background: white !important; color: black !important; padding: 24px !important; }
  .page-wrapper::before { display: none; }
  .article { box-shadow: none !important; border: 1px solid #e5e7eb !important; }
  .article::before { display: none; }
  pre { page-break-inside: avoid; background: #f1f5f9 !important; color: #1e293b !important; }
  h2, h3 { page-break-after: avoid; color: black !important; }
  .scroll-top { display: none !important; }
  a { color: #2563eb !important; }
}
@media (max-width: 640px) {
  .article { padding: 20px; border-radius: var(--radius-lg); }
  .meta-row { flex-direction: column; align-items: flex-start; }
  .pill { font-size: 0.75rem; }
  pre { font-size: 0.8rem; padding: 48px 16px 16px; }
}
`.trim()

const headingSlug = (text: string, counts: Map<string, number>): string => {
  const base = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
  const finalBase = base || 'section'
  const existing = counts.get(finalBase) ?? 0
  counts.set(finalBase, existing + 1)
  return existing === 0 ? finalBase : `${finalBase}-${existing}`
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#47;')
    .replace(/\r?\n/g, '<br>')

const stripProviderPrefix = (title: string): string => title.replace(/^(ChatGPT|Gemini|Grok|Claude)\s*-?\s*/i, '').replace(/\s*\|\s*Claude$/i, '')

export function renderHtmlDocument(markdown: string, title: string, source: string, retrieved: string): string {
  const counts = new Map<string, number>()
  const headings: { level: number; text: string; id: string }[] = []

  const md = new MarkdownIt({ html: true, linkify: true, breaks: true, highlight: () => '' })

  md.renderer.rules.fence = (tokens: any[], idx: number) => {
    const token = tokens[idx]
    const code = token.content
    const lang = (token.info || '').trim()

    const render = (language: string | undefined, raw: string) => {
      const highlighted = language && hljs.getLanguage(language)
        ? hljs.highlight(raw, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(raw).value
      const label = language && hljs.getLanguage(language)
        ? language
        : hljs.highlightAuto(raw).language || 'text'
      return `<div class="code-block"><div class="code-header"><div class="code-dots"><span></span><span></span><span></span></div><span class="code-lang">${label}</span></div><pre><code class="hljs language-${label}">${highlighted}</code></pre></div>`
    }

    return render(lang || undefined, code)
  }

  md.renderer.rules.heading_open = (
    tokens: any[],
    idx: number,
    opts: MdOptions,
    _env: unknown,
    self: any
  ) => {
    const titleToken = tokens[idx + 1]
    const text = titleToken?.content ?? ''
    const id = headingSlug(text, counts)
    tokens[idx].attrSet('id', id)
    const level = Number.parseInt(tokens[idx].tag.replace('h', ''), 10)
    headings.push({ level, text, id })
    return self.renderToken(tokens, idx, opts)
  }

  // Escape script/style tags so code examples render visibly without executing or being stripped.
  const escapeExecutableTags = (html: string): string =>
    html
      .replace(/<script/gi, '&lt;script')
      .replace(/<\/script>/gi, '&lt;/script&gt;')
      .replace(/<style/gi, '&lt;style')
      .replace(/<\/style>/gi, '&lt;/style&gt;')

  const safeMarkdown = escapeExecutableTags(markdown)
  const rendered = md.render(safeMarkdown)
  const body = escapeExecutableTags(rendered)
  const safeTitle = escapeHtml(stripProviderPrefix(title))
  const safeSource = escapeHtml(source)
  const safeRetrieved = escapeHtml(retrieved)

  const tocHeadings = headings.filter(h => h.level >= 2 && h.level <= 4)
  const toc =
    tocHeadings.length > 0
      ? `<div class="toc">
    <div class="toc-title">Contents</div>
    <ul>
      ${tocHeadings
        .map(h => `<li style="margin-left:${(h.level - 2) * 16}px"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
        .join('\n')}
    </ul>
  </div>`
      : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>${safeTitle}</title>
  <style>${INLINE_STYLE}</style>
</head>
<body>
  <div class="page-wrapper">
    <div class="container">
      <article class="article">
        <header class="header">
          <div class="meta-row">
            <span class="pill">🔗 <a href="${safeSource}" target="_blank" rel="noreferrer noopener">Source</a></span>
            <span class="pill">📅 ${safeRetrieved.split('T')[0]}</span>
          </div>
          <h1>${safeTitle}</h1>
        </header>
        ${toc}
        <div class="content">
          ${body}
        </div>
        <footer class="footer">
          Exported with <a href="https://github.com/Dicklesworthstone/chat_shared_conversation_to_file" target="_blank">csctf</a>
        </footer>
      </article>
    </div>
  </div>
</body>
</html>`
}
const RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

function parseArgs(args: string[]): ParsedArgs {
  let url = ''
  let timeoutMs = DEFAULT_TIMEOUT_MS
  let outfile: string | undefined
  let outputDir: string | undefined
  let quiet = false
  let verbose = false
  const format: 'both' | 'md' | 'html' = 'both'
  let headless = true
  let openAfter = false
  let copy = false
  let json = false
  let titleOverride: string | undefined
  let debug = false
  let waitForSelector: string | undefined
  let checkUpdates = false
  let skipUpdates = false
  let versionOnly = false
  let generateHtml = true
  let htmlOnly = false
  let mdOnly = false
  let rememberGh = false
  let forgetGh = false
  let dryRun = false
  let yes = false
  let publishGhPages = false
  let ghPagesRepo: string | undefined
  let ghPagesBranch = 'gh-pages'
  let ghPagesDir = 'csctf'
  let autoInstallGh = false
  let useChromeProfile = false
  let stealthMode = false
  let cdpEndpoint: string | undefined

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg) continue
    switch (arg) {
      case '--timeout-ms':
        timeoutMs = Number.parseInt(args[i + 1] ?? '', 10)
        i += 1
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = DEFAULT_TIMEOUT_MS
        break
      case '--outfile':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          outfile = args[i + 1]
          i += 1
        } else {
          throw new AppError('--outfile requires a path')
        }
        break
      case '--output-dir':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          outputDir = args[i + 1]
          i += 1
        } else {
          throw new AppError('--output-dir requires a directory path')
        }
        break
      case '--headful':
        headless = false
        break
      case '--headless':
        headless = true
        break
      case '--use-chrome-profile':
        useChromeProfile = true
        break
      case '--stealth':
        stealthMode = true
        break
      case '--cdp': {
        const next = args[i + 1]
        // Only consume next arg if it looks like an endpoint (not a flag)
        if (next && !next.startsWith('-')) {
          cdpEndpoint = next
          i += 1
        } else {
          cdpEndpoint = 'http://localhost:9222'
        }
        break
      }
      case '--quiet':
        quiet = true
        break
      case '--verbose':
        verbose = true
        quiet = false
        break
      case '--help':
        url = '--help'
        break
      case '--open':
        openAfter = true
        break
      case '--copy':
        copy = true
        break
      case '--json':
        json = true
        break
      case '--title':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          titleOverride = args[i + 1]
          i += 1
        } else {
          throw new AppError('--title requires a value')
        }
        break
      case '--wait-for-selector':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          waitForSelector = args[i + 1]
          i += 1
        } else {
          throw new AppError('--wait-for-selector requires a CSS selector')
        }
        break
      case '--debug':
        debug = true
        break
      case '--check-updates':
        checkUpdates = true
        break
      case '--no-check-updates':
        skipUpdates = true
        checkUpdates = false
        break
      case '--version':
      case '-v':
        versionOnly = true
        break
      case '--no-html':
        generateHtml = false
        break
      case '--html-only':
        htmlOnly = true
        generateHtml = true
        mdOnly = false
        break
      case '--md-only':
        mdOnly = true
        generateHtml = false
        break
      case '--remember':
        rememberGh = true
        break
      case '--forget-gh-pages':
        forgetGh = true
        break
      case '--dry-run':
        dryRun = true
        break
      case '--yes':
      case '--no-confirm':
        yes = true
        break
      case '--publish-to-gh-pages':
        publishGhPages = true
        break
      case '--gh-pages-repo':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          ghPagesRepo = args[i + 1]
          i += 1
        } else {
          throw new Error('--gh-pages-repo requires a value like owner/name')
        }
        break
      case '--gh-pages-branch':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          ghPagesBranch = args[i + 1] ?? ghPagesBranch
          i += 1
        }
        break
      case '--gh-pages-dir':
        if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
          ghPagesDir = args[i + 1] ?? ghPagesDir
          i += 1
        }
        break
      case '--gh-install':
        autoInstallGh = true
        break
      default:
        if (!url && !arg.startsWith('-')) {
          url = arg
        }
        break
    }
  }

  if (htmlOnly && mdOnly) {
    throw new Error('Cannot combine --html-only and --md-only')
  }
  if (htmlOnly && !generateHtml) {
    throw new Error('Cannot combine --html-only and --no-html')
  }

  return {
    url,
    timeoutMs,
    outfile,
    outputDir,
    quiet,
    verbose,
    format,
    headless,
    openAfter,
    copy,
    json,
    titleOverride,
    debug,
    waitForSelector,
    checkUpdates,
    skipUpdates,
    versionOnly,
    generateHtml,
    htmlOnly,
    mdOnly,
    rememberGh,
    forgetGh,
    dryRun,
    yes,
    publishGhPages,
    ghPagesRepo,
    ghPagesBranch,
    ghPagesDir,
    autoInstallGh,
    useChromeProfile,
    stealthMode,
    cdpEndpoint
  }
}

const formatDuration = (ms: number): string => {
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  return `${minutes}m ${rem.toFixed(1)}s`
}

const STEP = (quiet: boolean, verbose: boolean) => (n: number, total: number, msg: string) => {
  if (quiet) return () => {}
  const start = Date.now()
  console.error(`${chalk.gray(`[${n}/${total}]`)} ${chalk.cyan(msg)}`)
  let spinner: ReturnType<typeof setInterval> | undefined
  if (verbose) {
    let dots = 0
    spinner = setInterval(() => {
      dots = (dots + 1) % 4
      const tail = '.'.repeat(dots)
      process.stderr.write(`\r${chalk.gray('   working' + tail.padEnd(3, ' '))}`)
    }, 400)
  }
  return () => {
    if (spinner) {
      clearInterval(spinner)
      process.stderr.write('\r')
    }
    const elapsed = Date.now() - start
    console.error(`   ${chalk.gray(`↳ ${formatDuration(elapsed)}`)}`)
  }
}

const FAIL = (quiet: boolean) => (msg: string) => {
  const hint = quiet ? ' (rerun without --quiet for more detail)' : ''
  const text = `${msg}${hint}`
  if (!quiet) console.error(chalk.red(`✖ ${text}`))
  else console.error(text)
}

const DONE = (quiet: boolean) => (msg: string, elapsedMs?: number) => {
  if (quiet) return
  const suffix = typeof elapsedMs === 'number' ? chalk.gray(` (${formatDuration(elapsedMs)})`) : ''
  console.error(`${chalk.green('✔')} ${msg}${suffix}`)
}

function usage(): void {
  console.log(
    [
      `Usage: csctf <chatgpt|gemini|grok|claude-share-url>`,
      `  [--timeout-ms 60000] [--outfile path|--output-dir dir] [--quiet] [--verbose]`,
      `  [--headful|--headless] [--stealth] [--use-chrome-profile] [--cdp <endpoint>]`,
      `  [--open] [--copy] [--json] [--title "Custom Title"] [--wait-for-selector "<css>"] [--debug]`,
      `  [--check-updates|--no-check-updates] [--version] [--no-html] [--html-only] [--md-only]`,
      `  [--publish-to-gh-pages] [--gh-pages-repo owner/name] [--gh-pages-branch gh-pages] [--gh-pages-dir dir]`,
      `  [--remember] [--forget-gh-pages] [--dry-run] [--yes] [--help] [--gh-install]`,
      '',
      'Common recipes:',
      `  Basic scrape (ChatGPT):   csctf https://chatgpt.com/share/<id>`,
      `  Basic scrape (Gemini):    csctf https://gemini.google.com/share/<id>`,
      `  Basic scrape (Grok):      csctf https://grok.com/share/<id>`,
      `  Basic scrape (Claude):    csctf https://claude.ai/share/<id> --cdp http://localhost:9222`,
      `  HTML only:                csctf <url> --html-only`,
      `  Markdown only:            csctf <url> --md-only`,
      `  Longer timeout:           csctf <url> --timeout-ms 90000`,
      `  Publish (simple):         csctf <url> --publish-to-gh-pages --yes`,
      `  Publish (custom repo):    csctf <url> --gh-pages-repo owner/name --yes`,
      `  Remember GH settings:     csctf <url> --publish-to-gh-pages --remember --yes`,
      '',
      'CDP mode (for sites with strong bot detection like Claude.ai):',
      `  1. Start Chrome with: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222`,
      `  2. Navigate to the share URL manually in Chrome`,
      `  3. Run: csctf <url> --cdp http://localhost:9222`,
      ''
    ].join('\n')
  )
}

export function slugify(title: string): string {
  let base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\./, 'chat_')
  if (/^\.*$/.test(base)) base = 'chatgpt_conversation'
  if (!base.length) base = 'chatgpt_conversation'
  if (base.length > MAX_SLUG_LEN) base = base.slice(0, MAX_SLUG_LEN).replace(/_+$/, '')
  const baseRoot = base.split('.')[0] ?? base
  if (RESERVED_BASENAMES.has(baseRoot)) base = `${base}_chatgpt`
  return base
}

export function uniquePath(basePath: string): string {
  if (!fs.existsSync(basePath)) return basePath
  const { dir, name, ext } = path.parse(basePath)
  let idx = 2
  const MAX_ATTEMPTS = 1000
  while (idx < MAX_ATTEMPTS) {
    const candidate = path.join(dir, `${name}_${idx}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
    idx += 1
  }
  const fallback = path.join(dir, `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`)
  if (!fs.existsSync(fallback)) return fallback
  throw new Error('Could not find a unique filename after many attempts.')
}

function buildTurndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })

  // Preserve paragraph structure for blocky containers that ChatGPT/Gemini use.
  // Some share layouts wrap text in <div>/<section>/<article> without <p>; ensure we emit blank lines.
  td.addRule('blockContainers', {
    filter: ['div', 'section', 'article', 'main', 'header', 'footer'],
    replacement: (content: string) => `\n\n${content.trim()}\n\n`
  })

  // Preserve explicit line breaks.
  td.addRule('breaks', {
    filter: ['br'],
    replacement: () => '\n'
  })

  // Block-level code (handles non-pre code containers like Grok's code-blocks).
  td.addRule('fencedCodeFallback', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'CODE') return false
      const text = node.textContent ?? ''
      const isBlocky =
        text.includes('\n') ||
        (text.length > 120 && /\s{2,}/.test(text)) ||
        (node.parentElement?.getAttribute('data-testid')?.includes('code-block') ?? false) ||
        (node.parentElement?.className ?? '').toLowerCase().includes('code-block')
      return isBlocky
    },
    replacement: (content: string) => {
      let codeText = (content || '').replace(/\u00a0/g, ' ').trimEnd()
      if (!codeText.includes('\n') && /\s{2,}/.test(codeText)) {
        codeText = codeText.replace(/\s{2,}/g, '\n')
      }
      const maxTicks = (codeText.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0)
      const fence = '`'.repeat(Math.max(3, maxTicks + 1))
      return `\n\n${fence}\n${codeText}\n${fence}\n\n`
    }
  })

  // Table rendering to Markdown (simple pipe tables).
  td.addRule('tables', {
    filter: 'table',
    replacement: (_content: string, node: HTMLElement) => {
      const rows = Array.from(node.querySelectorAll('tr')).map(tr =>
        Array.from(tr.querySelectorAll('th,td')).map(cell => (cell.textContent ?? '').trim().replace(/\s+/g, ' '))
      )
      if (!rows.length) return '\n'
      const header = rows[0]
      const body = rows.slice(1)
      const headerLine = `| ${header.join(' | ')} |`
      const separator = `| ${header.map(() => '---').join(' | ')} |`
      const bodyLines = body.map(r => `| ${r.join(' | ')} |`)
      return `\n\n${headerLine}\n${separator}\n${bodyLines.join('\n')}\n\n`
    }
  })

  const codeRule: Rule = {
    filter: (node: HTMLElement) => node.nodeName === 'PRE' && node.firstElementChild?.nodeName === 'CODE',
    replacement: (_content: string, node: HTMLElement) => {
      const codeNode = node.firstElementChild as HTMLElement | null
      const className = codeNode?.getAttribute('class') ?? ''
      const match = className.match(/language-([\w-]+)/)
      const lang = match?.[1] ?? ''
      const codeText = (codeNode?.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trimEnd()
      const maxTicks = (codeText.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0)
      const fence = '`'.repeat(Math.max(3, maxTicks + 1))
      return `\n\n${fence}${lang}\n${codeText}\n${fence}\n\n`
    }
  }

  // Handle <pre> blocks that may not wrap code nodes (seen in Grok/Gemini).
  td.addRule('preBlocks', {
    filter: (node: HTMLElement) => node.nodeName === 'PRE' && node.firstElementChild?.nodeName !== 'CODE',
    replacement: (_content: string, node: HTMLElement) => {
      const text = (node.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trimEnd()
      const maxTicks = (text.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0)
      const fence = '`'.repeat(Math.max(3, maxTicks + 1))
      return `\n\n${fence}\n${text}\n${fence}\n\n`
    }
  })

  // Convert multiline or long inline code into fenced blocks when it slipped past <pre>.
  td.addRule('inlineCodeToBlock', {
    filter: (node: HTMLElement) =>
      node.nodeName === 'CODE' &&
      node.parentElement?.nodeName !== 'PRE' &&
      Boolean((node.textContent ?? '').includes('\n') || (node.textContent ?? '').length > 240),
    replacement: (_content: string, node: HTMLElement) => {
      const text = (node.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trimEnd()
      const maxTicks = (text.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0)
      const fence = '`'.repeat(Math.max(3, maxTicks + 1))
      return `\n\n${fence}\n${text}\n${fence}\n\n`
    }
  })

  const rulesArray = (td as TurndownService & { rules: { array: Rule[] } }).rules.array
  const existingRuleIndex = rulesArray.findIndex(rule => {
    if (typeof rule.filter === 'string') return ['code', 'pre'].includes(rule.filter.toLowerCase())
    if (typeof rule.filter === 'function') return rule.filter.toString().includes('CODE')
    return false
  })

  if (existingRuleIndex >= 0) rulesArray.splice(existingRuleIndex, 0, codeRule)
  else td.addRule('fencedCodeWithLang', codeRule)

  return td
}

async function checkForUpdates(currentVersion: string, quiet: boolean): Promise<void> {
  const latestUrl = 'https://api.github.com/repos/Dicklesworthstone/chat_shared_conversation_to_file/releases/latest'
  try {
    if (fs.existsSync(UPDATE_CACHE_PATH)) {
      const raw = fs.readFileSync(UPDATE_CACHE_PATH, 'utf8')
      const cached = JSON.parse(raw) as { tag?: string; checkedAt?: string }
      const checkedAt = cached?.checkedAt ? Date.parse(cached.checkedAt) : 0
      const freshMs = 1000 * 60 * 60 * 6 // 6 hours
      if (checkedAt && Date.now() - checkedAt < freshMs && cached.tag) {
        if (!quiet) {
          const latest = cached.tag.replace(/^v/i, '')
          const current = currentVersion.replace(/^v/i, '')
          const upToDate = latest === current
          const msg = upToDate
            ? chalk.gray(`You are on the latest version (v${current}).`)
            : chalk.gray(`Latest release (cached): v${latest} (current v${current}).`)
          console.error(msg)
        }
        return
      }
    }
  } catch {
    // ignore cache errors
  }
  try {
    const res = await fetch(latestUrl, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `csctf/${currentVersion}`
      }
    })
    if (!res.ok) {
      if (!quiet) console.error(chalk.gray('Skipped update check (GitHub unavailable).'))
      return
    }
    const data = (await res.json()) as { tag_name?: string }
    if (data?.tag_name) {
      const latest = data.tag_name.replace(/^v/i, '')
      const current = currentVersion.replace(/^v/i, '')
      if (latest && !quiet) {
        const upToDate = latest === current
        const msg = upToDate
          ? chalk.gray(`You are on the latest version (v${current}).`)
          : chalk.gray(`Latest release: v${latest} (current v${current}).`)
        console.error(msg)
      }
      try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true })
        fs.writeFileSync(UPDATE_CACHE_PATH, JSON.stringify({ tag: data.tag_name, checkedAt: new Date().toISOString() }))
      } catch {
        // ignore cache write errors
      }
    }
  } catch {
    if (!quiet) console.error(chalk.gray('Skipped update check (offline or GitHub unavailable).'))
  }
}

async function attemptWithBackoff(fn: () => Promise<void>, timeoutMs: number, label: string): Promise<void> {
  const attempts = 3
  const baseDelay = 500
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  let tries = 0
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fn()
      return
    } catch (err) {
      lastErr = err
      tries += 1
      if (i < attempts - 1) {
        const delay = baseDelay * (i + 1)
        if (Date.now() + delay > deadline) break
        await new Promise(res => setTimeout(res, delay))
      }
    }
  }
  const made = Math.max(tries, 1)
  throw new Error(`Failed after ${made} attempt${made === 1 ? '' : 's'} while ${label}. Last error: ${lastErr}`)
}

function writeAtomic(target: string, content: string): void {
  const dir = path.dirname(target)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${Date.now()}`)
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, target)
  } finally {
    if (fs.existsSync(tmp)) {
      try {
        fs.unlinkSync(tmp)
      } catch {
        /* ignore */
      }
    }
  }
}

function copyToClipboard(content: string, quiet: boolean): boolean {
  const tryCmd = (cmd: string, args: string[]) => {
    try {
      const res = spawnSync(cmd, args, { input: content, stdio: ['pipe', 'ignore', quiet ? 'ignore' : 'inherit'] })
      return res.status === 0
    } catch {
      return false
    }
  }
  if (process.platform === 'darwin') return tryCmd('pbcopy', [])
  if (process.platform === 'win32') return tryCmd('clip', [])
  return tryCmd('wl-copy', []) || tryCmd('xclip', ['-selection', 'clipboard'])
}

function openFile(filePath: string, quiet: boolean): boolean {
  const cmd = process.platform === 'win32' ? 'cmd' : VIEWER_CMD
  const args = process.platform === 'win32' ? ['/c', 'start', '', filePath] : [filePath]
  try {
    const res = spawnSync(cmd, args, { stdio: quiet ? 'ignore' : 'inherit' })
    return res.status === 0
  } catch {
    return false
  }
}

function isGhCliAvailable(): boolean {
  const res = spawnSync('gh', ['--version'], { stdio: 'ignore' })
  return res.status === 0
}

function currentGhLogin(): string | null {
  const res = spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' })
  if (res.status !== 0) return null
  return (res.stdout || '').trim() || null
}

async function confirmPublish(summary: string, yes: boolean): Promise<void> {
  if (yes) return
  if (!process.stdin.isTTY) {
    throw new Error('Publishing requires confirmation (type PROCEED) or use --yes in non-interactive environments.')
  }
  console.error(chalk.yellow(summary))
  console.error(chalk.yellow('Type PROCEED to publish to GitHub Pages (public): '))
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer: string = await new Promise(resolve => rl.question('> ', resolve))
  rl.close()
  if (answer.trim() !== 'PROCEED') {
    throw new Error('Publish cancelled (confirmation not received).')
  }
}

type PublishOpts = {
  files: { path: string; kind: 'md' | 'html' }[]
  repo: string
  branch: string
  dir: string
  quiet: boolean
  verbose: boolean
  dryRun: boolean
  remember: boolean
  config: AppConfig
  entry: PublishHistoryItem
}

function resolveRepoUrl(input: string): { repo: string; url: string } {
  if (input.startsWith('http')) {
    const u = new URL(input)
    if (u.hostname !== 'github.com') {
      throw new Error('Only GitHub HTTPS URLs are supported for --gh-pages-repo')
    }
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
    if (parts.length !== 2) throw new Error('Repo URL must look like https://github.com/<owner>/<name>[.git]')
    const repo = `${parts[0]}/${parts[1]}`
    return { repo, url: `https://github.com/${repo}.git` }
  }
  if (!input.includes('/')) {
    const login = currentGhLogin()
    if (!login) throw new Error('Specify --gh-pages-repo as owner/name or ensure gh is logged in.')
    const full = `${login}/${input}`
    return { repo: full, url: `https://github.com/${full}.git` }
  }
  return { repo: input, url: `https://github.com/${input}.git` }
}

function renderIndex(manifest: PublishHistoryItem[], title = 'csctf exports'): string {
  const cards = manifest
    .map(item => {
      const mdLink = item.md ? `<a href="./${encodeURIComponent(item.md)}" class="btn secondary">Markdown</a>` : ''
      const htmlLink = item.html ? `<a href="./${encodeURIComponent(item.html)}" class="btn primary">HTML</a>` : ''
      const links = [htmlLink, mdLink].filter(Boolean).join('')
      const date = new Date(item.addedAt)
      const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      return `<article class="card">
  <div class="card-content">
    <div class="card-header">
      <time class="card-date">${formattedDate}</time>
    </div>
    <h2 class="card-title">${escapeHtml(item.title)}</h2>
    <div class="card-actions">${links}</div>
  </div>
</article>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light dark" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --color-bg: #fafbfc;
      --color-bg-alt: #ffffff;
      --color-bg-elevated: #ffffff;
      --color-text: #0f172a;
      --color-text-secondary: #475569;
      --color-text-muted: #64748b;
      --color-border: #e2e8f0;
      --color-border-hover: #cbd5e1;
      --color-accent: #6366f1;
      --color-accent-hover: #4f46e5;
      --color-accent-subtle: rgba(99, 102, 241, 0.1);
      --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
      --shadow-md: 0 4px 16px rgba(15, 23, 42, 0.08);
      --shadow-lg: 0 12px 40px rgba(15, 23, 42, 0.12);
      --shadow-glow: 0 0 0 3px var(--color-accent-subtle);
      --radius-md: 12px;
      --radius-lg: 16px;
      --radius-xl: 24px;
      --transition: 200ms cubic-bezier(0.4, 0, 0.2, 1);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --color-bg: #0a0f1a;
        --color-bg-alt: #111827;
        --color-bg-elevated: #1e293b;
        --color-text: #f1f5f9;
        --color-text-secondary: #cbd5e1;
        --color-text-muted: #94a3b8;
        --color-border: #1e293b;
        --color-border-hover: #334155;
        --color-accent: #818cf8;
        --color-accent-hover: #a5b4fc;
        --color-accent-subtle: rgba(129, 140, 248, 0.15);
        --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
        --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
        --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.5);
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .hero {
      position: relative;
      padding: clamp(48px, 10vw, 96px) clamp(24px, 5vw, 64px) clamp(32px, 6vw, 64px);
      text-align: center;
      overflow: hidden;
    }
    .hero::before {
      content: '';
      position: absolute;
      inset: 0;
      background: 
        radial-gradient(ellipse 100% 80% at 50% -20%, var(--color-accent-subtle), transparent 60%),
        radial-gradient(ellipse 80% 100% at 100% 0%, rgba(6, 182, 212, 0.08), transparent 50%),
        radial-gradient(ellipse 60% 80% at 0% 50%, rgba(236, 72, 153, 0.06), transparent 50%);
      pointer-events: none;
    }
    .hero-content {
      position: relative;
      max-width: 720px;
      margin: 0 auto;
    }
    .logo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, var(--color-accent), #06b6d4);
      border-radius: var(--radius-lg);
      margin-bottom: 24px;
      box-shadow: var(--shadow-lg), 0 0 0 1px rgba(255,255,255,0.1) inset;
    }
    .logo svg { width: 32px; height: 32px; color: white; }
    h1 {
      margin: 0 0 12px;
      font-size: clamp(2rem, 5vw, 3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(135deg, var(--color-text) 0%, var(--color-text-secondary) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      margin: 0;
      font-size: clamp(1rem, 2vw, 1.125rem);
      color: var(--color-text-muted);
      max-width: 480px;
      margin: 0 auto;
    }
    .main {
      flex: 1;
      padding: 0 clamp(24px, 5vw, 64px) clamp(48px, 8vw, 96px);
    }
    .grid-container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .grid {
      display: grid;
      gap: 20px;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    }
    .card {
      background: var(--color-bg-elevated);
      border: 1px solid var(--color-border);
      border-radius: var(--radius-lg);
      padding: 24px;
      transition: all var(--transition);
      position: relative;
    }
    .card:hover {
      transform: translateY(-4px);
      border-color: var(--color-accent);
      box-shadow: var(--shadow-lg), var(--shadow-glow);
    }
    .card-content { display: flex; flex-direction: column; gap: 12px; }
    .card-header { display: flex; align-items: center; justify-content: space-between; }
    .card-date {
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--color-text-muted);
      padding: 4px 10px;
      background: var(--color-accent-subtle);
      border-radius: 9999px;
    }
    .card-title {
      margin: 0;
      font-size: 1.0625rem;
      font-weight: 600;
      color: var(--color-text);
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .card-actions { display: flex; gap: 10px; margin-top: 4px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 18px;
      border-radius: 9999px;
      font-weight: 600;
      text-decoration: none;
      font-size: 0.875rem;
      border: 1px solid transparent;
      transition: all var(--transition);
      cursor: pointer;
    }
    .btn.primary {
      background: var(--color-accent);
      color: white;
      box-shadow: var(--shadow-sm);
    }
    .btn.primary:hover {
      background: var(--color-accent-hover);
      transform: translateY(-1px);
      box-shadow: var(--shadow-md);
    }
    .btn.secondary {
      background: var(--color-bg-alt);
      color: var(--color-text-secondary);
      border-color: var(--color-border);
    }
    .btn.secondary:hover {
      border-color: var(--color-border-hover);
      background: var(--color-bg);
    }
    .empty {
      text-align: center;
      padding: 64px 24px;
      color: var(--color-text-muted);
    }
    .empty-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 16px;
      opacity: 0.5;
    }
    .footer {
      text-align: center;
      padding: 32px;
      color: var(--color-text-muted);
      font-size: 0.875rem;
      border-top: 1px solid var(--color-border);
    }
    .footer a { color: var(--color-accent); text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    @media (max-width: 640px) {
      .grid { grid-template-columns: 1fr; }
      .card { padding: 20px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <header class="hero">
      <div class="hero-content">
        <div class="logo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <h1>${escapeHtml(title)}</h1>
        <p class="subtitle">Your AI conversations, beautifully rendered and shareable</p>
      </div>
    </header>
    <main class="main">
      <div class="grid-container">
        ${manifest.length > 0 ? `<div class="grid">${cards}</div>` : `
        <div class="empty">
          <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
          </svg>
          <p>No conversations yet</p>
        </div>
        `}
      </div>
    </main>
    <footer class="footer">
      Powered by <a href="https://github.com/Dicklesworthstone/chat_shared_conversation_to_file" target="_blank">csctf</a>
    </footer>
  </div>
</body>
</html>`
}

export async function publishToGhPages(opts: PublishOpts): Promise<AppConfig> {
  const { files, repo, branch, dir, quiet, dryRun, remember, config, entry } = opts
  if (!repo || !repo.trim()) {
    throw new Error('GitHub repository is required for publishing (owner/name).')
  }
  let tmp: string | null = null
  const cleanupTmp = () => {
    if (tmp) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }

  if (dryRun) {
    try {
      tmp = fs.mkdtempSync(path.join(fs.realpathSync(osTmpDir()), 'csctf-ghp-dry-'))
      const targetDir = path.join(tmp, dir)
      fs.mkdirSync(targetDir, { recursive: true })
      const manifest: PublishHistoryItem[] = []
      const manifestPath = path.join(targetDir, 'manifest.json')
      const manifestEntry: PublishHistoryItem = {
        title: entry.title,
        md: files.find(f => f.kind === 'md')?.path ? path.basename(files.find(f => f.kind === 'md')!.path) : undefined,
        html: files.find(f => f.kind === 'html')?.path ? path.basename(files.find(f => f.kind === 'html')!.path) : undefined,
        addedAt: entry.addedAt
      }
      for (const file of files) {
        const dest = path.join(targetDir, path.basename(file.path))
        fs.copyFileSync(file.path, dest)
      }
      manifest.push(manifestEntry)
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
      const indexHtml = renderIndex(manifest)
      fs.writeFileSync(path.join(targetDir, 'index.html'), indexHtml, 'utf8')
      return config
    } finally {
      cleanupTmp()
    }
  }
  ensureGhAuth()
  const { repo: repoName, url } = resolveRepoUrl(repo)
  const cleanUrl = url.replace(/https:\/\/[^@]+@/, 'https://')
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(osTmpDir()), 'csctf-ghp-'))

  const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  const safeRun = (args: string[]) => {
    const res = spawnSync('git', args, {
      cwd: tmp,
      stdio: quiet ? 'ignore' : 'inherit',
      env: gitEnv
    })
    if (res.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed with code ${res.status ?? 'unknown'}`)
    }
  }

  const logProgress = (msg: string) => {
    if (!quiet) console.error(chalk.gray(`   ${msg}`))
  }

  const gitWithRetry = (args: string[], label: string, attempts = 3, delayMs = 500): number => {
    let lastStatus = 1
    for (let i = 0; i < attempts; i += 1) {
      const res = spawnSync('git', args, { cwd: tmp!, stdio: quiet ? 'ignore' : 'inherit', env: gitEnv })
      lastStatus = res.status ?? 1
      if (lastStatus === 0) return 0
      if (!quiet) console.error(chalk.gray(`   retrying ${label} (${i + 1}/${attempts})...`))
      const waitMs = Math.min(2000, delayMs * (i + 1))
      const start = Date.now()
      while (Date.now() - start < waitMs) {
        // busy-wait fallback for environments without timers in spawn context
      }
    }
    return lastStatus
  }

  const attemptClone = (branchName: string): number => {
    logProgress(`Cloning branch ${branchName}...`)
    return gitWithRetry(['clone', '--depth', '1', '--branch', branchName, cleanUrl, tmp!], `clone ${branchName}`)
  }

  let cloned = attemptClone(branch)
  if (cloned !== 0) {
    logProgress('Branch clone failed; trying default branch...')
    const defaultClone = gitWithRetry(['clone', '--depth', '1', cleanUrl, tmp!], 'clone default')
    if (defaultClone !== 0) {
      if (isGhCliAvailable()) {
        const create = spawnSync('gh', ['repo', 'create', repoName, '--public', '--confirm'], {
          stdio: quiet ? 'ignore' : 'inherit'
        })
        if (create.status !== 0) {
          throw new Error('Failed to create repository via gh. Provide an existing repo with --gh-pages-repo owner/name.')
        }
        // Clone newly created repo (default branch)
        const createdClone = gitWithRetry(['clone', '--depth', '1', cleanUrl, tmp!], 'clone created repo')
        if (createdClone !== 0) {
          throw new Error('Failed to clone newly created repository.')
        }
        cloned = 0
      } else {
        throw new Error('Failed to clone repository. Ensure repo exists or install gh and set --gh-pages-repo owner/name.')
      }
    }
  }

  if (cloned !== 0) {
    logProgress(`Creating branch ${branch}...`)
    safeRun(['checkout', '-b', branch])
  } else if (branch) {
    logProgress(`Switching to branch ${branch}...`)
    safeRun(['checkout', '-B', branch])
  }

  // Configure identity for headless/CI (git credential helper should be provided by gh auth)
  safeRun(['config', 'user.email', 'bot@csctf.local'])
  safeRun(['config', 'user.name', 'csctf'])

  const targetDir = path.join(tmp, dir)
  fs.mkdirSync(targetDir, { recursive: true })
  // Ensure GitHub Pages skips Jekyll at the repo root and inside the publish dir
  fs.writeFileSync(path.join(tmp, '.nojekyll'), '', 'utf8')
  fs.writeFileSync(path.join(targetDir, '.nojekyll'), '', 'utf8')

  const manifestPath = path.join(targetDir, 'manifest.json')
  let manifest: PublishHistoryItem[] = []
  try {
    if (fs.existsSync(manifestPath)) {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PublishHistoryItem[]
    }
  } catch {
    manifest = []
  }

  let mdName: string | undefined
  let htmlName: string | undefined

  for (const file of files) {
    const base = path.basename(file.path)
    const dest = path.join(targetDir, base)
    fs.copyFileSync(file.path, dest)
    if (file.kind === 'md') mdName = base
    if (file.kind === 'html') htmlName = base
  }

  const newEntry: PublishHistoryItem = {
    title: entry.title,
    md: mdName,
    html: htmlName,
    addedAt: entry.addedAt
  }

  manifest = manifest.filter(
    item => !(item.md && item.md === mdName) && !(item.html && htmlName && item.html === htmlName)
  )
  manifest.push(newEntry)
  manifest.sort((a, b) => b.addedAt.localeCompare(a.addedAt))

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  const indexHtml = renderIndex(manifest)
  fs.writeFileSync(path.join(targetDir, 'index.html'), indexHtml, 'utf8')
  fs.writeFileSync(path.join(targetDir, '.nojekyll'), '', 'utf8')
  // Purge orphaned files not in manifest/index/.nojekyll
  const keep = new Set<string>(['manifest.json', 'index.html', '.nojekyll'])
  manifest.forEach(item => {
    if (item.md) keep.add(item.md)
    if (item.html) keep.add(item.html)
  })
  for (const fname of fs.readdirSync(targetDir)) {
    if (!keep.has(fname)) {
      const toDelete = path.join(targetDir, fname)
      try {
        const stat = fs.statSync(toDelete)
        if (stat.isFile()) fs.unlinkSync(toDelete)
      } catch {
        /* ignore */
      }
    }
  }

  if (dryRun) {
    if (!quiet) console.error(chalk.gray('Dry run: skipping git commit/push'))
    return config
  }

  logProgress('Staging files...')
  safeRun(['add', '.'])
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: tmp, encoding: 'utf8' })
  if (status.stdout.trim().length === 0) return config
  logProgress('Committing...')
  safeRun(['commit', '-m', `Add csctf export: ${entry.title.slice(0, 60)}`])
  logProgress('Pushing...')
  const pushStatus = gitWithRetry(['push', 'origin', branch], 'push')
  if (pushStatus !== 0) {
    throw new Error('git push failed after retries')
  }

  if (remember) {
    const nextCfg: AppConfig = {
      ...config,
      gh: { repo: repoName, branch, dir }
    }
    saveConfig(nextCfg)
    cleanupTmp()
    return nextCfg
  }

  cleanupTmp()
  return config
}

function osTmpDir(): string {
  return os.tmpdir()
}

function normalizeLineTerminators(markdown: string): string {
  // Remove Unicode LS (\u2028) and PS (\u2029) which can break editors/linters.
  return markdown.replace(/[\u2028\u2029]/g, '\n')
}

function detectProvider(url: string): Provider {
  try {
    const host = new URL(url).hostname.toLowerCase()
    for (const entry of PROVIDER_PATTERNS) {
      if (entry.patterns.some(p => p.test(host))) return entry.id
    }
  } catch {
    // ignore
  }
  return 'chatgpt'
}

async function scrape(
  url: string,
  timeoutMs: number,
  provider: Provider,
  opts: {
    waitForSelector?: string
    debug?: boolean
    headless: boolean
    useChromeProfile?: boolean
    stealthMode?: boolean
    cdpEndpoint?: string
    quiet?: boolean
  }
): Promise<{ title: string; markdown: string; retrievedAt: string }> {
  const td = buildTurndown()
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page!: Page
  let currentHeadless = opts.headless
  const resolveChromiumExecutable = (): string | undefined => {
    const candidates =
      process.platform === 'darwin'
        ? [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'
          ]
        : process.platform === 'win32'
        ? [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
          ]
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium'
          ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    return undefined
  }
  const dumpDebug = async (): Promise<string | null> => {
    if (!opts.debug || !page) return null
    try {
      const html = await page.content()
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csctf-debug-'))
      const file = path.join(dir, 'page.html')
      fs.writeFileSync(file, html, 'utf8')
      return file
    } catch {
      return null
    }
  }

  // Get Chrome user data directory for profile-based auth
  const getChromeUserDataDir = (): string | undefined => {
    const dirs =
      process.platform === 'darwin'
        ? [path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome')]
        : process.platform === 'win32'
        ? [
            path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
            path.join(os.homedir(), 'AppData', 'Roaming', 'Google', 'Chrome', 'User Data')
          ]
        : [path.join(os.homedir(), '.config', 'google-chrome'), path.join(os.homedir(), '.config', 'chromium')]
    for (const dir of dirs) {
      if (fs.existsSync(dir)) return dir
    }
    return undefined
  }

  // Enhanced stealth init script
  const stealthScript = () => {
    // Remove webdriver property completely
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    // Delete the property entirely for extra safety
    // @ts-expect-error: delete webdriver
    delete navigator.webdriver

    // Override permissions API
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions)
    window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters)

    // More realistic navigator properties
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    Object.defineProperty(navigator, 'platform', {
      get: () => (navigator.userAgent.includes('Mac') ? 'MacIntel' : 'Win32')
    })
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 })
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 })

    // Realistic plugins array (Chrome on macOS)
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          {
            name: 'Chrome PDF Viewer',
            filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
            description: 'Portable Document Format'
          },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
        ]
        const arr = plugins.map(p => {
          const plugin = Object.create(Plugin.prototype)
          Object.defineProperty(plugin, 'name', { value: p.name })
          Object.defineProperty(plugin, 'filename', { value: p.filename })
          Object.defineProperty(plugin, 'description', { value: p.description })
          Object.defineProperty(plugin, 'length', { value: 1 })
          return plugin
        })
        // @ts-expect-error: custom plugins array
        arr.item = (i: number) => arr[i]
        // @ts-expect-error: custom plugins array
        arr.namedItem = (name: string) => arr.find(p => p.name === name)
        // @ts-expect-error: custom plugins array
        arr.refresh = () => {}
        return arr
      }
    })

    // Chrome runtime object for additional stealth
    // @ts-expect-error: chrome object
    window.chrome = {
      runtime: {
        connect: () => {},
        sendMessage: () => {},
        onMessage: { addListener: () => {} }
      },
      loadTimes: () => ({
        commitLoadTime: Date.now() / 1000 - Math.random() * 2,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
        finishLoadTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 - Math.random() * 2,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - Math.random() * 3,
        startLoadTime: Date.now() / 1000 - Math.random() * 3,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true
      }),
      csi: () => ({
        onloadT: Date.now(),
        pageT: Date.now() - Math.random() * 5000,
        startE: Date.now() - Math.random() * 5000,
        tran: 15
      })
    }

    // Override toString to hide modifications
    const origToString = Function.prototype.toString
    Function.prototype.toString = function () {
      if (this === window.navigator.permissions.query) {
        return 'function query() { [native code] }'
      }
      return origToString.call(this)
    }

    // Canvas fingerprint randomization
    const origGetContext = HTMLCanvasElement.prototype.getContext
    // @ts-expect-error: override getContext with type coercion
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      const ctx = origGetContext.call(this, type, ...args)
      if (type === '2d' && ctx) {
        const ctx2d = ctx as CanvasRenderingContext2D
        const origGetImageData = ctx2d.getImageData.bind(ctx2d)
        ctx2d.getImageData = function (sx: number, sy: number, sw: number, sh: number, settings?: ImageDataSettings) {
          const imageData = origGetImageData(sx, sy, sw, sh, settings)
          // Add tiny noise to prevent fingerprinting
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (Math.random() - 0.5) * 2))
          }
          return imageData
        }
      }
      return ctx
    }

    // WebGL fingerprint protection
    const getParameterProxyHandler = {
      apply(target: (pname: number) => unknown, thisArg: WebGLRenderingContext, args: unknown[]) {
        const param = args[0]
        // Randomize some WebGL parameters
        if (param === 37445) return 'Intel Inc.' // UNMASKED_VENDOR_WEBGL
        if (param === 37446) return 'Intel Iris OpenGL Engine' // UNMASKED_RENDERER_WEBGL
        return Reflect.apply(target, thisArg, args)
      }
    }
    WebGLRenderingContext.prototype.getParameter = new Proxy(
      WebGLRenderingContext.prototype.getParameter,
      getParameterProxyHandler
    )

    // ===== HEADLESS DETECTION EVASION =====

    // Fix window.outerHeight/outerWidth (0 in headless mode - major detection vector)
    const viewportWidth = 1366
    const viewportHeight = 768
    Object.defineProperty(window, 'outerWidth', { get: () => viewportWidth })
    Object.defineProperty(window, 'outerHeight', { get: () => viewportHeight + 85 }) // Chrome window chrome height
    Object.defineProperty(window, 'innerWidth', { get: () => viewportWidth })
    Object.defineProperty(window, 'innerHeight', { get: () => viewportHeight })
    Object.defineProperty(window, 'screenX', { get: () => 0 })
    Object.defineProperty(window, 'screenY', { get: () => 25 }) // macOS menu bar offset

    // Fix screen properties
    Object.defineProperty(screen, 'availWidth', { get: () => 1920 })
    Object.defineProperty(screen, 'availHeight', { get: () => 1055 }) // 1080 - dock/taskbar
    Object.defineProperty(screen, 'width', { get: () => 1920 })
    Object.defineProperty(screen, 'height', { get: () => 1080 })
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 })
    Object.defineProperty(screen, 'pixelDepth', { get: () => 24 })

    // Fix devicePixelRatio (sometimes wrong in headless)
    Object.defineProperty(window, 'devicePixelRatio', { get: () => 2 }) // Retina display

    // Add navigator.connection (missing in some headless configurations)
    if (!(navigator as { connection?: unknown }).connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          downlink: 10,
          effectiveType: '4g',
          rtt: 50,
          saveData: false,
          onchange: null
        })
      })
    }

    // Fix document.hasFocus() (returns false in headless)
    document.hasFocus = () => true

    // Override matchMedia to hide headless indicators
    const origMatchMedia = window.matchMedia.bind(window)
    window.matchMedia = (query: string) => {
      // Some sites check for specific media queries to detect headless
      if (query === '(prefers-reduced-motion: reduce)') {
        return { matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true } as MediaQueryList
      }
      return origMatchMedia(query)
    }

    // Hide automation-related errors in stack traces
    const ErrorWithStackTrace = Error as typeof Error & { prepareStackTrace?: unknown }
    const origPrepareStackTrace = ErrorWithStackTrace.prepareStackTrace
    ErrorWithStackTrace.prepareStackTrace = function (err: Error, stack: NodeJS.CallSite[]) {
      // Filter out any Playwright/Puppeteer related frames
      const filteredStack = stack.filter(frame => {
        const fileName = frame.getFileName() || ''
        return !fileName.includes('pptr:') && !fileName.includes('__puppeteer') && !fileName.includes('playwright')
      })
      if (origPrepareStackTrace) {
        return origPrepareStackTrace(err, filteredStack)
      }
      return filteredStack.map(frame => `    at ${frame}`).join('\n')
    }

    // Add Notification.permission if not present
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // Keep default, but make sure the API exists properly
    }

    // Prevent detection via missing window.Notification
    if (typeof Notification === 'undefined') {
      const win = window as typeof window & { Notification: unknown }
      const notifShim = function () {} as unknown as typeof Notification
      win.Notification = notifShim
      ;(notifShim as unknown as { permission: string }).permission = 'default'
      ;(notifShim as unknown as { requestPermission: () => Promise<string> }).requestPermission = () => Promise.resolve('default')
    }

    // Fix potential issues with performance.memory (Chrome-specific, may reveal headless)
    const perfWithMemory = performance as Performance & { memory?: unknown }
    if (perfWithMemory.memory) {
      Object.defineProperty(performance, 'memory', {
        get: () => ({
          jsHeapSizeLimit: 2172649472,
          totalJSHeapSize: 19356000 + Math.floor(Math.random() * 1000000),
          usedJSHeapSize: 16456000 + Math.floor(Math.random() * 1000000)
        })
      })
    }

    // Override PerformanceObserver to prevent timing-based detection
    const origPerformanceObserver = window.PerformanceObserver
    ;(window as { PerformanceObserver: typeof PerformanceObserver }).PerformanceObserver = class extends origPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        super((list, observer) => {
          // Filter out any entries that might reveal automation
          callback(list, observer)
        })
      }
    }

    // ===== CLOUDFLARE-SPECIFIC ANTI-DETECTION =====

    // Remove CDP-related variables that Cloudflare checks for
    // Chrome DevTools Protocol adds variables like $cdc_asdjflasutopfhvcZLmcfl_
    const deleteAutomationVars = () => {
      const globalObj = window as unknown as Record<string, unknown>
      for (const prop of Object.keys(globalObj)) {
        if (prop.startsWith('cdc_') || prop.startsWith('$cdc_') || prop.includes('webdriver') || prop.includes('selenium') || prop.includes('driver')) {
          try {
            delete globalObj[prop]
          } catch {
            // Some properties can't be deleted
          }
        }
      }
    }
    deleteAutomationVars()
    // Periodically clean up in case CDP adds them later
    setInterval(deleteAutomationVars, 500)

    // Override document.hidden to always return false (focused browser)
    Object.defineProperty(document, 'hidden', { get: () => false })
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' })

    // Ensure document has focus events working
    const focusEvent = new FocusEvent('focus', { bubbles: true })
    document.dispatchEvent(focusEvent)

    // Override iframe contentWindow to prevent Turnstile iframe detection
    const origIframeDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')
    if (origIframeDesc?.get) {
      const origGetter = origIframeDesc.get
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function () {
          const win = origGetter.call(this)
          if (win) {
            try {
              // Make the iframe appear to have proper parent reference
              Object.defineProperty(win, 'parent', { value: window })
              Object.defineProperty(win, 'top', { value: window })
            } catch {
              // Cross-origin iframes will throw
            }
          }
          return win
        }
      })
    }

    // Fix navigator.getBattery (returns empty promise in some headless configs)
    if (!('getBattery' in navigator)) {
      Object.defineProperty(navigator, 'getBattery', {
        value: () => Promise.resolve({
          charging: true,
          chargingTime: 0,
          dischargingTime: Infinity,
          level: 1,
          onchargingchange: null,
          onchargingtimechange: null,
          ondischargingtimechange: null,
          onlevelchange: null
        })
      })
    }

    // Override AudioContext to prevent audio fingerprinting detection
    const OriginalAudioContext = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (OriginalAudioContext) {
      const audioContextProto = OriginalAudioContext.prototype
      const origCreateOscillator = audioContextProto.createOscillator
      audioContextProto.createOscillator = function () {
        const osc = origCreateOscillator.call(this)
        // Add tiny random variation to prevent fingerprinting
        const origConnect = osc.connect.bind(osc) as OscillatorNode['connect']
        osc.connect = origConnect
        return osc
      }
    }

    // Spoof timezone if needed (some sites check for inconsistencies)
    const origDateTimeFormat = Intl.DateTimeFormat
    ;(Intl as { DateTimeFormat: typeof origDateTimeFormat }).DateTimeFormat = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      return new origDateTimeFormat(locales, { ...options, timeZone: options?.timeZone || 'America/New_York' })
    } as typeof origDateTimeFormat
  }

  // Current Chrome UA (Dec 2024)
  const chromeVersion = '131'
  const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Safari/537.36`
  const realHeaders: Record<string, string> = {
    'sec-ch-ua': `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not_A Brand";v="24"`,
    'sec-ch-ua-platform': '"macOS"',
    'sec-ch-ua-mobile': '?0',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'accept-language': 'en-US,en;q=0.9',
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
  }

  // Launch browser with stealth settings
  const launchBrowser = async (headless: boolean, useProfile: boolean) => {
    // Base args for anti-detection
    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--window-size=1366,768',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      // Additional anti-detection args
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-pings'
    ]

    // For headless mode, use Chrome's new headless mode (--headless=new)
    // which is much harder to detect than the old headless mode
    // We pass headless=false to Playwright and manually add --headless=new
    const useNewHeadless = headless && resolveChromiumExecutable() !== undefined
    if (useNewHeadless) {
      launchArgs.push('--headless=new')
    }

    // When using profile, we need to launch with persistent context
    if (useProfile) {
      const userDataDir = getChromeUserDataDir()
      if (userDataDir && fs.existsSync(userDataDir)) {
        // Create a temporary profile based on the real one to avoid locking issues
        const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'csctf-profile-'))
        // Copy cookies and local storage from real profile
        const defaultProfile = path.join(userDataDir, 'Default')
        if (fs.existsSync(defaultProfile)) {
          const cookiesSrc = path.join(defaultProfile, 'Cookies')
          const cookiesDst = path.join(tempProfile, 'Default', 'Cookies')
          const localStateSrc = path.join(userDataDir, 'Local State')
          const localStateDst = path.join(tempProfile, 'Local State')
          fs.mkdirSync(path.join(tempProfile, 'Default'), { recursive: true })
          if (fs.existsSync(cookiesSrc)) {
            try {
              fs.copyFileSync(cookiesSrc, cookiesDst)
            } catch {
              // Ignore copy errors - Chrome may have the file locked
            }
          }
          if (fs.existsSync(localStateSrc)) {
            try {
              fs.copyFileSync(localStateSrc, localStateDst)
            } catch {
              // Ignore copy errors
            }
          }
        }
        return chromium.launchPersistentContext(tempProfile, {
          headless: useNewHeadless ? false : headless, // Use false when using --headless=new
          executablePath: resolveChromiumExecutable(),
          args: launchArgs,
          userAgent,
          viewport: { width: 1366, height: 768 },
          ignoreDefaultArgs: ['--enable-automation']
        })
      }
    }

    // Standard launch without profile
    const b = await chromium.launch({
      headless: useNewHeadless ? false : headless, // Use false when using --headless=new
      executablePath: resolveChromiumExecutable(),
      args: launchArgs,
      ignoreDefaultArgs: ['--enable-automation']
    })
    return b
  }

  try {
    // CDP mode: Used for Claude.ai (Cloudflare protection) or as fallback when Playwright is blocked
    // When Playwright fails due to bot detection, we automatically fall back to CDP mode
    let useCdp = opts.cdpEndpoint !== undefined || provider === 'claude'

    // Helper to trigger CDP fallback - closes browser and switches mode
    const triggerCdpFallback = async (reason: string) => {
      if (browser) {
        await browser.close().catch(() => {})
        browser = null
      }
      console.error(chalk.yellow(`\n⚠️  ${reason}`))
      console.error(chalk.gray('    Falling back to Chrome CDP mode (uses your real browser)...\n'))
      useCdp = true
    }

    // Retry loop - allows falling back from Playwright to CDP
    for (let attempt = 0; attempt < 2; attempt++) {

    if (useCdp) {
      const endpoint = opts.cdpEndpoint || 'http://localhost:9222'

      // Track whether we launched Chrome with temp profile (for restoration later)
      let launchedWithTempProfile = false
      let tempProfileDir = ''

      // Detect which Chrome variant is installed/running (prefer Canary, then regular Chrome)
      const chromePaths = [
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      ]
      const chromeApps = [
        { process: 'Google Chrome Canary', app: 'Google Chrome Canary', path: chromePaths[0] },
        { process: 'Google Chrome', app: 'Google Chrome', path: chromePaths[1] }
      ]

      // Find which Chrome is running or use the first available
      let activeChrome = chromeApps.find(c => {
        const check = spawnSync('pgrep', ['-x', c.process], { encoding: 'utf-8' })
        return check.status === 0
      })

      // If none running, find first installed
      if (!activeChrome) {
        activeChrome = chromeApps.find(c => fs.existsSync(c.path)) || chromeApps[1]
      }

      const chromePath = resolveChromiumExecutable() || activeChrome.path
      const chromeAppName = activeChrome.app

      // Try to connect to existing Chrome with debugging using puppeteer-core (bun compatible)
      let puppeteerBrowser: PuppeteerBrowser | null = null
      let connected = false
      try {
        if (!opts.quiet) console.error(chalk.blue(`[1/8] Connecting to Chrome...`))
        puppeteerBrowser = await puppeteer.connect({
          browserURL: endpoint,
          defaultViewport: null
        })
        connected = true
        if (!opts.quiet) console.error(chalk.gray('    Connected to existing Chrome instance'))
      } catch (connectErr) {
        // Log the actual error for debugging
        console.error(chalk.gray(`    CDP connection failed: ${connectErr instanceof Error ? connectErr.message : String(connectErr)}`))
        // Chrome not running with debugging - check if any Chrome variant is running
        const chromeAlreadyRunning = chromeApps.some(c => {
          const check = spawnSync('pgrep', ['-x', c.process], { encoding: 'utf-8' })
          return check.status === 0
        })

        if (chromeAlreadyRunning && process.platform === 'darwin') {
          // Save all open Chrome tabs before restarting
          let savedTabs: string[] = []
          const saveTabsScript = `
            tell application "${chromeAppName}"
              set tabList to {}
              repeat with w in windows
                repeat with t in tabs of w
                  set end of tabList to URL of t
                end repeat
              end repeat
              return tabList
            end tell
          `
          const result = spawnSync('osascript', ['-e', saveTabsScript], { encoding: 'utf-8' })
          if (result.stdout) {
            savedTabs = result.stdout.trim().split(', ').filter(u => u && u !== 'missing value')
          }

          // Offer to automatically restart Chrome
          console.error(chalk.yellow('\n⚠️  Chrome needs to restart with remote debugging enabled.'))
          if (savedTabs.length > 0) {
            console.error(chalk.gray(`    Your ${savedTabs.length} open tab(s) will be saved and restored automatically.\n`))
          }
          console.error(chalk.white('    Press Enter to restart Chrome, or Ctrl+C to cancel...'))

          const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
          await new Promise<void>(resolve => rl.question('', () => { rl.close(); resolve() }))

          // Save tabs to temp file for restoration (include app name)
          if (savedTabs.length > 0) {
            const tabsFile = path.join(os.tmpdir(), 'csctf-chrome-tabs.json')
            fs.writeFileSync(tabsFile, JSON.stringify({ app: chromeAppName, tabs: savedTabs }, null, 2))
          }

          // Gracefully quit Chrome using AppleScript
          console.error(chalk.gray('    Closing Chrome...'))
          spawnSync('osascript', ['-e', `tell application "${chromeAppName}" to quit`], { encoding: 'utf-8' })

          // Wait for Chrome to fully close
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 500))
            const stillRunning = chromeApps.some(c => {
              const check = spawnSync('pgrep', ['-x', c.process], { encoding: 'utf-8' })
              return check.status === 0
            })
            if (!stillRunning) break
          }

          // Force kill any remaining Chrome processes (background helpers, etc.)
          spawnSync('pkill', ['-9', '-f', 'Google Chrome'], { encoding: 'utf-8' })
          await new Promise(r => setTimeout(r, 1000))

          // Final verification - check for main Chrome processes only
          const stillRunning = chromeApps.some(c => {
            const check = spawnSync('pgrep', ['-x', c.process], { encoding: 'utf-8' })
            return check.status === 0
          })
          if (stillRunning) {
            throw new AppError(
              'Chrome is still running.',
              'Please close Chrome manually and try again.'
            )
          }
        } else if (chromeAlreadyRunning) {
          // Non-macOS: ask user to close manually
          console.error(chalk.yellow('\n⚠️  Chrome is running but without remote debugging enabled.'))
          console.error(chalk.yellow('    Please close ALL Chrome windows, then press Enter to continue...\n'))

          const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
          await new Promise<void>(resolve => rl.question('', () => { rl.close(); resolve() }))

          await new Promise(r => setTimeout(r, 1000))
          const stillRunning = chromeApps.some(c => {
            const check = spawnSync('pgrep', ['-x', c.process], { encoding: 'utf-8' })
            return check.status === 0
          })
          if (stillRunning) {
            throw new AppError('Chrome is still running.', 'Please close all Chrome windows and try again.')
          }
        }

        // Now launch Chrome with debugging
        if (!opts.quiet) console.error(chalk.blue(`[1/8] Launching Chrome with remote debugging...`))

        // Chrome requires a non-default user-data-dir for remote debugging
        // Copy the user's cookies to a temp profile to preserve their session
        tempProfileDir = path.join(os.tmpdir(), 'csctf-chrome-debug')
        const tempDefaultDir = path.join(tempProfileDir, 'Default')

        // Find user's Chrome profile directory
        let userProfileDir: string | null = null
        if (process.platform === 'darwin') {
          const chromeProfilePaths = [
            path.join(os.homedir(), 'Library/Application Support/Google/Chrome/Default'),
            path.join(os.homedir(), 'Library/Application Support/Google/Chrome Canary/Default')
          ]
          userProfileDir = chromeProfilePaths.find(p => fs.existsSync(path.join(p, 'Cookies'))) || null
        } else if (process.platform === 'win32') {
          const localAppData = process.env.LOCALAPPDATA || ''
          userProfileDir = path.join(localAppData, 'Google/Chrome/User Data/Default')
        } else {
          userProfileDir = path.join(os.homedir(), '.config/google-chrome/Default')
        }

        // Create temp profile with copied cookies
        if (!fs.existsSync(tempDefaultDir)) {
          fs.mkdirSync(tempDefaultDir, { recursive: true })
        }

        if (userProfileDir && fs.existsSync(userProfileDir)) {
          // Copy essential session files (cookies, login data, local storage)
          const filesToCopy = ['Cookies', 'Login Data', 'Web Data']
          for (const file of filesToCopy) {
            const src = path.join(userProfileDir, file)
            const dest = path.join(tempDefaultDir, file)
            if (fs.existsSync(src)) {
              try {
                fs.copyFileSync(src, dest)
              } catch {
                // Some files may be locked, that's ok
              }
            }
          }
          // Copy Sessions folder if it exists
          const sessionsDir = path.join(userProfileDir, 'Sessions')
          const destSessionsDir = path.join(tempDefaultDir, 'Sessions')
          if (fs.existsSync(sessionsDir)) {
            try {
              if (!fs.existsSync(destSessionsDir)) fs.mkdirSync(destSessionsDir)
              for (const f of fs.readdirSync(sessionsDir)) {
                fs.copyFileSync(path.join(sessionsDir, f), path.join(destSessionsDir, f))
              }
            } catch {
              // Ignore copy errors
            }
          }
          if (!opts.quiet) console.error(chalk.gray('    Copied session cookies to temp profile'))
        }

        // Launch Chrome with temp profile that has debugging enabled
        const child = spawn(chromePath, [
          '--remote-debugging-port=9222',
          '--user-data-dir=' + tempProfileDir,
          '--no-first-run',
          '--no-default-browser-check',
          url
        ], {
          detached: true,
          stdio: 'ignore'
        })
        child.unref()
        launchedWithTempProfile = true

        if (!child.pid) {
          throw new AppError(
            `Could not launch Chrome.`,
            `Ensure Chrome is installed at: ${chromePath}`
          )
        }

        // Wait for Chrome to start and become available
        if (!opts.quiet) console.error(chalk.gray('    Waiting for Chrome to start...'))
        for (let attempt = 0; attempt < 15; attempt++) {
          await new Promise(r => setTimeout(r, 1000))
          try {
            puppeteerBrowser = await puppeteer.connect({
              browserURL: endpoint,
              defaultViewport: null
            })
            connected = true
            if (!opts.quiet) console.error(chalk.gray('    Chrome ready'))
            break
          } catch {
            // Keep trying
          }
        }
      }

      if (!connected || !puppeteerBrowser) {
        throw new AppError(
          `Could not connect to Chrome.`,
          `Close all Chrome windows and try again. The tool needs to launch Chrome with special debugging enabled.`
        )
      }

      // Find the page with our share URL using puppeteer
      await new Promise(r => setTimeout(r, 2000)) // Let Chrome load
      let puppeteerPages = await puppeteerBrowser.pages()
      const shareId = url.split('/').pop() || ''
      let puppeteerPage: PuppeteerPage | undefined = puppeteerPages.find(p => p.url().includes(shareId)) || puppeteerPages[0]

      if (!puppeteerPage) {
        puppeteerPage = await puppeteerBrowser.newPage()
        await puppeteerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
      }

      if (!opts.quiet) console.error(chalk.blue('[2/8] Waiting for page to load...'))
      await puppeteerPage.waitForNetworkIdle({ timeout: 10000 }).catch(() => {})

      // Check for Cloudflare challenge
      const checkForChallengePuppeteer = async (): Promise<boolean> => {
        const content = await puppeteerPage!.evaluate(() => document.body?.textContent || '').catch(() => '')
        const title = await puppeteerPage!.title().catch(() => '')
        return /verify you are human|just a moment|checking your browser|ray id:/i.test(content) ||
               /just a moment|cloudflare/i.test(title)
      }

      if (await checkForChallengePuppeteer()) {
        console.error(chalk.yellow('\n⚠️  Cloudflare verification detected in Chrome.'))
        console.error(chalk.yellow('    Please complete the verification in Chrome, then press Enter...\n'))

        const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
        await new Promise<void>(resolve => rl.question('', () => { rl.close(); resolve() }))

        // Re-find the page after user interaction
        await new Promise(r => setTimeout(r, 1000))
        puppeteerPages = await puppeteerBrowser.pages()
        puppeteerPage = puppeteerPages.find(p => p.url().includes(shareId)) || puppeteerPages[0]
        if (!puppeteerPage) throw new AppError('Lost connection to page after verification.')
        await puppeteerPage.waitForNetworkIdle({ timeout: 5000 }).catch(() => {})

        // Verify challenge is now cleared
        if (await checkForChallengePuppeteer()) {
          throw new AppError('Cloudflare challenge still present.', 'Please try again.')
        }
      }

      if (!opts.quiet) console.error(chalk.blue('[3/8] Extracting conversation...'))

      // CDP mode: Extract content using puppeteer with provider-specific selectors
      const cdpSelectors = PROVIDER_SELECTOR_CANDIDATES[provider] ?? PROVIDER_SELECTOR_CANDIDATES.chatgpt

      // Wait for content with provider-specific selectors
      let workingSelector: string | null = null
      for (const group of cdpSelectors) {
        const combined = group.join(',')
        try {
          await puppeteerPage.waitForSelector(combined, { timeout: 5000 })
          workingSelector = combined
          if (!opts.quiet) console.error(chalk.gray(`    Found content with: ${combined.slice(0, 50)}...`))
          break
        } catch {
          // Try next selector group
        }
      }

      if (!workingSelector) {
        throw new AppError(
          `Could not find conversation content for ${provider}.`,
          'The page may still be loading or the share link may be invalid.'
        )
      }

      // Extract messages using puppeteer with provider-aware logic
      const messages = await puppeteerPage.evaluate((prov: string) => {
        const results: { role: string; content: string }[] = []

        if (prov === 'chatgpt') {
          // ChatGPT: messages have data-message-author-role attribute
          const msgs = document.querySelectorAll('[data-message-author-role]')
          msgs.forEach(el => {
            let role = el.getAttribute('data-message-author-role') || ''
            // GPT-5.2+ fallback: detect from "You said:" / "ChatGPT said:" text headers
            // Anchor to start to avoid false positives from "I think you said..." in message content
            if (!role || role === 'unknown') {
              const textStart = (el.textContent || '').slice(0, 100).toLowerCase()
              if (/^(?:#{1,6}\s*)?chatgpt\s+said/.test(textStart)) role = 'assistant'
              else if (/^(?:#{1,6}\s*)?you\s+said/.test(textStart)) role = 'user'
              else role = 'unknown'
            }
            results.push({ role, content: el.innerHTML })
          })
        } else if (prov === 'claude') {
          // Claude: query all messages together to preserve DOM order
          const msgs = document.querySelectorAll('[data-testid="user-message"], [data-is-streaming]')
          msgs.forEach(el => {
            const isUser = el.getAttribute('data-testid') === 'user-message'
            results.push({ role: isUser ? 'user' : 'assistant', content: el.innerHTML })
          })
        } else if (prov === 'gemini') {
          // Gemini: query all messages together to preserve DOM order
          const msgs = document.querySelectorAll('user-query, response-container')
          msgs.forEach(el => {
            const isUser = el.tagName.toLowerCase() === 'user-query'
            results.push({ role: isUser ? 'user' : 'assistant', content: el.innerHTML })
          })
        } else if (prov === 'grok') {
          // Grok: similar to ChatGPT with message containers
          const msgs = document.querySelectorAll('[data-testid*="message"], [data-message-author-role]')
          msgs.forEach(el => {
            const role = el.getAttribute('data-message-author-role') ||
                        (el.className.includes('user') ? 'user' : 'assistant')
            results.push({ role, content: el.innerHTML })
          })
        }

        // Generic fallback if no messages found
        if (results.length === 0) {
          const allMsgs = document.querySelectorAll('[class*="message"], article, [role="article"]')
          allMsgs.forEach(el => {
            const text = el.textContent?.trim() || ''
            if (text && text.length > 10) {
              results.push({ role: 'unknown', content: el.innerHTML })
            }
          })
        }

        return results
      }, provider)

      // Get page title
      const pageTitle = await puppeteerPage.title() || `${provider.charAt(0).toUpperCase() + provider.slice(1)} Conversation`

      // Apply alternating role fallback for any remaining unknown messages (ChatGPT GPT-5.2+)
      if (provider === 'chatgpt' || provider === 'grok' || provider === 'gemini') {
        let unknownIdx = 0
        for (const msg of messages) {
          if (msg.role === 'unknown') {
            msg.role = unknownIdx % 2 === 0 ? 'user' : 'assistant'
            unknownIdx++
          }
        }
      }

      // Close puppeteer browser
      await puppeteerBrowser.disconnect()

      // Restore Chrome to normal state if we launched with temp profile
      if (launchedWithTempProfile && process.platform === 'darwin') {
        if (!opts.quiet) console.error(chalk.blue('[7/8] Restoring Chrome to normal...'))

        // Close Chrome (running on temp profile)
        spawnSync('osascript', ['-e', `tell application "${chromeAppName}" to quit`], { encoding: 'utf-8' })

        // Wait for Chrome to fully close
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 500))
          const stillRunning = chromeApps.some(c => {
            const check = spawnSync('pgrep', ['-x', c.process], { encoding: 'utf-8' })
            return check.status === 0
          })
          if (!stillRunning) break
        }

        // Force kill any remaining Chrome processes
        spawnSync('pkill', ['-9', '-f', 'Google Chrome'], { encoding: 'utf-8' })
        await new Promise(r => setTimeout(r, 500))

        // Clean up temp profile directory
        if (tempProfileDir) {
          try {
            fs.rmSync(tempProfileDir, { recursive: true, force: true })
          } catch {
            // Ignore cleanup errors
          }
        }

        // Check if we have tabs to restore
        const tabsFile = path.join(os.tmpdir(), 'csctf-chrome-tabs.json')
        let savedTabsData: { app: string; tabs: string[] } | null = null
        if (fs.existsSync(tabsFile)) {
          try {
            savedTabsData = JSON.parse(fs.readFileSync(tabsFile, 'utf-8'))
          } catch {
            // Ignore parse errors
          }
        }

        if (savedTabsData && savedTabsData.tabs.length > 0) {
          if (!opts.quiet) console.error(chalk.blue('[8/8] Restoring your tabs...'))

          // Relaunch Chrome with default profile and first tab
          spawn(chromePath, [savedTabsData.tabs[0]], {
            detached: true,
            stdio: 'ignore'
          }).unref()

          // Wait for Chrome to start
          await new Promise(r => setTimeout(r, 2000))

          // Open remaining tabs via AppleScript
          if (savedTabsData.tabs.length > 1) {
            const remainingTabs = savedTabsData.tabs.slice(1)
            for (const tabUrl of remainingTabs) {
              // Use AppleScript to open each tab in a new tab (not new window)
              const openTabScript = `
                tell application "${savedTabsData.app}"
                  activate
                  tell front window
                    make new tab with properties {URL:"${tabUrl}"}
                  end tell
                end tell
              `
              spawnSync('osascript', ['-e', openTabScript], { encoding: 'utf-8' })
              await new Promise(r => setTimeout(r, 100)) // Small delay between tabs
            }
          }

          if (!opts.quiet) console.error(chalk.green(`    ✔ Restored ${savedTabsData.tabs.length} tab(s)`))

          // Clean up tabs file
          try {
            fs.unlinkSync(tabsFile)
          } catch {
            // Ignore cleanup errors
          }
        } else {
          // No tabs to restore, just relaunch Chrome normally
          if (!opts.quiet) console.error(chalk.gray('    Chrome closed (no tabs to restore)'))
        }
      } else if (launchedWithTempProfile) {
        // Non-macOS: just close Chrome, can't restore tabs automatically
        if (!opts.quiet) console.error(chalk.blue('[7/8] Closing temporary Chrome session...'))
        spawnSync('pkill', ['-f', 'remote-debugging-port=9222'], { encoding: 'utf-8' })
        await new Promise(r => setTimeout(r, 500))

        // Clean up temp profile
        if (tempProfileDir) {
          try {
            fs.rmSync(tempProfileDir, { recursive: true, force: true })
          } catch {
            // Ignore cleanup errors
          }
        }
        if (!opts.quiet) console.error(chalk.gray('    Temporary session closed'))
      }

      // Convert to markdown using turndown
      // Use same format as Playwright mode for consistency
      const retrievedAt = new Date().toISOString()
      const titleWithoutPrefix = stripProviderPrefix(pageTitle)
      const headingPrefix = provider === 'gemini' ? 'Gemini' : provider === 'grok' ? 'Grok' : provider === 'claude' ? 'Claude' : 'ChatGPT'
      const lines: string[] = [
        `# ${headingPrefix} Conversation: ${titleWithoutPrefix}`,
        '',
        `Source: ${url}`,
        `Retrieved: ${retrievedAt}`,
        ''
      ]

      for (const msg of messages) {
        const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'Message'
        lines.push(`## ${roleLabel}`, '')
        let markdown = td.turndown(msg.content)
        // Strip GPT-5.2 "You said:" / "ChatGPT said:" header artifacts (role is captured in ## heading)
        markdown = markdown.replace(/^#{3,6}\s*(You said|ChatGPT said):?\s*$/gim, '').replace(/\n{3,}/g, '\n\n').trim()
        lines.push(markdown)
        lines.push('')
      }

      return {
        title: pageTitle.replace(/\s*[-|].*$/, '').trim() || `${provider.charAt(0).toUpperCase() + provider.slice(1)} Conversation`,
        markdown: normalizeLineTerminators(lines.join('\n')),
        retrievedAt
      }
    } else {
      // Standard Playwright mode with CDP fallback on any blocking error
      try {
      const useProfile = opts.useChromeProfile ?? false
      const useStealth = opts.stealthMode ?? true // Enable stealth by default now

      const result = await launchBrowser(currentHeadless, useProfile)
    if ('newPage' in result && typeof result.newPage === 'function') {
      // It's a BrowserContext from launchPersistentContext
      context = result as BrowserContext
      browser = null
      page = await context.newPage()
    } else {
      // It's a Browser
      browser = result as Browser
      page = await browser.newPage({
        userAgent,
        viewport: { width: 1366, height: 768 }
      })
    }

    await page.setExtraHTTPHeaders(realHeaders)
    await page.route('**/*', route => {
      const headers = {
        ...route.request().headers(),
        ...realHeaders
      }
      route.continue({ headers })
    })

    if (useStealth) {
      await page.addInitScript(stealthScript)
    } else {
      // Minimal stealth (old behavior)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
        // @ts-expect-error: provide a minimal chrome runtime shim for stealth
        window.chrome = { runtime: {} }
      })
    }
    if (!page) throw new Error('Failed to create browser page.')

    // Stage 1: quick DOM load
    await attemptWithBackoff(
      async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(10000, timeoutMs / 2) })
      },
      timeoutMs,
      'loading the share URL (check that the link is public and reachable)'
    )
    // Stage 2: try to reach network-idle, but don't hang forever
    await page.waitForLoadState('networkidle', { timeout: Math.max(5000, timeoutMs / 4) }).catch(() => {})

    // Handle bot-block/CF challenges with patience instead of immediate fail.
    // Check the page title and very short body text for challenge indicators
    // This avoids false positives from actual conversation content mentioning these words
    const isChallengeTitle = (title: string) =>
      /^(just a moment|checking|verify|attention required|one moment|please wait)/i.test(title) ||
      /cloudflare/i.test(title)
    const isChallengeBody = (bodyText: string) => {
      // Only check short body text (challenge pages have minimal content)
      if (bodyText.length > 2000) return false
      return /verify you are human|enable javascript.*cookies|checking your browser|ray id:/i.test(bodyText)
    }
    let challengeClear = false

    // More patient challenge handling - up to 5 attempts with increasing wait times
    const challengeWaits = [3000, 5000, 8000, 10000, 12000]
    for (let i = 0; i < challengeWaits.length; i += 1) {
      const bodyText = (await page.textContent('body').catch(() => '')) || ''
      const title = (await page.title().catch(() => '')) || ''
      if (!isChallengeTitle(title) && !isChallengeBody(bodyText)) {
        challengeClear = true
        break
      }
      if (opts.debug) {
        console.error(chalk.gray(`Challenge detected (attempt ${i + 1}/${challengeWaits.length}), waiting...`))
      }
      await page.waitForTimeout(challengeWaits[i])
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
    }

    // If still blocked and we were in headless mode, try headful as fallback
    if (!challengeClear && currentHeadless) {
      if (opts.debug) {
        console.error(chalk.yellow('Headless blocked, retrying in headful mode...'))
      }
      // Close current browser/context
      if (context) await context.close().catch(() => {})
      if (browser) await browser.close().catch(() => {})

      // Retry with headful mode
      currentHeadless = false
      const result2 = await launchBrowser(false, useProfile)
      if ('newPage' in result2 && typeof result2.newPage === 'function') {
        context = result2 as BrowserContext
        browser = null
        page = await context.newPage()
      } else {
        browser = result2 as Browser
        page = await browser.newPage({
          userAgent,
          viewport: { width: 1366, height: 768 }
        })
      }

      await page.setExtraHTTPHeaders(realHeaders)
      await page.route('**/*', route => {
        const headers = {
          ...route.request().headers(),
          ...realHeaders
        }
        route.continue({ headers })
      })
      if (useStealth) {
        await page.addInitScript(stealthScript)
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.max(10000, timeoutMs / 2) })
      await page.waitForLoadState('networkidle', { timeout: Math.max(5000, timeoutMs / 4) }).catch(() => {})

      // Check again with longer waits in headful mode
      for (let i = 0; i < 5; i += 1) {
        const bodyText = (await page.textContent('body').catch(() => '')) || ''
        const title = (await page.title().catch(() => '')) || ''
        if (!isChallengeTitle(title) && !isChallengeBody(bodyText)) {
          challengeClear = true
          break
        }
        await page.waitForTimeout(5000)
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
      }
    }

      if (!challengeClear) {
        // On macOS, fall back to CDP mode instead of failing
        if (process.platform === 'darwin' && !useCdp) {
          await triggerCdpFallback('Bot/challenge page detected - automation blocked.')
          continue // Retry with CDP mode
        }
        throw new AppError(
          'The share page appears to be blocking automation (bot/challenge page detected).',
          'Try --use-chrome-profile to use your real browser session, or --headful to watch the browser. You may need to visit the link in Chrome first to pass any captcha.'
        )
      }
      } catch (playwrightSetupErr) {
        // Catch any error during Playwright setup/navigation and try CDP fallback
        const errMsg = playwrightSetupErr instanceof Error ? playwrightSetupErr.message : String(playwrightSetupErr)
        const isBlockingError = /closed|terminated|blocked|bot.?detect|captcha|cloudflare|verify.*human|access denied|timeout|refused/i.test(errMsg)

        if (isBlockingError && process.platform === 'darwin' && !useCdp) {
          // Close context if we were using persistent context (browser might be null in that case)
          if (context) {
            await context.close().catch(() => {})
            context = null
          }
          await triggerCdpFallback('Playwright blocked - ' + (errMsg.length > 60 ? errMsg.slice(0, 60) + '...' : errMsg))
          continue // Retry with CDP mode
        }
        throw playwrightSetupErr // Re-throw if not a blocking error or not on macOS
      }
    } // end of standard launch mode else block

    // Helper to find a working selector
    const findSelector = async (): Promise<string | null> => {
      const candidates = PROVIDER_SELECTOR_CANDIDATES[provider] ?? PROVIDER_SELECTOR_CANDIDATES.chatgpt
      const perTry = Math.max(2000, timeoutMs / 6)
      // Try each candidate group with a short "attached" wait; fall back to DOM counting.
      for (const group of candidates) {
        const combined = group.join(',')
        try {
          await page.waitForSelector(combined, { timeout: perTry, state: 'attached' })
          if (opts.debug) console.error(chalk.gray(`Selector hit (attached): ${combined}`))
          return combined
        } catch {
          if (opts.debug) console.error(chalk.gray(`Selector miss: ${combined}`))
        }
      }
      // If none attached, check DOM counts directly to pick a selector that already exists but may be hidden.
      const counts = await page.evaluate((sets: string[][]) => {
        return sets.map(group => {
          const selector = group.join(',')
          const count = document.querySelectorAll(selector).length
          return { selector, count }
        })
      }, candidates)
      const hit = counts.find(entry => entry.count > 0)
      if (hit) {
        if (opts.debug) console.error(chalk.gray(`Selector found via DOM scan: ${hit.selector} (count ${hit.count})`))
        return hit.selector
      }
      return null
    }

    const selector = opts.waitForSelector ?? (await findSelector())

    if (!selector) {
      // ChatGPT has aggressive headless detection - fall back to CDP on macOS
      if (provider === 'chatgpt' && process.platform === 'darwin' && !useCdp) {
        await triggerCdpFallback('ChatGPT is blocking automated browser access.')
        continue // Retry with CDP mode
      }
      // On non-macOS or if already tried CDP, provide helpful message
      if (currentHeadless && provider === 'chatgpt') {
        throw new AppError(
          'ChatGPT is blocking headless browser access.',
          'Use --headful to run with a visible browser window. ChatGPT now requires a visible browser to display shared conversations.'
        )
      }
      // Note: Claude.ai uses CDP mode and returns early, so it never reaches here
      throw new AppError(
        'No conversation content found for this provider.',
        'Try --wait-for-selector "<css>" to override, or verify the page layout.'
      )
    }

    await attemptWithBackoff(
      async () => {
        await page.waitForSelector(selector, { timeout: Math.max(4000, timeoutMs / 2), state: 'attached' })
      },
      timeoutMs,
      'waiting for conversation content (page layout may have changed or the link may be private)'
    )
    // Additional grace wait for streaming/lazy-loaded UIs
    await page.waitForTimeout(Math.min(3000, Math.max(500, timeoutMs / 6)))

    const title = await page.title()
    const selectorGroups =
      opts.waitForSelector && opts.waitForSelector.trim().length > 0
        ? [[opts.waitForSelector]]
        : PROVIDER_SELECTOR_CANDIDATES[provider] ?? PROVIDER_SELECTOR_CANDIDATES.chatgpt
    let messages = (await page.evaluate((groups: string[][]) => {
      const normalizeCodeBlocks = (root: HTMLElement) => {
        // Ensure <pre> nodes wrap their text in <code> and preserve whitespace.
        root.querySelectorAll('pre').forEach(pre => {
          const text = (pre.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n')
          const existing = pre.querySelector('code')
          if (existing) {
            existing.textContent = text
          } else {
            const code = root.ownerDocument.createElement('code')
            code.textContent = text
            pre.innerHTML = ''
            pre.appendChild(code)
          }
        })

        // Promote blocky <code> to <pre><code> to preserve newlines (common in Grok/Gemini renders).
        root.querySelectorAll('code').forEach(code => {
          const text = (code.textContent ?? '').replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n')
          const looksBlocky =
            text.includes('\n') ||
            text.length > 240 ||
            (code.parentElement && ['DIV', 'SECTION', 'ARTICLE', 'P'].includes(code.parentElement.nodeName))
          if (looksBlocky && code.parentElement?.nodeName !== 'PRE') {
            const pre = root.ownerDocument.createElement('pre')
            const inner = root.ownerDocument.createElement('code')
            inner.textContent = text
            pre.appendChild(inner)
            code.replaceWith(pre)
          } else {
            code.textContent = text
          }
        })
      }

      const cleanHtml = (el: Element): string => {
        const clone = el.cloneNode(true) as HTMLElement
        const garbage = clone.querySelectorAll(
          'button, [data-testid*="citation"], [data-testid*="pill"], [class*="copy"], [role="tooltip"], [aria-label="Copy"], [data-testid*="copy"], [data-testid*="meta"]'
        )
        garbage.forEach(g => g.remove())
        clone.querySelectorAll('script').forEach(s => s.remove())
        clone.querySelectorAll('[data-start],[data-end]').forEach(n => {
          n.removeAttribute('data-start')
          n.removeAttribute('data-end')
        })
        normalizeCodeBlocks(clone)
        return clone.innerHTML
      }

      const collectDeep = (root: ParentNode, selectors: string[], acc: Element[], seen: Set<Element>) => {
        selectors.forEach(sel => {
          root.querySelectorAll(sel).forEach(node => {
            if (!seen.has(node)) {
              seen.add(node)
              acc.push(node)
            }
          })
        })
        root.childNodes.forEach(child => {
          const asEl = child as Element
          const shadow = (asEl as unknown as { shadowRoot?: ShadowRoot }).shadowRoot
          if (shadow) collectDeep(shadow, selectors, acc, seen)
        })
      }

      const selectorsFlat = groups.flat().flatMap(g => g.split(',').map(s => s.trim()).filter(Boolean))
      const nodes: Element[] = []
      collectDeep(document, selectorsFlat, nodes, new Set<Element>())

      return nodes
        .map(node => {
          const el = node as HTMLElement
          const shadow = (node as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot
          const shadowHtml = shadow ? shadow.innerHTML : ''
          const shadowText = shadow ? shadow.textContent ?? '' : ''
          const normalizeNbsp = (val: string) => val.replace(/\u00a0/g, ' ').replace(/&nbsp;/gi, ' ')
          let html = normalizeNbsp((shadowHtml || cleanHtml(el) || '').trim())
          const text = normalizeNbsp((shadowText || el.textContent || '').trim())
          if (!html && !text) return null

          const classLower = (el.getAttribute('class') ?? '').toLowerCase()
          const dataTestId = (el.getAttribute('data-testid') ?? '').toLowerCase()
          // If this looks like a code block container, wrap text as fenced pre.
          if (classLower.includes('code-block') || dataTestId.includes('code-block')) {
            let codeText = (shadowText || el.textContent || '').replace(/\u00a0/g, ' ').trimEnd()
            // Heuristic: Grok code blocks often have lines concatenated with extra spaces; split on 2+ spaces.
            codeText = codeText.replace(/\s{2,}/g, '\n').replace(/\n{3,}/g, '\n\n')
            html = `<pre><code>${codeText}</code></pre>`
          }

          const attrRole =
            el.getAttribute('data-message-author-role') ??
            el.getAttribute('data-author') ??
            el.getAttribute('data-role') ??
            ''
          const testId = (el.getAttribute('data-testid') ?? '').toLowerCase()
          const className = (el.getAttribute('class') ?? '').toLowerCase()
          // Claude.ai uses data-is-streaming for assistant messages
          const isStreaming = el.hasAttribute('data-is-streaming') || el.closest('[data-is-streaming]') !== null
          const inferRole = (): string => {
            // Claude.ai: data-is-streaming indicates assistant response
            if (isStreaming) return 'assistant'
            const source = `${attrRole} ${testId} ${className}`
            if (/assistant|bot|system|model|gemini|grok/.test(source)) return 'assistant'
            if (/user|human|you/.test(source)) return 'user'
            // GPT-5.2+ uses "You said:" / "ChatGPT said:" headers without role attributes
            // Anchor to start to avoid false positives from "I think you said..." in message content
            const textStart = text.slice(0, 100).toLowerCase()
            if (/^(?:#{1,6}\s*)?chatgpt\s+said/.test(textStart)) return 'assistant'
            if (/^(?:#{1,6}\s*)?you\s+said/.test(textStart)) return 'user'
            return 'unknown'
          }
          const detected = (attrRole || inferRole()).toLowerCase()
          const role: MessageRole =
            detected === 'assistant'
              ? 'assistant'
              : detected === 'user'
              ? 'user'
              : detected === 'system'
              ? 'system'
              : detected === 'tool'
              ? 'tool'
              : 'unknown'
          const safeHtml = html || text.replace(/\n/g, '<br>')
          return { role, html: safeHtml }
        })
        .filter((m): m is { role: MessageRole; html: string } => Boolean(m))
    }, selectorGroups)) as ScrapedMessage[]

    // Note: Claude uses CDP mode and returns early, so it's never in this code path
    // GPT-5.2+ may have some messages without role attributes; apply alternating fallback
    if (provider === 'grok' || provider === 'gemini' || provider === 'chatgpt') {
      let unknownIdx = 0
      messages = messages.map(m => {
        if (m.role !== 'unknown') return m
        const role: MessageRole = unknownIdx % 2 === 0 ? 'user' : 'assistant'
        unknownIdx += 1
        return { ...m, role }
      })
    }

    if (!messages.length) {
      const dumpPath = await dumpDebug()
      const hint =
        dumpPath
          ? `Debug HTML saved to ${dumpPath}.`
          : 'Is the link public? Try opening it in a browser first.'
      throw new AppError('No messages were found in the shared conversation.', hint)
    }

    const lines: string[] = []
    const titleWithoutPrefix = stripProviderPrefix(title)
    const headingPrefix = provider === 'gemini' ? 'Gemini' : provider === 'grok' ? 'Grok' : provider === 'claude' ? 'Claude' : 'ChatGPT'
    lines.push(`# ${headingPrefix} Conversation: ${titleWithoutPrefix}`)
    lines.push('')
    const retrievedAt = new Date().toISOString()
    lines.push(`Source: ${url}`)
    lines.push(`Retrieved: ${retrievedAt}`)
    lines.push('')

    for (const msg of messages) {
      const prettyRole =
        msg.role === 'assistant'
          ? 'Assistant'
          : msg.role === 'user'
          ? 'User'
          : msg.role === 'system'
          ? 'System'
          : msg.role === 'tool'
          ? 'Tool'
          : 'Other'
      lines.push(`## ${prettyRole}`)
      lines.push('')
      const normalizeNbsp = (val: string) => val.replace(/\u00a0/g, ' ').replace(/&nbsp;/gi, ' ')
      const htmlForTd = normalizeNbsp(msg.html).replace(/<(?:br\s*\/?|\/p|\/div|\/section|\/article)>/gi, '$&\n')
      let markdown = td.turndown(htmlForTd)
      markdown = markdown
        .split('\n')
        .filter(line => line.trim() !== 'text')
        .join('\n')
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()
      // Strip GPT-5.2 "You said:" / "ChatGPT said:" header artifacts (role is captured in ## heading)
      markdown = markdown.replace(/^#{3,6}\s*(You said|ChatGPT said):?\s*$/gim, '').replace(/\n{3,}/g, '\n\n').trim()
      lines.push(markdown)
      lines.push('')
    }

    return { title, markdown: normalizeLineTerminators(lines.join('\n')), retrievedAt }
    } // end for loop (CDP fallback retry)

    // Should never reach here - for loop always returns or throws
    throw new AppError('Unexpected state: scraping loop exited without result')
  } catch (err) {
    const dumpPath = await dumpDebug()
    if (dumpPath) {
      console.error(chalk.gray(`Debug page saved to ${dumpPath}`))
    }
    throw err
  } finally {
    if (browser) {
      await browser.close()
    }
    if (context) {
      await context.close().catch(() => {})
    }

    // Restore saved Chrome tabs if we had to close Chrome for CDP mode
    if (process.platform === 'darwin') {
      const tabsFile = path.join(os.tmpdir(), 'csctf-chrome-tabs.json')
      if (fs.existsSync(tabsFile)) {
        try {
          const saved = JSON.parse(fs.readFileSync(tabsFile, 'utf-8'))
          // Handle both old format (array) and new format ({ app, tabs })
          const savedTabs: string[] = Array.isArray(saved) ? saved : (saved.tabs || [])
          const chromeApp = saved.app || 'Google Chrome'
          const chromePaths: Record<string, string> = {
            'Google Chrome Canary': '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
            'Google Chrome': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
          }
          const chromePath = chromePaths[chromeApp] || chromePaths['Google Chrome']

          if (savedTabs.length > 0) {
            if (!opts.quiet) console.error(chalk.blue('\n[8/8] Restoring your Chrome tabs...'))
            // Reopen Chrome with saved tabs
            const tabArgs = savedTabs.slice(0, 20) // Limit to 20 tabs to avoid issues
            spawn(chromePath, tabArgs, {
              detached: true,
              stdio: 'ignore'
            }).unref()
            if (!opts.quiet) console.error(chalk.gray(`    Restored ${Math.min(savedTabs.length, 20)} tab(s)`))
            if (!opts.quiet && savedTabs.length > 20) {
              console.error(chalk.gray(`    (${savedTabs.length - 20} additional tabs not restored to avoid overload)`))
            }
          }
          fs.unlinkSync(tabsFile) // Clean up
        } catch {
          // Ignore restoration errors
        }
      }
    }
  }
}

async function main(): Promise<void> {
  let opts: ParsedArgs
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`✖ ${message}`))
    usage()
    process.exit(1)
  }
  const {
    url,
    timeoutMs,
    outfile,
    outputDir,
    quiet,
    verbose,
    format,
    headless,
    openAfter,
    copy,
    json,
    titleOverride,
    debug,
    waitForSelector,
    checkUpdates,
    skipUpdates,
    versionOnly,
    generateHtml,
    htmlOnly,
    mdOnly,
    rememberGh,
    forgetGh,
    dryRun,
    yes,
    autoInstallGh,
    publishGhPages,
    ghPagesRepo,
    ghPagesBranch,
    ghPagesDir,
    useChromeProfile,
    stealthMode,
    cdpEndpoint
  } = opts

  const step = STEP(quiet, verbose)
  const fail = FAIL(quiet)
  const done = DONE(quiet)

  if (versionOnly) {
    console.log(`csctf v${pkg.version}`)
    return
  }

  if (!url || ['-h', '--help'].includes(url)) {
    usage()
    process.exit(url ? 0 : 1)
  }
  if (!/^https?:\/\//i.test(url)) {
    fail('Please pass a valid http(s) URL (public ChatGPT, Gemini, Grok, or Claude share link).')
    usage()
    process.exit(1)
  }
  const sharePattern =
    /^https?:\/\/(chatgpt\.com|share\.chatgpt\.com|chat\.openai\.com|gemini\.google\.com|grok\.com|grok\.x\.ai|claude\.ai)\/share\//i
  if (!sharePattern.test(url)) {
    fail(
      'The URL should be a public ChatGPT, Gemini, Grok, or Claude share link (e.g., https://chatgpt.com/share/<id>, https://gemini.google.com/share/<id>, https://grok.com/share/<id>, or https://claude.ai/share/<id>).'
    )
    process.exit(1)
  }
  const provider = detectProvider(url)
  const effectiveHeadless = headless !== false

  if (forgetGh) {
    forgetGhConfig()
  }
  const config = forgetGh ? {} : loadConfig()
  // Resolve desired formats (format flag takes precedence over html/md-only flags)
  const produceMd = format !== 'html' && !htmlOnly
  const produceHtml = format !== 'md' && generateHtml && !mdOnly
  if (!produceMd && !produceHtml) {
    fail('At least one output format is required (Markdown and/or HTML).')
    process.exit(1)
  }
  if (!quiet && htmlOnly) {
    console.error(chalk.yellow('Note: --html-only will skip Markdown output.'))
  }
  if (!quiet && mdOnly) {
    console.error(chalk.yellow('Note: --md-only will skip HTML output.'))
  }

  const ghRepoResolved = ghPagesRepo ?? config.gh?.repo ?? DEFAULT_GH_REPO
  const ghBranchResolved = ghPagesBranch || config.gh?.branch || 'gh-pages'
  const ghDirResolved = (ghPagesDir ?? config.gh?.dir ?? 'csctf').trim() || 'csctf'
  const hasStoredGh = Boolean(config.gh)
  const hasExplicitRepo = Boolean(ghPagesRepo)
  const shouldPublish = publishGhPages || hasExplicitRepo || hasStoredGh
  const shouldRemember = rememberGh || (!config.gh && shouldPublish)

  try {
    const overallStart = Date.now()
    const totalSteps =
      4 + // launch, open, convert, final "all done"
      (produceMd ? 1 : 0) +
      (produceHtml ? 1 : 0) +
      (quiet ? 0 : 1) + // location print
      (shouldPublish ? 1 : 0) +
      (checkUpdates && !skipUpdates ? 1 : 0)
    let idx = 1

    const endLaunch = step(idx++, totalSteps, effectiveHeadless ? 'Launching headless Chromium' : 'Launching Chromium (headful)')
    const endOpen = step(idx++, totalSteps, 'Opening share link')
    const { title, markdown, retrievedAt } = await scrape(url, timeoutMs, provider, {
      waitForSelector,
      debug,
      headless: effectiveHeadless,
      useChromeProfile,
      stealthMode,
      cdpEndpoint,
      quiet
    })
    endLaunch()
    endOpen()

    const endConvert = step(idx++, totalSteps, 'Converting to Markdown')
    const datePrefix = new Date().toISOString().slice(0, 10)
    const baseTitle = titleOverride || title
    const name = `${datePrefix}-${provider}-${slugify(stripProviderPrefix(baseTitle))}`
    const resolvedOutfile = outputDir
      ? path.resolve(outputDir)
      : outfile
      ? path.resolve(outfile)
      : path.join(process.cwd(), `${name}.md`)
    const outfileStat = fs.existsSync(resolvedOutfile) ? fs.statSync(resolvedOutfile) : null
    const isDirLike =
      (outputDir ?? outfile)?.endsWith(path.sep) ||
      (outfileStat && outfileStat.isDirectory()) ||
      (outputDir ? !outfileStat : false)

    const baseDir = isDirLike ? resolvedOutfile : path.dirname(resolvedOutfile)
    const baseName = isDirLike
      ? name
      : path.basename(resolvedOutfile, path.extname(resolvedOutfile)) || name

    const outfileStem = path.join(baseDir, baseName)
    const mdOutfile = `${outfileStem}.md`
    const htmlOutfile = `${outfileStem}.html`

    const writtenFiles: { path: string; kind: 'md' | 'html' }[] = []
    if (produceMd) {
      const targetMd = fs.existsSync(mdOutfile) ? uniquePath(mdOutfile) : mdOutfile
      const endMd = step(idx++, totalSteps, 'Writing Markdown')
      writeAtomic(targetMd, markdown)
      writtenFiles.push({ path: targetMd, kind: 'md' })
      endMd()
    }

    if (produceHtml) {
      const htmlTarget = fs.existsSync(htmlOutfile) ? uniquePath(htmlOutfile) : htmlOutfile
      const endHtml = step(idx++, totalSteps, 'Rendering HTML')
      const html = renderHtmlDocument(markdown, title, url, retrievedAt)
      writeAtomic(htmlTarget, html)
      writtenFiles.push({ path: htmlTarget, kind: 'html' })
      endHtml()
    }
    endConvert()

    const savedNames = writtenFiles.map(f => path.basename(f.path)).join(', ')
    done(`Saved ${savedNames}`)
    if (!quiet) {
      const endLocation = step(idx++, totalSteps, 'Location')
      writtenFiles.forEach(f => {
        console.error(`   ${chalk.green(f.path)}`)
      })
      const mdPath = writtenFiles.find(f => f.kind === 'md')
      const htmlPath = writtenFiles.find(f => f.kind === 'html')
      if (mdPath || htmlPath) {
        console.error(chalk.gray(`   Hint: ${VIEWER_CMD} <path> to view the export locally.`))
      }
      endLocation()
    }

    // Post-write UX: copy/open/json
    if (copy) {
      const copied = copyToClipboard(markdown, quiet)
      if (!copied && !quiet) console.error(chalk.yellow(CLIP_HELP))
    }
    if (openAfter) {
      const target = writtenFiles.find(f => f.kind === 'html') ?? writtenFiles.find(f => f.kind === 'md')
      if (target) {
        const opened = openFile(target.path, quiet)
        if (!opened && !quiet) console.error(chalk.yellow(`Could not open ${target.path}; use ${VIEWER_CMD} <path> manually.`))
      }
    }
    if (json) {
      const payload = {
        title: titleOverride || title,
        provider,
        source: url,
        retrievedAt,
        outputs: writtenFiles.map(f => ({ kind: f.kind, path: f.path }))
      }
      console.log(JSON.stringify(payload, null, 2))
    }

    if (shouldPublish) {
      const publishSummary = [
        chalk.yellow('You are about to publish to GitHub Pages (public):'),
        chalk.yellow(`Repo: ${ghRepoResolved}  Branch: ${ghBranchResolved}  Dir: ${ghDirResolved}`),
        chalk.yellow('Files:'),
        ...writtenFiles.map(f => chalk.yellow(` - ${f.path}`)),
        chalk.yellow('Type PROCEED to continue, or CTRL+C to abort.')
      ].join('\n')
      await confirmPublish(publishSummary, yes)
      if (!dryRun) ensureGhAvailable(autoInstallGh)
      const endPublish = step(idx++, totalSteps, 'Publishing to GitHub Pages')
      const updatedConfig = await publishToGhPages({
        files: writtenFiles,
        repo: ghRepoResolved,
        branch: ghBranchResolved,
        dir: ghDirResolved,
        quiet,
        verbose,
        dryRun,
        remember: shouldRemember && !dryRun,
        config,
        entry: { title: stripProviderPrefix(title), addedAt: retrievedAt }
      })
      if (shouldRemember && !dryRun) {
        saveConfig(updatedConfig)
      }
      endPublish()
    }

    if (checkUpdates && !skipUpdates) {
      const endUpdates = step(idx++, totalSteps, 'Checking for updates')
      await checkForUpdates(pkg.version, quiet)
      endUpdates()
    }

    step(idx++, totalSteps, 'All done. Enjoy!')()
    done('Finished', Date.now() - overallStart)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const hint =
      err instanceof AppError && err.hint
        ? err.hint
        : 'Check that the share link is public and reachable; try --timeout-ms 90000 if the page is slow.'
    fail(`${message}${hint ? ` (${hint})` : ''}`)
    process.exit(1)
  }
}

if (import.meta.main) {
  void main()
}

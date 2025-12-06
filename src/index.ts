#!/usr/bin/env bun
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-chromium'
import TurndownService, { type Rule } from 'turndown'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import MarkdownIt from 'markdown-it'
import type { Options as MdOptions } from 'markdown-it'
import hljs from 'highlight.js'
import { spawnSync } from 'child_process'
import os from 'os'
import readline from 'readline'
import pkg from '../package.json' assert { type: 'json' }

type Provider = 'chatgpt' | 'claude' | 'gemini' | 'grok'
const PROVIDER_PATTERNS: { id: Provider; patterns: RegExp[] }[] = [
  { id: 'claude', patterns: [/claude\.ai$/i] },
  { id: 'gemini', patterns: [/gemini\.google\.com$/i] },
  { id: 'grok', patterns: [/grok\.com$/i, /grok\.x\.ai$/i] },
  { id: 'chatgpt', patterns: [/chatgpt\.com$/i, /openai\.com$/i, /share\.chatgpt\.com$/i] }
]
const PROVIDER_SELECTOR_CANDIDATES: Record<Provider, string[][]> = {
  chatgpt: [
    ['article [data-message-author-role]'],
    ['[data-message-author-role]'],
    ['main article'],
    ['article']
  ],
  claude: [
    ['main [data-testid="message"]', 'main [data-testid="message-row"]', '[data-testid="chat-message"]'],
    ['article [data-message-author-role]'],
    ['[data-message-author-role]'],
    ['main article']
  ],
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

type ClaudeSnapshotMessage = {
  sender: 'human' | 'assistant' | string
  content: {
    type: 'text'
    text: string
  }[]
}

type ClaudeSnapshot = {
  snapshot_name?: string
  chat_messages?: ClaudeSnapshotMessage[]
}

async function renderFromClaudeSnapshot(
  snapshot: ClaudeSnapshot,
  td: TurndownService
): Promise<{ title: string; markdown: string; retrievedAt: string } | null> {
  const messages = snapshot.chat_messages ?? []
  if (!messages.length) return null
  const title = snapshot.snapshot_name?.trim() || 'Claude Snapshot'
  const retrievedAt = new Date().toISOString()
  const lines: string[] = []
  lines.push(`# Claude Conversation: ${title}`)
  lines.push('')
  lines.push(`Retrieved: ${retrievedAt}`)
  lines.push('')
  for (const msg of messages) {
    const role = msg.sender === 'assistant' ? 'Assistant' : 'User'
    const text = (msg.content ?? []).map(part => part.text ?? '').join('\n').trim()
    if (!text) continue
    lines.push(`## ${role}`)
    lines.push('')
    lines.push(td.turndown(text))
    lines.push('')
  }
  return { title, markdown: normalizeLineTerminators(lines.join('\n')), retrievedAt }
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
  claudeCookieFile?: string
  claudeCookiePrompt: boolean
  claudeBrowserAssist: boolean
  claudeAttachWs?: string
  ghPagesRepo?: string
  ghPagesBranch: string
  ghPagesDir: string
  autoInstallGh: boolean
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
  color-scheme: light;
}
* { box-sizing: border-box; }
body {
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px) clamp(16px, 4vw, 32px) clamp(32px, 6vw, 56px);
  max-width: 980px;
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  line-height: 1.65;
  color: #0f172a;
  background: radial-gradient(circle at 20% 20%, #f8fafc 0, #f1f5f9 25%, #e2e8f0 60%, #f8fafc 100%);
}
h1, h2, h3, h4, h5, h6 {
  color: #0f172a;
  line-height: 1.25;
  margin: 1.4em 0 0.5em;
  letter-spacing: -0.02em;
}
h1 {
  font-size: clamp(2rem, 2.5vw, 2.6rem);
  border-left: 5px solid #6366f1;
  padding-left: 12px;
}
h2 {
  font-size: clamp(1.35rem, 1.8vw, 1.75rem);
  border-left: 4px solid #8b5cf6;
  padding-left: 10px;
}
p { margin: 0 0 1.1em; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre {
  font-family: "JetBrains Mono", "Fira Code", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-feature-settings: "calt" 1, "liga" 1;
}
code {
  background: #e2e8f0;
  color: #0f172a;
  padding: 0.15em 0.35em;
  border-radius: 6px;
  font-size: 0.95em;
}
.code-block {
  position: relative;
  margin: 1.25em 0;
}
.code-lang {
  position: absolute;
  top: 8px;
  right: 12px;
  padding: 4px 10px;
  font-size: 0.75rem;
  color: #cbd5e1;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid #1f2937;
  border-radius: 999px;
}
pre {
  background: #0b1221;
  color: #e2e8f0;
  padding: 18px 16px;
  overflow: auto;
  border-radius: 12px;
  border: 1px solid #1f2937;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03), 0 10px 30px rgba(15, 23, 42, 0.25);
}
pre code { background: none; padding: 0; color: inherit; }
blockquote {
  margin: 1.2em 0;
  padding: 0.75em 1.1em;
  border-left: 5px solid #cbd5e1;
  background: linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%);
  color: #0f172a;
  border-radius: 8px;
}
table { border-collapse: collapse; margin: 1.2em 0; width: 100%; }
th, td { padding: 10px 12px; border: 1px solid #e2e8f0; }
th { background: #f8fafc; text-align: left; }
ul, ol { padding-left: 1.4em; }
hr { border: 0; border-top: 1px solid #e2e8f0; margin: 2em 0; }
.article {
  background: rgba(255,255,255,0.9);
  backdrop-filter: blur(6px);
  padding: clamp(22px, 3vw, 32px);
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow: 0 18px 40px rgba(15, 23, 42, 0.12);
}
.meta {
  display: inline-flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  color: #475569;
  font-size: 0.95em;
  margin: 0.5em 0 1.4em;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  background: #e2e8f0;
  color: #0f172a;
  border: 1px solid #cbd5e1;
}
.toc {
  margin: 1.5em 0 2em;
  padding: 14px 16px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.toc h3 {
  margin: 0 0 0.5em;
  font-size: 1rem;
  color: #0f172a;
}
.toc ul {
  margin: 0;
  padding-left: 1.2em;
}
.hljs { color: #e2e8f0; }
.hljs-keyword,
.hljs-selector-tag,
.hljs-literal,
.hljs-section,
.hljs-link { color: #7aa2f7; }
.hljs-function .hljs-title,
.hljs-title.class_,
.hljs-title.function_ { color: #9ece6a; }
.hljs-attr,
.hljs-name,
.hljs-tag { color: #7dcfff; }
.hljs-string,
.hljs-meta .hljs-string { color: #e0af68; }
.hljs-number,
.hljs-regexp,
.hljs-variable { color: #f7768e; }
.hljs-built_in,
.hljs-builtin-name { color: #bb9af7; }
.hljs-comment,
.hljs-quote { color: #94a3b8; }
.hljs-addition { color: #2ec27e; }
.hljs-deletion { color: #ff6b6b; }
@media (prefers-color-scheme: dark) {
  body {
    color: #e2e8f0;
    background: radial-gradient(circle at 20% 20%, #0f172a 0, #0b1221 45%, #0f172a 100%);
  }
  .article {
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.28);
  }
  h1, h2, h3, h4, h5, h6 { color: #e2e8f0; }
  a { color: #93c5fd; }
  code { background: #1f2937; color: #e2e8f0; }
  blockquote {
    border-left-color: #475569;
    background: linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(51, 65, 85, 0.8));
    color: #e2e8f0;
  }
  th { background: #111827; border-color: #1f2937; }
  td { border-color: #1f2937; }
  hr { border-top-color: #1f2937; }
  .pill {
    background: #1f2937;
    color: #e2e8f0;
    border-color: #334155;
  }
  .toc {
    background: #111827;
    border-color: #1f2937;
  }
}
@media print {
  body { background: white; color: black; box-shadow: none; }
  .article { box-shadow: none; border: 1px solid #e5e7eb; }
  pre { page-break-inside: avoid; }
  h2, h3 { page-break-after: avoid; }
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

const stripProviderPrefix = (title: string): string =>
  title.replace(/^(ChatGPT|Claude|Gemini|Grok)\s*-?\s*/i, '')

export function renderHtmlDocument(markdown: string, title: string, source: string, retrieved: string): string {
  const counts = new Map<string, number>()
  const headings: { level: number; text: string; id: string }[] = []

  const md = new MarkdownIt({ html: true, linkify: true, breaks: true })
  md.set({
    highlight(code: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        const { value } = hljs.highlight(code, { language: lang, ignoreIllegals: true })
        return `<div class="code-block"><div class="code-lang">${lang}</div><pre><code class="hljs language-${lang}">${value}</code></pre></div>`
      }
      const auto = hljs.highlightAuto(code)
      const detected = auto.language || 'text'
      const value = auto.value || md.utils.escapeHtml(code)
      const badge = detected ? `<div class="code-lang">${detected}</div>` : ''
      const langClass = detected ? ` language-${detected}` : ''
      return `<div class="code-block">${badge}<pre><code class="hljs${langClass}">${value}</code></pre></div>`
    }
  })

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

  const body = md.render(markdown)
  const safeTitle = escapeHtml(stripProviderPrefix(title))
  const safeSource = escapeHtml(source)
  const safeRetrieved = escapeHtml(retrieved)

  const tocHeadings = headings.filter(h => h.level >= 2 && h.level <= 4)
  const toc =
    tocHeadings.length > 0
      ? `<div class="toc">
    <h3>Contents</h3>
    <ul>
      ${tocHeadings
        .map(h => `<li style="margin-left:${(h.level - 2) * 12}px"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
        .join('\n')}
    </ul>
  </div>`
      : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>${INLINE_STYLE}</style>
</head>
<body>
  <article class="article">
    <div class="meta">
      <span class="pill">📄 ${safeTitle}</span>
      <span class="pill">🔗 <a href="${safeSource}" rel="noreferrer noopener">${safeSource}</a></span>
      <span class="pill">⏰ ${safeRetrieved}</span>
    </div>
    <h1>${safeTitle}</h1>
    ${toc}
    ${body}
  </article>
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
  let claudeCookieFile: string | undefined
  let claudeCookiePrompt = false
  let claudeBrowserAssist = false
  let claudeAttachWs: string | undefined
  let ghPagesRepo: string | undefined
  let ghPagesBranch = 'gh-pages'
  let ghPagesDir = 'csctf'
  let autoInstallGh = false

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
        outfile = args[i + 1]
        i += 1
        break
      case '--output-dir':
        outputDir = args[i + 1]
        i += 1
        break
      case '--headful':
        headless = false
        break
      case '--headless':
        headless = true
        break
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
      case '--claude-cookie-file':
        claudeCookieFile = args[i + 1]
        i += 1
        break
      case '--claude-cookie-prompt':
        claudeCookiePrompt = true
        break
      case '--claude-browser-assist':
        claudeBrowserAssist = true
        break
      case '--claude-attach-ws':
        claudeAttachWs = args[i + 1]
        i += 1
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
    claudeCookieFile,
    claudeCookiePrompt,
    claudeBrowserAssist,
    claudeAttachWs,
    ghPagesRepo,
    ghPagesBranch,
    ghPagesDir,
    autoInstallGh
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
  console.log(`${chalk.gray(`[${n}/${total}]`)} ${chalk.cyan(msg)}`)
  let spinner: ReturnType<typeof setInterval> | undefined
  if (verbose) {
    let dots = 0
    spinner = setInterval(() => {
      dots = (dots + 1) % 4
      const tail = '.'.repeat(dots)
      process.stdout.write(`\r${chalk.gray('   working' + tail.padEnd(3, ' '))}`)
    }, 400)
  }
  return () => {
    if (spinner) {
      clearInterval(spinner)
      process.stdout.write('\r')
    }
    const elapsed = Date.now() - start
    console.log(`   ${chalk.gray(`↳ ${formatDuration(elapsed)}`)}`)
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
  console.log(`${chalk.green('✔')} ${msg}${suffix}`)
}

function usage(): void {
  console.log(
    [
      `Usage: csctf <chatgpt|claude|gemini|grok-share-url>`,
      `  [--timeout-ms 60000] [--outfile path|--output-dir dir] [--quiet] [--verbose] [--format both|md|html]`,
      `  [--headful|--headless]`,
      `  [--open] [--copy] [--json] [--title "Custom Title"] [--wait-for-selector "<css>"] [--debug]`,
      `  [--claude-browser-assist] [--claude-attach-ws wsUrl] [--claude-cookie-file path] [--claude-cookie-prompt]`,
      `  [--check-updates|--no-check-updates] [--version] [--no-html] [--html-only] [--md-only]`,
      `  [--gh-pages-repo owner/name] [--gh-pages-branch gh-pages] [--gh-pages-dir dir]`,
      `  [--remember] [--forget-gh-pages] [--dry-run] [--yes] [--help] [--gh-install]`,
      '',
      'Common recipes:',
      `  Basic scrape (ChatGPT):   csctf https://chatgpt.com/share/<id>`,
      `  Basic scrape (Claude):    csctf https://claude.ai/share/<id>`,
      `  Basic scrape (Gemini):    csctf https://gemini.google.com/share/<id>`,
      `  Basic scrape (Grok):      csctf https://grok.com/share/<id>`,
      `  HTML only:                csctf <url> --html-only`,
      `  Markdown only:            csctf <url> --md-only`,
      `  Longer timeout:           csctf <url> --timeout-ms 90000`,
      `  Publish (public):         GITHUB_TOKEN=... csctf <url> --gh-pages-repo owner/name --yes`,
      `  Remember GH settings:     csctf <url> --gh-pages-repo owner/name --remember --yes`,
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

  // Preserve paragraph structure for blocky containers that ChatGPT/Claude/Gemini use.
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
      const codeText = (codeNode?.textContent ?? '').replace(/\u00a0/g, ' ').trimEnd()
      const maxTicks = (codeText.match(/`+/g) || []).reduce((a, b) => Math.max(a, b.length), 0)
      const fence = '`'.repeat(Math.max(3, maxTicks + 1))
      return `\n\n${fence}${lang}\n${codeText}\n${fence}\n\n`
    }
  }

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
          console.log(msg)
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
      if (!quiet) console.log(chalk.gray('Skipped update check (GitHub unavailable).'))
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
        console.log(msg)
      }
      try {
        fs.mkdirSync(CONFIG_DIR, { recursive: true })
        fs.writeFileSync(UPDATE_CACHE_PATH, JSON.stringify({ tag: data.tag_name, checkedAt: new Date().toISOString() }))
      } catch {
        // ignore cache write errors
      }
    }
  } catch {
    if (!quiet) console.log(chalk.gray('Skipped update check (offline or GitHub unavailable).'))
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
  console.log(chalk.yellow(summary))
  console.log(chalk.yellow('Type PROCEED to publish to GitHub Pages (public): '))
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
      const mdLink = item.md ? `<a href="./${encodeURIComponent(item.md)}">Markdown</a>` : ''
      const htmlLink = item.html ? `<a href="./${encodeURIComponent(item.html)}">HTML</a>` : ''
      const links = [htmlLink, mdLink].filter(Boolean).join(' • ')
      return `<div class="card">
  <div class="card-title">${escapeHtml(item.title)}</div>
  <div class="card-meta">Added: ${escapeHtml(item.addedAt)}</div>
  <div class="card-links">${links}</div>
</div>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #0f172a; margin: 0; padding: 32px; color: #e2e8f0; }
    h1 { margin: 0 0 18px; font-size: 1.8rem; }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .card { background: rgba(15,23,42,0.75); border: 1px solid #1f2937; border-radius: 12px; padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
    .card-title { font-weight: 600; margin-bottom: 6px; }
    .card-meta { font-size: 0.9rem; color: #cbd5e1; margin-bottom: 8px; }
    .card-links a { color: #93c5fd; text-decoration: none; font-weight: 600; }
    .card-links a:hover { text-decoration: underline; }
    @media (prefers-color-scheme: light) {
      body { background: #f8fafc; color: #0f172a; }
      .card { background: #ffffff; border: 1px solid #e2e8f0; box-shadow: 0 10px 20px rgba(0,0,0,0.08); }
      .card-meta { color: #475569; }
      .card-links a { color: #2563eb; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="grid">
    ${cards}
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
    if (!quiet) console.log(chalk.gray(`   ${msg}`))
  }

  const gitWithRetry = (args: string[], label: string, attempts = 3, delayMs = 500): number => {
    let lastStatus = 1
    for (let i = 0; i < attempts; i += 1) {
      const res = spawnSync('git', args, { cwd: tmp!, stdio: quiet ? 'ignore' : 'inherit', env: gitEnv })
      lastStatus = res.status ?? 1
      if (lastStatus === 0) return 0
      if (!quiet) console.log(chalk.gray(`   retrying ${label} (${i + 1}/${attempts})...`))
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
    if (!quiet) console.log(chalk.gray('Dry run: skipping git commit/push'))
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
    claudeCookieFile?: string
    claudeCookiePrompt?: boolean
    claudeBrowserAssist?: boolean
    claudeAttachWs?: string
  }
): Promise<{ title: string; markdown: string; retrievedAt: string }> {
  const td = buildTurndown()
  let browser: Browser | null = null
  let cdpBrowser: Browser | null = null
  let context: BrowserContext | null = null
  let page!: Page
  const resolveClaudeCookie = async (): Promise<string | undefined> => {
    const envCookie = process.env.CSCTF_CLAUDE_COOKIE?.trim()
    if (envCookie) return envCookie
    if (opts.claudeCookieFile) {
      try {
        const fileCookie = fs.readFileSync(opts.claudeCookieFile, 'utf8').trim()
        if (fileCookie) return fileCookie
      } catch {
        /* ignore */
      }
    }
    if (opts.claudeCookiePrompt) {
      if (!process.stdin.isTTY) return undefined
      return await new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
        rl.question('Claude cookie (e.g., cf_clearance=...; __cf_bm=...): ', answer => {
          rl.close()
          resolve(answer.trim() || undefined)
        })
      })
    }
    return undefined
  }
  const claudeCookie = provider === 'claude' ? await resolveClaudeCookie() : undefined
  const maybeFetchClaudeSnapshotViaCDP = async (page: Page, shareUrl: string): Promise<ClaudeSnapshot | null> => {
    try {
      const id = shareUrl.replace(/^https?:\/\/claude\.ai\/share\//i, '')
      const res = await page.evaluate(
        async snapId => {
          const resp = await fetch(
            `https://claude.ai/api/chat_snapshots/${snapId}?rendering_mode=messages&render_all_tools=true`,
            { credentials: 'include' }
          )
          const text = await resp.text()
          return { ok: resp.ok, status: resp.status, text }
        },
        id
      )
      if (!res.ok) return null
      return JSON.parse(res.text) as ClaudeSnapshot
    } catch {
      return null
    }
  }

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

  try {
    const executablePath = resolveChromiumExecutable()
    if (provider === 'claude' && opts.claudeBrowserAssist) {
      // Attach to an existing remote-debug Chrome if provided; otherwise launch a temp profile headful Chrome with RD port.
      const existingWs = opts.claudeAttachWs ?? process.env.CSCTF_CLAUDE_WS_URL
      if (existingWs) {
        const wsEndpoint = existingWs.startsWith('http') ? existingWs.replace(/^http/, 'ws') : existingWs
        cdpBrowser = await chromium.connectOverCDP(wsEndpoint, { timeout: Math.max(30000, timeoutMs) })
        context = cdpBrowser.contexts()[0] ?? (await cdpBrowser.newContext())
        const pages = context.pages()
        page = pages[0] ?? (await context.newPage())
      } else {
        const executablePath = resolveChromiumExecutable()
        const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csctf-chrome-'))
        context = await chromium.launchPersistentContext(userDataDir, {
          headless: false,
          executablePath,
          viewport: { width: 1366, height: 768 },
          locale: 'en-US'
        })
        page = context.pages()[0] ?? (await context.newPage())
      }
      const claudeSnapshot = await maybeFetchClaudeSnapshotViaCDP(page, url)
      if (claudeSnapshot) {
        const rendered = await renderFromClaudeSnapshot(claudeSnapshot, td)
        if (rendered) return rendered
      }
      if (claudeCookie) {
        await page.setExtraHTTPHeaders({ cookie: claudeCookie })
      }
    } else if (provider === 'claude') {
      // Use a persistent, headful, real Chrome profile to mimic a normal user as closely as possible.
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csctf-chrome-'))
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        executablePath,
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        userAgent: undefined
      })
      page = context.pages()[0] ?? (await context.newPage())
      if (claudeCookie) {
        await page.setExtraHTTPHeaders({ cookie: claudeCookie })
      }
    } else {
      browser = await chromium.launch({
        headless: opts.headless,
        executablePath: resolveChromiumExecutable(),
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials'
        ]
      })
      page = await browser.newPage({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 }
      })
      const realHeaders: Record<string, string> = {
        'sec-ch-ua': '"Not.A/Brand";v="24", "Chromium";v="122", "Google Chrome";v="122"',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-mobile': '?0',
        'upgrade-insecure-requests': '1',
        'accept-language': 'en-US,en;q=0.9',
        accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7'
      }
      await page.setExtraHTTPHeaders(realHeaders)
      await page.route('**/*', route => {
        const headers = {
          ...route.request().headers(),
          ...realHeaders
        }
        route.continue({ headers })
      })
    }
    await page.addInitScript(() => {
      // Basic stealth to reduce bot-detection/CF challenges.
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
      // @ts-expect-error: provide a minimal chrome runtime shim for stealth
      window.chrome = { runtime: {} }
    })
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
    await page.waitForLoadState('networkidle', { timeout: Math.max(3000, timeoutMs / 4) }).catch(() => {})

    // Handle bot-block/CF challenges with patience instead of immediate fail.
    const challengePattern = /cloudflare|just a moment|verify you are human|enable javascript|checking your browser/i
    let challengeClear = false
    for (let i = 0; i < 3; i += 1) {
      const bodyText = (await page.textContent('body').catch(() => '')) || ''
      if (!challengePattern.test(bodyText)) {
        challengeClear = true
        break
      }
      await page.waitForTimeout(8000)
      await page.waitForLoadState('networkidle').catch(() => {})
    }
    if (!challengeClear) {
      throw new AppError(
        'The share page appears to be blocking automation (bot/challenge page detected).',
        'Open the link in a regular browser to confirm it loads without a challenge, or try an alternate share.'
      )
    }

    const selector = opts.waitForSelector ?? (await (async () => {
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
      throw new AppError(
        'No conversation content found for this provider.',
        'Try --wait-for-selector "<css>" to override, or verify the page layout.'
      )
    })())

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
      const cleanHtml = (el: Element): string => {
        const clone = el.cloneNode(true) as HTMLElement
        const garbage = clone.querySelectorAll(
          'button, [data-testid*="citation"], [data-testid*="pill"], [class*="copy"], [role="tooltip"], [aria-label="Copy"], [data-testid*="copy"], [data-testid*="meta"]'
        )
        garbage.forEach(g => g.remove())
        clone.querySelectorAll('[data-start],[data-end]').forEach(n => {
          n.removeAttribute('data-start')
          n.removeAttribute('data-end')
        })
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
          const inferRole = (): string => {
            const source = `${attrRole} ${testId} ${className}`
            if (/assistant|bot|claude|system|model|gemini|grok/.test(source)) return 'assistant'
            if (/user|human|you/.test(source)) return 'user'
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

    if (provider === 'grok' || provider === 'gemini' || provider === 'claude') {
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
    const titleWithoutPrefix = title.replace(/^(ChatGPT|Claude|Gemini|Grok)\s*-?\s*/i, '')
    const headingPrefix =
      provider === 'claude' ? 'Claude' : provider === 'gemini' ? 'Gemini' : provider === 'grok' ? 'Grok' : 'ChatGPT'
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
      lines.push(markdown)
      lines.push('')
    }

    return { title, markdown: normalizeLineTerminators(lines.join('\n')), retrievedAt }
  } catch (err) {
    const dumpPath = await dumpDebug()
    if (dumpPath) {
      console.error(chalk.gray(`Debug page saved to ${dumpPath}`))
    }
    throw err
  } finally {
    if (cdpBrowser) {
      await cdpBrowser.close()
    } else if (context) {
      await context.close()
    } else if (browser) {
      await browser.close()
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
    claudeCookieFile,
    claudeCookiePrompt,
    claudeBrowserAssist,
    claudeAttachWs,
    autoInstallGh,
    ghPagesRepo,
    ghPagesBranch,
    ghPagesDir
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
    fail('Please pass a valid http(s) URL (public ChatGPT or Claude share link).')
    usage()
    process.exit(1)
  }
  const sharePattern =
    /^https?:\/\/(chatgpt\.com|share\.chatgpt\.com|chat\.openai\.com|claude\.ai|gemini\.google\.com|grok\.com)\/share\//i
  if (!sharePattern.test(url)) {
    fail(
      'The URL should be a public ChatGPT, Claude, Gemini, or Grok share link (e.g., https://chatgpt.com/share/<id>, https://claude.ai/share/<id>, https://gemini.google.com/share/<id>, or https://grok.com/share/<id>).'
    )
    process.exit(1)
  }
  const provider = detectProvider(url)
  const effectiveHeadless = provider === 'claude' ? false : headless !== false

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
    console.log(chalk.yellow('Note: --html-only will skip Markdown output.'))
  }
  if (!quiet && mdOnly) {
    console.log(chalk.yellow('Note: --md-only will skip HTML output.'))
  }

  const ghRepoResolved = ghPagesRepo ?? config.gh?.repo ?? DEFAULT_GH_REPO
  const ghBranchResolved = ghPagesBranch || config.gh?.branch || 'gh-pages'
  const ghDirResolved = (ghPagesDir ?? config.gh?.dir ?? 'csctf').trim() || 'csctf'
  const hasStoredGh = Boolean(config.gh)
  const hasExplicitRepo = Boolean(ghPagesRepo)
  const shouldPublish = hasExplicitRepo || hasStoredGh
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
      claudeCookieFile,
      claudeCookiePrompt,
      claudeBrowserAssist,
      claudeAttachWs
    })
    endLaunch()
    endOpen()

    const endConvert = step(idx++, totalSteps, 'Converting to Markdown')
    const datePrefix = new Date().toISOString().slice(0, 10)
    const baseTitle = titleOverride || title
    const name = `${datePrefix}-${provider}-${slugify(baseTitle.replace(/^(ChatGPT|Claude|Gemini|Grok)\s*-?\s*/i, ''))}`
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
        console.log(`   ${chalk.green(f.path)}`)
      })
      const mdPath = writtenFiles.find(f => f.kind === 'md')
      const htmlPath = writtenFiles.find(f => f.kind === 'html')
      if (mdPath || htmlPath) {
        console.log(chalk.gray(`   Hint: ${VIEWER_CMD} <path> to view the export locally.`))
      }
      endLocation()
    }

    // Post-write UX: copy/open/json
    if (copy) {
      const copied = copyToClipboard(markdown, quiet)
      if (!copied && !quiet) console.log(chalk.yellow(CLIP_HELP))
    }
    if (openAfter) {
      const target = writtenFiles.find(f => f.kind === 'html') ?? writtenFiles.find(f => f.kind === 'md')
      if (target) {
        const opened = openFile(target.path, quiet)
        if (!opened && !quiet) console.log(chalk.yellow(`Could not open ${target.path}; use ${VIEWER_CMD} <path> manually.`))
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

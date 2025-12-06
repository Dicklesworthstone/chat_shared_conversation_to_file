#!/usr/bin/env bun
import { chromium, type Browser } from 'playwright-chromium'
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

type ScrapedMessage = {
  role: string
  html: string
}

type CliOptions = {
  timeoutMs: number
  outfile?: string
  quiet: boolean
  checkUpdates: boolean
  versionOnly: boolean
  generateHtml: boolean
  htmlOnly: boolean
  mdOnly: boolean
  rememberGh: boolean
  forgetGh: boolean
  dryRun: boolean
  yes: boolean
  ghPagesRepo?: string
  ghPagesBranch: string
  ghPagesDir: string
  autoInstallGh: boolean
}

type ParsedArgs = CliOptions & { url: string }

const DEFAULT_TIMEOUT_MS = 60_000
const MAX_SLUG_LEN = 120
const DEFAULT_GH_REPO = 'my_shared_chatgpt_conversations'
const CONFIG_DIR = path.join(os.homedir(), '.config', 'csctm')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

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
  history?: PublishHistoryItem[]
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
      throw new Error('Unsupported Linux package manager for auto gh install. Install gh manually.')
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

async function resolveGitHubToken(): Promise<string> {
  const envToken = process.env.GITHUB_TOKEN
  if (envToken) return envToken
  if (!process.stdin.isTTY) {
    throw new Error('GITHUB_TOKEN is required for publishing (non-interactive). Set env var or run interactively.')
  }
  console.log(
    chalk.yellow(
      'No GITHUB_TOKEN found. Paste a token with repo write access (recommended: classic token with repo scope or fine-grained with contents:write). Input is not stored on disk.'
    )
  )
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const token: string = await new Promise(resolve => rl.question('GITHUB_TOKEN: ', resolve))
  rl.close()
  if (!token.trim()) throw new Error('Empty token provided.')
  return token.trim()
}

function loadConfig(): AppConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {}
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(raw) as AppConfig
  } catch {
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
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  const existing = counts.get(base) ?? 0
  counts.set(base, existing + 1)
  return existing === 0 ? base : `${base}-${existing}`
}

export function renderHtmlDocument(markdown: string, title: string, source: string, retrieved: string): string {
  const counts = new Map<string, number>()
  const headings: { level: number; text: string; id: string }[] = []

  const md = new MarkdownIt({ html: false, linkify: true })
  md.set({
    highlight(code: string, lang: string): string {
      if (lang && hljs.getLanguage(lang)) {
        const { value } = hljs.highlight(code, { language: lang, ignoreIllegals: true })
        return `<div class="code-block"><div class="code-lang">${lang}</div><pre><code class="hljs language-${lang}">${value}</code></pre></div>`
      }
      const escaped = md.utils.escapeHtml(code)
      return `<div class="code-block"><pre><code class="hljs">${escaped}</code></pre></div>`
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
  const safeTitle = md.utils.escapeHtml(title.replace(/^ChatGPT\s*-?\s*/i, ''))
  const safeSource = md.utils.escapeHtml(source)
  const safeRetrieved = md.utils.escapeHtml(retrieved)

  const toc =
    headings.length > 0
      ? `<div class="toc">
    <h3>Contents</h3>
    <ul>
      ${headings
        .filter(h => h.level <= 3)
        .map(h => `<li style="margin-left:${(h.level - 2) * 12}px"><a href="#${h.id}">${md.utils.escapeHtml(h.text)}</a></li>`)
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
  let quiet = false
  let checkUpdates = false
  let versionOnly = false
  let generateHtml = true
  let htmlOnly = false
  let mdOnly = false
  let rememberGh = false
  let forgetGh = false
  let dryRun = false
  let yes = false
  let ghPagesRepo: string | undefined
  let ghPagesBranch = 'gh-pages'
  let ghPagesDir = 'csctm'
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
      case '--quiet':
        quiet = true
        break
      case '--check-updates':
        checkUpdates = true
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
        ghPagesRepo = args[i + 1]
        i += 1
        break
      case '--gh-pages-branch':
        ghPagesBranch = args[i + 1] ?? ghPagesBranch
        i += 1
        break
      case '--gh-pages-dir':
        ghPagesDir = args[i + 1] ?? ghPagesDir
        i += 1
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

  return {
    url,
    timeoutMs,
    outfile,
    quiet,
    checkUpdates,
    versionOnly,
    generateHtml,
    htmlOnly,
    mdOnly,
    rememberGh,
    forgetGh,
    dryRun,
    yes,
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

const STEP = (quiet: boolean) => (n: number, total: number, msg: string) => {
  if (quiet) return () => {}
  const start = Date.now()
  console.log(`${chalk.gray(`[${n}/${total}]`)} ${chalk.cyan(msg)}`)
  return () => {
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
      `Usage: csctm <chatgpt|claude|gemini|grok-share-url> [--timeout-ms 60000] [--outfile path] [--quiet] [--check-updates] [--version] [--no-html] [--html-only] [--md-only] [--gh-pages-repo owner/name] [--gh-pages-branch gh-pages] [--gh-pages-dir dir] [--remember] [--forget-gh-pages] [--dry-run] [--yes]`,
      '',
      'Common recipes:',
      `  Basic scrape (ChatGPT):   csctm https://chatgpt.com/share/<id>`,
      `  Basic scrape (Claude):    csctm https://claude.ai/share/<id>`,
      `  Basic scrape (Gemini):    csctm https://gemini.google.com/share/<id>`,
      `  Basic scrape (Grok):      csctm https://grok.com/share/<id>`,
      `  Longer timeout:           csctm <url> --timeout-ms 90000`,
      `  Markdown only:            csctm <url> --md-only`,
      `  HTML only:                csctm <url> --html-only`,
      `  Publish (public):         GITHUB_TOKEN=... csctm <url> --gh-pages-repo owner/name --yes`,
      `  Remember GH settings:     csctm <url> --gh-pages-repo owner/name --remember --yes`,
      ''
    ].join('\n')
  )
}

export function slugify(title: string): string {
  let base = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!base.length) base = 'chatgpt_conversation'
  if (base.length > MAX_SLUG_LEN) base = base.slice(0, MAX_SLUG_LEN).replace(/_+$/, '')
  if (RESERVED_BASENAMES.has(base)) base = `${base}_chatgpt`
  return base
}

export function uniquePath(basePath: string): string {
  if (!fs.existsSync(basePath)) return basePath
  const { dir, name, ext } = path.parse(basePath)
  let idx = 2
  // Guaranteed return because filesystem is finite; loop breaks once an unused name is found.
  while (true) {
    const candidate = path.join(dir, `${name}_${idx}${ext}`)
    if (!fs.existsSync(candidate)) return candidate
    idx += 1
  }
}

function buildTurndown(): TurndownService {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })

  const codeRule: Rule = {
    filter: (node: HTMLElement) => node.nodeName === 'PRE' && node.firstElementChild?.nodeName === 'CODE',
    replacement: (_content: string, node: HTMLElement) => {
      const codeNode = node.firstElementChild as HTMLElement | null
      const className = codeNode?.getAttribute('class') ?? ''
      const match = className.match(/language-([\w-]+)/)
      const lang = match?.[1] ?? ''
      const codeText = (codeNode?.textContent ?? '').replace(/\u00a0/g, ' ')
      return `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`
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
  const latestUrl =
    'https://api.github.com/repos/Dicklesworthstone/chatgpt_shared_conversation_to_markdown_file/releases/latest'
  try {
    const res = await fetch(latestUrl, { headers: { Accept: 'application/vnd.github+json' } })
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
    }
  } catch {
    if (!quiet) console.log(chalk.gray('Skipped update check (offline or GitHub unavailable).'))
  }
}

async function attemptWithBackoff(fn: () => Promise<void>, timeoutMs: number, label: string): Promise<void> {
  const attempts = 3
  const baseDelay = 500
  let lastErr: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fn()
      return
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) {
        const delay = baseDelay * (i + 1)
        await new Promise(res => setTimeout(res, delay))
      }
    }
  }
  throw new Error(`Failed after ${attempts} attempts while ${label}. Last error: ${lastErr}`)
}

function writeAtomic(target: string, content: string): void {
  const dir = path.dirname(target)
  const tmp = path.join(dir, `.${path.basename(target)}.tmp-${Date.now()}`)
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, target)
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
  dryRun: boolean
  remember: boolean
  config: AppConfig
  entry: PublishHistoryItem
}

function resolveRepoUrl(repo: string): { repo: string; url: string } {
  if (repo.startsWith('http')) return { repo, url: repo }
  if (!repo.includes('/')) {
    const login = currentGhLogin()
    if (!login) throw new Error('Specify --gh-pages-repo as owner/name or ensure gh is logged in.')
    const full = `${login}/${repo}`
    return { repo: full, url: `https://github.com/${full}.git` }
  }
  return { repo, url: `https://github.com/${repo}.git` }
}

function renderIndex(manifest: PublishHistoryItem[], title = 'csctm exports'): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const cards = manifest
    .map(item => {
      const mdLink = item.md ? `<a href="./${encodeURIComponent(item.md)}">Markdown</a>` : ''
      const htmlLink = item.html ? `<a href="./${encodeURIComponent(item.html)}">HTML</a>` : ''
      const links = [htmlLink, mdLink].filter(Boolean).join(' • ')
      return `<div class="card">
  <div class="card-title">${esc(item.title)}</div>
  <div class="card-meta">Added: ${esc(item.addedAt)}</div>
  <div class="card-links">${links}</div>
</div>`
    })
    .join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #0f172a; margin: 0; padding: 32px; color: #e2e8f0; }
    h1 { margin: 0 0 18px; font-size: 1.8rem; }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .card { background: rgba(15,23,42,0.75); border: 1px solid #1f2937; border-radius: 12px; padding: 16px; box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
    .card-title { font-weight: 600; margin-bottom: 6px; }
    .card-meta { font-size: 0.9rem; color: #cbd5e1; margin-bottom: 8px; }
    .card-links a { color: #93c5fd; text-decoration: none; font-weight: 600; }
    .card-links a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>${title}</h1>
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
  if (dryRun) {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(osTmpDir()), 'csctm-ghp-dry-'))
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
  }
  const token = await resolveGitHubToken()

  const { repo: repoName, url } = resolveRepoUrl(repo)
  const urlWithToken = url.replace('https://', `https://${token}@`)
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(osTmpDir()), 'csctm-ghp-'))

  const run = (args: string[]) => {
    const res = spawnSync('git', args, {
      cwd: tmp,
      stdio: quiet ? 'ignore' : 'inherit',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    if (res.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed with code ${res.status ?? 'unknown'}`)
    }
  }

  const attemptClone = (branchName: string): number =>
    spawnSync('git', ['clone', '--depth', '1', '--branch', branchName, urlWithToken, tmp], {
      stdio: quiet ? 'ignore' : 'inherit',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    }).status ?? 1

  let cloned = attemptClone(branch)
  if (cloned !== 0) {
    const defaultClone = spawnSync('git', ['clone', '--depth', '1', urlWithToken, tmp], {
      stdio: quiet ? 'ignore' : 'inherit',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })
    if (defaultClone.status !== 0) {
      if (isGhCliAvailable()) {
        const create = spawnSync('gh', ['repo', 'create', repoName, '--public', '--confirm'], {
          stdio: quiet ? 'ignore' : 'inherit'
        })
        if (create.status !== 0) {
          throw new Error('Failed to create repository via gh. Provide an existing repo with --gh-pages-repo owner/name.')
        }
        cloned = attemptClone(branch)
      } else {
        throw new Error('Failed to clone repository. Ensure repo exists or install gh and set --gh-pages-repo owner/name.')
      }
    }
  }

  if (cloned !== 0) {
    run(['checkout', '-b', branch])
  }

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

  if (dryRun) {
    if (!quiet) console.log(chalk.gray('Dry run: skipping git commit/push'))
    return config
  }

  run(['add', '.'])
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: tmp, encoding: 'utf8' })
  if (status.stdout.trim().length === 0) return config
  run(['commit', '-m', `Add csctm export: ${entry.title.slice(0, 60)}`])
  run(['push', 'origin', branch])

  if (remember) {
    const nextCfg: AppConfig = {
      ...config,
      gh: { repo: repoName, branch, dir }
    }
    saveConfig(nextCfg)
    return nextCfg
  }

  return config
}

function osTmpDir(): string {
  return os.tmpdir()
}

function cleanHtml(html: string): string {
  return html
    .replace(/<span[^>]*data-testid="webpage-citation-pill"[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<a[^>]*data-testid="webpage-citation-pill"[^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<button[^>]*data-testid="[^"]*(copy|clipboard)[^"]*"[^>]*>[\s\S]*?<\/button>/gi, '')
    .replace(/<div[^>]*data-testid="[^"]*(tooltip|pill)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/\sdata-start="\d+"/g, '')
    .replace(/\sdata-end="\d+"/g, '')
}

function normalizeLineTerminators(markdown: string): string {
  // Remove Unicode LS (\u2028) and PS (\u2029) which can break editors/linters.
  return markdown.replace(/[\u2028\u2029]/g, '\n')
}

function detectProvider(url: string): Provider {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.endsWith('claude.ai')) return 'claude'
    if (host.endsWith('gemini.google.com')) return 'gemini'
    if (host.endsWith('grok.com')) return 'grok'
  } catch {
    // ignore
  }
  return 'chatgpt'
}

async function scrape(
  url: string,
  timeoutMs: number,
  provider: Provider
): Promise<{ title: string; markdown: string; retrievedAt: string }> {
  const td = buildTurndown()
  let browser: Browser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    })

    await attemptWithBackoff(
      async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs / 2 })
        await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs })
      },
      timeoutMs,
      'loading the share URL (check that the link is public and reachable)'
    )

    const selectorSets =
      provider === 'claude'
        ? [
            'main [data-testid="message"]',
            'main [data-testid="message-row"]',
            '[data-testid="chat-message"]',
            'article [data-message-author-role]'
          ]
        : provider === 'gemini'
        ? [
            'main [data-message-author-role]',
            'main [data-author-role]',
            'main [data-utterance]',
            'main [data-testid*="message"]',
            'article [data-message-author-role]'
          ]
        : provider === 'grok'
        ? [
            'main [data-testid*="message"]',
            'main [data-message-author-role]',
            'main [data-author]',
            '[data-testid*="message"]',
            'article [data-message-author-role]'
          ]
        : ['article [data-message-author-role]']
    const selector = selectorSets.join(',')

    await attemptWithBackoff(
      async () => {
        await page.waitForSelector(selector, { timeout: timeoutMs })
      },
      timeoutMs,
      'waiting for conversation content (page layout may have changed or the link may be private)'
    )

    const title = await page.title()
    const messages = (await page.$$eval(
      selector,
      (nodes: Element[]) =>
        nodes.map(node => {
          const element = node as HTMLElement
          const attrRole =
            element.getAttribute('data-message-author-role') ??
            element.getAttribute('data-author') ??
            element.getAttribute('data-role') ??
            ''
          const testId = (element.getAttribute('data-testid') ?? '').toLowerCase()
          const className = (element.getAttribute('class') ?? '').toLowerCase()
          const inferRole = (): string => {
            const source = `${attrRole} ${testId} ${className}`
            if (/assistant|bot|claude|system|model|gemini|grok/.test(source)) return 'assistant'
            if (/user|human|you/.test(source)) return 'user'
            return 'unknown'
          }
          return {
            role: attrRole || inferRole(),
            html: element.innerHTML
          }
        })
    )) as ScrapedMessage[]

    if (!messages.length) throw new Error('No messages were found in the shared conversation.')

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
      lines.push(`## ${msg.role === 'assistant' ? 'Assistant' : 'User'}`)
      lines.push('')
      let markdown = td.turndown(cleanHtml(msg.html))
      markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()
      lines.push(markdown)
      lines.push('')
    }

    return { title, markdown: normalizeLineTerminators(lines.join('\n')), retrievedAt }
  } finally {
    if (browser) await browser.close()
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2))
  const {
    url,
    timeoutMs,
    outfile,
    quiet,
    checkUpdates,
    versionOnly,
    generateHtml,
    htmlOnly,
    mdOnly,
    rememberGh,
    forgetGh,
    dryRun,
    yes,
    autoInstallGh,
    ghPagesRepo,
    ghPagesBranch,
    ghPagesDir
  } = opts

  const step = STEP(quiet)
  const fail = FAIL(quiet)
  const done = DONE(quiet)

  if (versionOnly) {
    console.log(`csctm v${pkg.version}`)
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

  if (forgetGh) {
    forgetGhConfig()
  }
  const config = forgetGh ? {} : loadConfig()
  const produceMd = !htmlOnly
  const produceHtml = !mdOnly && generateHtml
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
  const ghDirResolved = ghPagesDir || config.gh?.dir || 'csctm'
  const shouldPublish = Boolean(ghPagesRepo || config.gh || process.env.GITHUB_TOKEN)
  const shouldRemember = rememberGh || (!config.gh && shouldPublish)

  try {
    const overallStart = Date.now()
    const totalSteps =
      4 + // launch, open, convert, final "all done"
      (produceMd ? 1 : 0) +
      (produceHtml ? 1 : 0) +
      (quiet ? 0 : 1) + // location print
      (shouldPublish ? 1 : 0) +
      (checkUpdates ? 1 : 0)
    let idx = 1

    const endLaunch = step(idx++, totalSteps, 'Launching headless Chromium')
    const endOpen = step(idx++, totalSteps, 'Opening share link')
    const { title, markdown, retrievedAt } = await scrape(url, timeoutMs, provider)
    endLaunch()
    endOpen()

    const endConvert = step(idx++, totalSteps, 'Converting to Markdown')
    const name = slugify(title.replace(/^(ChatGPT|Claude|Gemini|Grok)\s*-?\s*/i, ''))
    const resolvedOutfile = outfile ? path.resolve(outfile) : path.join(process.cwd(), `${name}.md`)
    const parsedOutfile = path.parse(resolvedOutfile)
    const outfileStem = path.join(parsedOutfile.dir, parsedOutfile.name || name)
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
      const viewerHint =
        process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
      if (mdPath || htmlPath) {
        console.log(chalk.gray(`   Hint: ${viewerHint} <path> to view the export locally.`))
      }
      endLocation()
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
        dryRun,
        remember: shouldRemember,
        config,
        entry: { title: title.replace(/^ChatGPT\s*-?\s*/i, ''), addedAt: retrievedAt }
      })
      if (shouldRemember && !dryRun) {
        saveConfig(updatedConfig)
      }
      endPublish()
    }

    if (checkUpdates) {
      const endUpdates = step(idx++, totalSteps, 'Checking for updates')
      await checkForUpdates(pkg.version, quiet)
      endUpdates()
    }

    step(idx++, totalSteps, 'All done. Enjoy!')()
    done('Finished', Date.now() - overallStart)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const networkHints =
      'Check that the share link is public and reachable; try --timeout-ms 90000 if the page is slow.'
    const formatted =
      message.includes('No messages were found') || message.toLowerCase().includes('timeout')
        ? `${message} (${networkHints})`
        : message
    fail(formatted)
    process.exit(1)
  }
}

if (import.meta.main) {
  void main()
}

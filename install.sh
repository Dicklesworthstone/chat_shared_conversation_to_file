#!/usr/bin/env bash
set -euo pipefail
umask 022
shopt -s lastpipe 2>/dev/null || true

VERSION="${VERSION:-}"
OWNER="${OWNER:-Dicklesworthstone}"
REPO="${REPO:-chat_shared_conversation_to_file}"
BINARY="${BINARY:-csctf}"
DEST_DEFAULT="$HOME/.local/bin"
DEST="${DEST:-$DEST_DEFAULT}"
EASY=0
QUIET=0
FROM_SOURCE=0
VERIFY=1
CHECKSUM_URL="${CHECKSUM_URL:-}"
HTTP_USER_AGENT="OpenAI File Downloader, XaiImageApiFetch/1.0"

log() { [ "$QUIET" -eq 1 ] && return 0; echo -e "$@"; }
info() { log "\033[0;34m→\033[0m $*"; }
ok()   { log "\033[0;32m✓\033[0m $*"; }
warn() { echo -e "\033[1;33m⚠\033[0m $*" >&2; }
err()  { echo -e "\033[0;31m✗\033[0m $*" >&2; }
die()  { err "$1"; exit 1; }

usage() {
  cat <<'EOFU'
Usage: install.sh [--version vX.Y.Z] [--dest DIR] [--system] [--from-source] [--easy-mode] [--quiet] [--verify|--no-verify]

Downloaded release checksums are required by default. --no-verify is an explicit opt-out.

Environment overrides:
  VERSION         Tag to install (defaults to latest release)
  OWNER           GitHub owner (default: Dicklesworthstone)
  REPO            GitHub repo  (default: chat_shared_conversation_to_file)
  DEST            Install dir  (default: ~/.local/bin or /usr/local/bin with --system)
  BINARY          Installed name (default: csctf)
  CHECKSUM_URL    Override checksum URL (defaults to <binary>.sha256 next to artifact)
EOFU
}

parse_args() {
while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] && [[ "$2" != -* && -n "$2" ]] || die "--version requires a release tag"; VERSION="$2"; shift 2;;
    --dest) [ $# -ge 2 ] && [[ "$2" != -* && -n "$2" ]] || die "--dest requires a directory"; DEST="$2"; shift 2;;
    --system) DEST="/usr/local/bin"; shift;;
    --from-source) FROM_SOURCE=1; shift;;
    --easy-mode) EASY=1; shift;;
    --verify) VERIFY=1; shift;;
    --no-verify) VERIFY=0; shift;;
    --quiet|-q) QUIET=1; shift;;
    -h|--help) usage; exit 0;;
    *) die "Unknown option: $1";;
  esac
done
}

maybe_add_path() {
  case ":$PATH:" in
    *:"$DEST":*) return 0;;
    *)
      if [ "$EASY" -eq 1 ]; then
        UPDATED=0
        for rc in "$HOME/.zshrc" "$HOME/.bashrc"; do
          if [ -e "$rc" ] && [ -w "$rc" ]; then
            if ! grep -F "$DEST" "$rc" >/dev/null 2>&1; then
              echo "export PATH=\"$DEST:\$PATH\"" >> "$rc"
              UPDATED=1
            fi
          fi
        done
        if [ "$UPDATED" -eq 1 ]; then
          warn "PATH updated in ~/.zshrc/.bashrc; restart your shell to use ${BINARY}"
        else
          warn "Add $DEST to PATH to use ${BINARY} (export PATH=\"$DEST:\$PATH\")"
        fi
      else
        warn "Add $DEST to PATH to use ${BINARY} (export PATH=\"$DEST:\$PATH\")"
      fi
    ;;
  esac
}

resolve_version() {
  if [ -n "$VERSION" ]; then return 0; fi
  local latest_url="https://api.github.com/repos/${OWNER}/${REPO}/releases/latest"
  local tag=""
  info "Resolving latest version..."
  # The API answers with minified one-line JSON, so take the first "tag_name"
  # field rather than the last quoted string on the line (that is the release
  # body). Quotes inside JSON strings are escaped, so prose cannot fake the key.
  # awk reads to EOF so curl never sees SIGPIPE under pipefail.
  tag=$(curl -fsSL -A "$HTTP_USER_AGENT" -H "Accept: application/vnd.github.v3+json" "$latest_url" \
    | awk -F'"tag_name"[ \t]*:[ \t]*"' '!found && NF > 1 { split($2, a, "\""); print a[1]; found = 1 }') \
    || die "Could not resolve the latest release; pass --version explicitly"
  if [ -n "$tag" ]; then
    VERSION="$tag"
    info "Resolved latest: $VERSION"
  else
    die "No release tag resolved"
  fi
}

detect_target() {
  OS=$(uname -s | tr 'A-Z' 'a-z')
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64)
      if [ "$OS" = "darwin" ]; then
        ARCH="arm64"
      else
        ARCH="aarch64"
      fi
    ;;
  esac

  ASSET=""
  case "${OS}-${ARCH}" in
    linux-x86_64)
      ASSET="csctf-linux-x64"
      # Bun's default x64 runtime needs AVX2 and dies with SIGILL without it
      # (pre-Haswell Xeons, QEMU's default CPU model). Use the baseline build.
      if [ -r /proc/cpuinfo ] && ! grep -qw avx2 /proc/cpuinfo; then
        ASSET="csctf-linux-x64-baseline"
        info "CPU lacks AVX2; using the baseline build"
      fi
    ;;
    linux-aarch64) ASSET="csctf-linux-arm64" ;;
    darwin-arm64) ASSET="csctf-macos-arm64" ;;
    darwin-x86_64) ASSET="csctf-macos-x64" ;;
    msys*-x86_64|mingw*-x86_64|cygwin*-x86_64) ASSET="csctf-windows-x64.exe" ;;
    *) [ "$FROM_SOURCE" -eq 1 ] || die "Unsupported binary platform ${OS}/${ARCH}; use --from-source explicitly" ;;
  esac
}

verify_artifact() {
  local artifact="$1" manifest="$2" expected actual
  if [ "$VERIFY" -eq 0 ]; then
    warn "Checksum verification explicitly disabled"
    return 0
  fi
  expected=$(awk -v name="$ASSET" '
    $2 == name || $2 == "*" name {
      count++; sum = $1;
      if (NF != 2) malformed = 1;
    }
    END {
      if (count == 1 && !malformed && length(sum) == 64 && sum !~ /[^0-9a-fA-F]/) print tolower(sum);
      else exit 1;
    }' "$manifest") || die "Missing, malformed, or duplicate checksum for $ASSET"
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$artifact" | awk '{print tolower($1)}') || die "Could not hash $ASSET"
  elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$artifact" | awk '{print tolower($1)}') || die "Could not hash $ASSET"
  else
    die "sha256sum or shasum is required to verify $ASSET"
  fi
  [ "$actual" = "$expected" ] || die "Checksum verification failed for $ASSET"
  ok "Checksum verified: $ASSET"
}

download_binary() {
  local tag_path
  if [ -n "$VERSION" ]; then
    tag_path="download/${VERSION}"
  else
    tag_path="latest/download"
  fi
  local url="https://github.com/${OWNER}/${REPO}/releases/${tag_path}/${ASSET}"
  info "Downloading ${url}"
  curl -fL -A "$HTTP_USER_AGENT" "$url" -o "$TMP/${ASSET}" \
    || die "Binary download failed; retained stage: $TMP"
  if [ "$VERIFY" -eq 1 ]; then
    local checksum_target="${CHECKSUM_URL:-${url}.sha256}"
    curl -fL -A "$HTTP_USER_AGENT" "$checksum_target" -o "$TMP/${ASSET}.sha256" \
      || die "Checksum required but not available at ${checksum_target}"
  fi
  verify_artifact "$TMP/${ASSET}" "$TMP/${ASSET}.sha256"
  BINARY_STAGE="$TMP/${ASSET}"
}

build_from_source() {
  info "Building from source (requires git + bun)"
  command -v git >/dev/null 2>&1 || { err "git is required"; exit 1; }
  command -v bun >/dev/null 2>&1 || { err "bun is required"; exit 1; }

  git -c http.userAgent="$HTTP_USER_AGENT" clone --depth 1 --branch "$VERSION" \
    "https://github.com/${OWNER}/${REPO}.git" "$TMP/src"
  (
    cd "$TMP/src"
    bun install --frozen-lockfile
    bun run build
  )

  local bin_path="$TMP/src/dist/csctf"
  if [ -f "$TMP/src/dist/csctf.exe" ]; then
    bin_path="$TMP/src/dist/csctf.exe"
  fi

  [ -x "$bin_path" ] || { err "Build failed; binary not found"; exit 1; }
  BINARY_STAGE="$bin_path"
}

publish_binary() {
  local destination="$1" candidate backup
  [ ! -L "$destination" ] || die "Refusing to replace a symlink: $destination"
  [ ! -e "$destination" ] || [ -f "$destination" ] || die "Destination is not a regular file: $destination"
  candidate=$(mktemp "$DEST/.csctf-install.XXXXXX")
  cp "$BINARY_STAGE" "$candidate" || die "Could not prepare the binary"
  chmod 755 "$candidate" || die "Could not set binary permissions"
  # Never replace a working binary with one this machine cannot run. (The
  # extension-less temp name is not runnable on Windows shells; skip there.)
  case "${OS:-}" in
    msys*|mingw*|cygwin*) ;;
    *) "$candidate" --version >/dev/null 2>&1 \
         || die "Prepared ${ASSET:-binary} does not run on this machine (exit $?); ${destination} left unchanged, stage: $candidate" ;;
  esac
  if [ -f "$destination" ]; then
    backup=$(mktemp "${destination}.previous.XXXXXX")
    cp -p "$destination" "$backup" || die "Could not preserve the incumbent binary"
    info "Retaining incumbent backup: $backup"
  fi
  mv -f "$candidate" "$destination" || die "Could not publish the prepared binary"
  [ -x "$destination" ] || die "Installed binary is not executable"
  ok "Installed ${BINARY} to $DEST"
}

install_main() {
resolve_version
case "$VERSION" in
  ""|*[!a-zA-Z0-9._+-]*) die "Invalid release tag: $VERSION";;
esac
detect_target
TMP=$(mktemp -d "$DEST/.csctf-stage.XXXXXX")
info "Retaining installer stage: $TMP"
mkdir -p "$DEST"

STEP_TOTAL=6
STEP_IDX=1
log_step() {
  info "[$STEP_IDX/$STEP_TOTAL] $*"
  STEP_IDX=$((STEP_IDX+1))
}

log_step "Resolved version ${VERSION:-latest}"
log_step "Detected platform ${OS:-unknown}/${ARCH:-unknown}"

if [ "$FROM_SOURCE" -eq 0 ]; then
  log_step "Downloading release artifact"
  download_binary
else
  log_step "Skipping download (build from source requested)"
fi

if [ "$FROM_SOURCE" -eq 1 ]; then
  log_step "Building from source"
  build_from_source
else
  log_step "Build step skipped (binary already downloaded)"
fi

INSTALL_PATH="$DEST/$BINARY"
case "$OS" in
  msys*|mingw*|cygwin*) case "$BINARY" in *.exe) ;; *) INSTALL_PATH="${INSTALL_PATH}.exe";; esac;;
esac
publish_binary "$INSTALL_PATH"
log_step "Ensuring ${DEST} is on PATH"
maybe_add_path
log_step "Finalizing"
ok "Done. Run: ${BINARY} <share-url (ChatGPT|Gemini|Grok|Claude)>"
}

run_locked_install() {
  case "$BINARY" in ""|*/*|.|..) die "BINARY must be a single filename";; esac
  mkdir -p "$DEST" || die "Could not prepare the install directory"
  DEST=$(cd "$DEST" && pwd -P) || die "Could not resolve the install directory"
  local lock_file="$DEST/.csctf-install.lock" payload
  [ ! -L "$lock_file" ] || die "Refusing a symlink installer lock"
  payload=$(
    declare -p VERSION OWNER REPO BINARY DEST EASY QUIET FROM_SOURCE VERIFY CHECKSUM_URL HTTP_USER_AGENT
    declare -f log info ok warn err die maybe_add_path resolve_version detect_target verify_artifact download_binary build_from_source publish_binary install_main
    printf 'set -euo pipefail\ninstall_main\n'
  )
  if command -v flock >/dev/null 2>&1; then
    flock -n "$lock_file" bash -c "$payload"
  elif command -v perl >/dev/null 2>&1; then
    perl -MFcntl=:flock -e '
      my $path = shift @ARGV;
      open my $lock, ">>", $path or die "Cannot open installer lock $path: $!\n";
      flock($lock, LOCK_EX | LOCK_NB) or die "Another installation holds $path\n";
      system @ARGV;
      die "Could not start installer: $!\n" if $? == -1;
      exit(($? & 127) ? 128 + ($? & 127) : $? >> 8);
    ' "$lock_file" bash -c "$payload"
  else
    die "A kernel file-lock helper (flock or Perl) is required; refusing an unlocked installation"
  fi
}

if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then
  parse_args "$@"
  run_locked_install
fi


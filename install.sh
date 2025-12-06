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
LOCK_FILE="/tmp/csctf-install.lock"
VERIFY=0
CHECKSUM_URL="${CHECKSUM_URL:-}"

log() { [ "$QUIET" -eq 1 ] && return 0; echo -e "$@"; }
info() { log "\033[0;34m→\033[0m $*"; }
ok()   { log "\033[0;32m✓\033[0m $*"; }
warn() { log "\033[1;33m⚠\033[0m $*"; }
err()  { log "\033[0;31m✗\033[0m $*"; }

usage() {
  cat <<'EOFU'
Usage: install.sh [--version vX.Y.Z] [--dest DIR] [--system] [--from-source] [--easy-mode] [--quiet] [--verify]

Environment overrides:
  VERSION         Tag to install (defaults to latest release)
  OWNER           GitHub owner (default: Dicklesworthstone)
  REPO            GitHub repo  (default: chat_shared_conversation_to_file)
  DEST            Install dir  (default: ~/.local/bin or /usr/local/bin with --system)
  BINARY          Installed name (default: csctf)
  CHECKSUM_URL    Override checksum URL (defaults to <binary>.sha256 next to artifact)
EOFU
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2;;
    --dest) DEST="$2"; shift 2;;
    --system) DEST="/usr/local/bin"; shift;;
    --from-source) FROM_SOURCE=1; shift;;
    --easy-mode) EASY=1; shift;;
    --verify) VERIFY=1; shift;;
    --quiet|-q) QUIET=1; shift;;
    -h|--help) usage; exit 0;;
    *) shift;;
  esac
done

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
  if ! tag=$(curl -fsSL -H "Accept: application/vnd.github.v3+json" "$latest_url" 2>/dev/null | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/'); then
    tag=""
  fi
  if [ -n "$tag" ]; then
    VERSION="$tag"
    info "Resolved latest: $VERSION"
  else
    VERSION=""
    warn "Could not resolve latest version; will use releases/latest URL"
  fi
}

detect_target() {
  OS=$(uname -s | tr 'A-Z' 'a-z')
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64|amd64) ARCH="x86_64" ;;
    arm64|aarch64) ARCH="aarch64" ;;
  esac

  ASSET=""
  case "${OS}-${ARCH}" in
    linux-x86_64) ASSET="csctf-linux-x64" ;;
    linux-aarch64) ASSET="csctf-linux-arm64" ;;
    darwin-arm64) ASSET="csctf-macos-arm64" ;;
    darwin-x86_64) ASSET="csctf-macos-x64" ;;
    msys*-*|mingw*-*|cygwin*-*) ASSET="csctf-windows-x64.exe" ;;
    *) warn "Unknown platform ${OS}/${ARCH}; will build from source (requires git + bun)"; FROM_SOURCE=1 ;;
  esac
}

lock() {
  LOCK_DIR="${LOCK_FILE}.d"
  LOCKED=0
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    LOCKED=1
    echo $$ > "$LOCK_DIR/pid"
  else
    if [ -f "$LOCK_DIR/pid" ]; then
      OLD_PID=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
      if [ -n "$OLD_PID" ] && ! kill -0 "$OLD_PID" 2>/dev/null; then
        rm -rf "$LOCK_DIR"
        if mkdir "$LOCK_DIR" 2>/dev/null; then
          LOCKED=1
          echo $$ > "$LOCK_DIR/pid"
        fi
      fi
    fi
  fi
  if [ "$LOCKED" -eq 0 ]; then
    err "Another installer is running (lock $LOCK_DIR)"
    exit 1
  fi
}

cleanup() {
  rm -rf "$TMP"
  if [ "${LOCKED:-0}" -eq 1 ]; then rm -rf "$LOCK_DIR"; fi
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
  if ! curl -fL "$url" -o "$TMP/${ASSET}"; then
    warn "Download failed; falling back to build from source (requires git + bun)"
    FROM_SOURCE=1
    return 1
  fi

  # Optional checksum verification
  local hash_cmd=""
  if command -v sha256sum >/dev/null 2>&1; then
    hash_cmd="sha256sum"
  elif command -v shasum >/dev/null 2>&1; then
    hash_cmd="shasum -a 256"
  fi

  if [ -n "$hash_cmd" ]; then
    local checksum_target="${CHECKSUM_URL:-${url}.sha256}"
    if curl -fL "$checksum_target" -o "$TMP/${ASSET}.sha256"; then
      local expected
      expected=$(awk '{print $1}' "$TMP/${ASSET}.sha256" | head -n1)
      if [ -n "$expected" ]; then
        echo "${expected}  $TMP/${ASSET}" | eval "$hash_cmd -c -" || { err "Checksum verification failed"; exit 1; }
        ok "Checksum verified"
      fi
    else
      if [ "$VERIFY" -eq 1 ]; then
        err "Checksum required but not available at ${checksum_target}"
        exit 1
      else
        warn "Checksum not available; proceeding without verification"
      fi
    fi
  else
    warn "No sha256 utility found; skipping checksum verification"
  fi

  install -m 0755 "$TMP/${ASSET}" "$DEST/${BINARY}"
  ok "Installed ${BINARY} to $DEST"
}

build_from_source() {
  info "Building from source (requires git + bun)"
  command -v git >/dev/null 2>&1 || { err "git is required"; exit 1; }
  command -v bun >/dev/null 2>&1 || { err "bun is required"; exit 1; }

  git clone --depth 1 "https://github.com/${OWNER}/${REPO}.git" "$TMP/src"
  (
    cd "$TMP/src"
    bun install --frozen-lockfile
    bun run build
  )

  local bin_path="$TMP/src/dist/${BINARY}"
  if [ -f "$TMP/src/dist/${BINARY}.exe" ]; then
    bin_path="$TMP/src/dist/${BINARY}.exe"
  fi

  [ -x "$bin_path" ] || { err "Build failed; binary not found"; exit 1; }
  install -m 0755 "$bin_path" "$DEST/${BINARY}"
  ok "Installed ${BINARY} to $DEST (built from source)"
}

resolve_version
detect_target
lock
TMP=$(mktemp -d)
trap cleanup EXIT
mkdir -p "$DEST"

STEP_TOTAL=6
STEP_IDX=1
log_step() {
  info "[$STEP_IDX/$STEP_TOTAL] $*"
  STEP_IDX=$((STEP_IDX+1))
}

log_step "Resolved version ${VERSION:-latest}"
log_step "Detected platform ${OS:-unknown}/${ARCH:-unknown}"

DOWNLOAD_OK=1
if [ "$FROM_SOURCE" -eq 0 ]; then
  log_step "Downloading release artifact"
  download_binary || DOWNLOAD_OK=0
else
  log_step "Skipping download (build from source requested)"
  DOWNLOAD_OK=0
fi

if [ "$FROM_SOURCE" -eq 0 ] && [ "$DOWNLOAD_OK" -eq 0 ]; then
  FROM_SOURCE=1
fi

if [ "$FROM_SOURCE" -eq 1 ]; then
  log_step "Building from source"
  build_from_source
else
  log_step "Build step skipped (binary already downloaded)"
fi

log_step "Ensuring ${DEST} is on PATH"
maybe_add_path
log_step "Finalizing"
ok "Done. Run: ${BINARY} <chatgpt-share-url>"


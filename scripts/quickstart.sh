#!/usr/bin/env bash
set -Eeuo pipefail

# Jobpilot quick start for macOS and Linux.
# Usage: curl -fsSL https://raw.githubusercontent.com/sinariazi/jobpilot/main/scripts/quickstart.sh | bash

REPO_ARCHIVE="https://github.com/sinariazi/jobpilot/archive/refs/heads/main.tar.gz"
REPO_ROOT="https://github.com/sinariazi/jobpilot"
CHAT_MODEL="${JOBPILOT_CHAT_MODEL:-qwen3.5:4b}"
DECISION_MODEL="${JOBPILOT_DECISION_MODEL:-tev1:0.8b}"

say() { printf '\n[Jobpilot] %s\n' "$*"; }
fail() { printf '\n[Jobpilot] Setup stopped: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is required. Install it and run this command again."
command -v tar >/dev/null 2>&1 || fail "tar is required. Install it and run this command again."

# Reuse the current checkout when launched inside it. Otherwise, download a clean
# copy into ~/Jobpilot without overwriting an existing folder.
if [[ -f "$PWD/package.json" && -f "$PWD/src/app/page.tsx" ]]; then
  PROJECT_DIR="$PWD"
else
  PROJECT_DIR="${JOBPILOT_DIR:-$HOME/Jobpilot}"
  if [[ -f "$PROJECT_DIR/package.json" && -f "$PROJECT_DIR/src/app/page.tsx" ]]; then
    say "Using existing project at $PROJECT_DIR"
  elif [[ -e "$PROJECT_DIR" ]]; then
    fail "$PROJECT_DIR already exists but does not look like a Jobpilot folder. Move it or set JOBPILOT_DIR to another folder."
  else
    TMP_DIR="$(mktemp -d)"
    trap 'rm -rf "$TMP_DIR"' EXIT
    say "Downloading Jobpilot from $REPO_ROOT"
    curl -fsSL "$REPO_ARCHIVE" -o "$TMP_DIR/jobpilot.tar.gz"
    mkdir -p "$TMP_DIR/unpacked" "$(dirname "$PROJECT_DIR")"
    tar -xzf "$TMP_DIR/jobpilot.tar.gz" -C "$TMP_DIR/unpacked" --strip-components=1
    mv "$TMP_DIR/unpacked" "$PROJECT_DIR"
  fi
fi

# Install a user-local Node 22 if the computer does not already have a supported
# Node/npm pair. This avoids changing the system-wide Node installation.
node_is_supported() {
  command -v node >/dev/null 2>&1 && node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)' >/dev/null 2>&1 && command -v npm >/dev/null 2>&1
}

if ! node_is_supported; then
  say "Installing a private Node.js 22 runtime in your home folder"
  NODE_VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | sed -nE 's/.*"version":[[:space:]]*"(v22\.[0-9]+\.[0-9]+)".*/\1/p' | awk 'NR == 1 { first=$0 } END { print first }')"
  [[ -n "$NODE_VERSION" ]] || fail "Could not find a Node.js 22 download. Install Node.js 22.13 or newer from https://nodejs.org/ and rerun this command."

  SYSTEM="$(uname -s)"
  MACHINE="$(uname -m)"
  case "$SYSTEM:$MACHINE" in
    Darwin:arm64|Darwin:aarch64) NODE_PLATFORM="darwin-arm64"; NODE_ARCHIVE_EXT="tar.gz" ;;
    Darwin:x86_64) NODE_PLATFORM="darwin-x64"; NODE_ARCHIVE_EXT="tar.gz" ;;
    Linux:aarch64|Linux:arm64) NODE_PLATFORM="linux-arm64"; NODE_ARCHIVE_EXT="tar.xz" ;;
    Linux:x86_64) NODE_PLATFORM="linux-x64"; NODE_ARCHIVE_EXT="tar.xz" ;;
    *) fail "Automatic Node.js setup does not support $SYSTEM/$MACHINE. Install Node.js 22.13 or newer from https://nodejs.org/ and rerun this command." ;;
  esac

  NODE_ARCHIVE="node-${NODE_VERSION}-${NODE_PLATFORM}.${NODE_ARCHIVE_EXT}"
  NODE_HOME="$HOME/.local/share/jobpilot/node-${NODE_VERSION}"
  mkdir -p "$NODE_HOME"
  curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/${NODE_ARCHIVE}" -o "$NODE_HOME/$NODE_ARCHIVE"
  if [[ "$NODE_ARCHIVE_EXT" == "tar.xz" ]]; then
    tar -xJf "$NODE_HOME/$NODE_ARCHIVE" -C "$NODE_HOME" --strip-components=1
  else
    tar -xzf "$NODE_HOME/$NODE_ARCHIVE" -C "$NODE_HOME" --strip-components=1
  fi
  rm -f "$NODE_HOME/$NODE_ARCHIVE"
  export PATH="$NODE_HOME/bin:$PATH"
fi

node_is_supported || fail "Node.js 22.13+ and npm are required. Install them from https://nodejs.org/ and rerun this command."

# Ollama's installer is run only after an explicit confirmation because it adds
# software to the computer. Its official installer may request administrator access.
if ! command -v ollama >/dev/null 2>&1; then
  say "Ollama is needed to run the local AI models."
  if [[ ! -r /dev/tty ]]; then
    fail "Open https://ollama.com/download, install Ollama, then rerun this command."
  fi
  printf 'Install Ollama using its official installer now? [y/N] '
  INSTALL_OLLAMA=""
  IFS= read -r INSTALL_OLLAMA </dev/tty || true
  [[ "$INSTALL_OLLAMA" =~ ^[Yy]$ ]] || fail "Install Ollama from https://ollama.com/download, then rerun this command."
  curl -fsSL https://ollama.com/install.sh | sh
  export PATH="$HOME/.ollama/bin:$PATH"
  command -v ollama >/dev/null 2>&1 || fail "Ollama was installed but its command is not available in this terminal. Restart Terminal and rerun this command."
fi

# Start the local Ollama service if the app/daemon is not already responding.
if ! curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  say "Starting Ollama"
  if [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1 && [[ -d "/Applications/Ollama.app" ]]; then
    open -a Ollama >/dev/null 2>&1 || true
  else
    nohup ollama serve >"$HOME/.jobpilot-ollama.log" 2>&1 </dev/null &
  fi
  for ((attempt = 0; attempt < 60; attempt++)); do
    curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break
    sleep 1
  done
fi
curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 || fail "Ollama did not start. Open the Ollama app, wait for it to finish starting, and rerun this command."

model_installed() {
  ollama list 2>/dev/null | awk -v wanted="$1" 'NR > 1 && $1 == wanted { found=1 } END { exit !found }'
}

say "Checking local models. The suggested models need several gigabytes of free disk space on first download."
if ! model_installed "$CHAT_MODEL"; then
  say "Downloading chat model: $CHAT_MODEL"
  ollama pull "$CHAT_MODEL"
fi
if ! model_installed "$DECISION_MODEL"; then
  say "Downloading decision model: $DECISION_MODEL"
  ollama pull "$DECISION_MODEL"
fi

cd "$PROJECT_DIR"
if [[ ! -f .env.local && -f .env.example ]]; then
  cp .env.example .env.local
fi

say "Installing the exact project dependencies from package-lock.json"
npm ci

say "Starting Jobpilot. Keep this terminal open, then visit http://localhost:3000"
npm run dev

#!/bin/sh
set -eu

AERYX_DIR="${AERYX_DIR:-$HOME/.aeryx}"
AERYX_SOURCE="${AERYX_SOURCE:-}"
DEV_SOURCE="https://github.com/dracoder/aery-ai/archive/refs/heads/main.tar.gz"
AERYX_RELEASE="${AERYX_RELEASE:-https://github.com/dracoder/aery-ai/releases/latest/download}"
AERYX_APP_DIR="${AERYX_APP_DIR:-$HOME/Applications}"
NODE_VERSION="20.19.1"
RELEASE_KEYS="BrGv7gJgfFwCNYb+Bv1SHoBiVkkIHLUvzhuQT4RC05Q="
want_app="${AERYX_APP:-}"
for arg in "$@"; do
  case "$arg" in
    --app) want_app=1 ;;
    *) printf 'aeryx install: unknown option %s\n' "$arg" >&2; exit 1 ;;
  esac
done

say() { printf '%s\n' "$*"; }
die() { printf 'aeryx install: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
need curl
need tar

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported system $(uname -s) — on Windows use install.ps1" ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=x64 ;;
  *) die "unsupported CPU $(uname -m)" ;;
esac

if command -v sha256sum >/dev/null 2>&1; then sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else die "sha256sum or shasum is required"; fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

release_sums() {
  [ -s "$tmp/SHA256SUMS" ] && return 0
  curl -fsSL "$AERYX_RELEASE/SHA256SUMS" -o "$tmp/SHA256SUMS.part" 2>/dev/null || return 1
  curl -fsSL "$AERYX_RELEASE/SHA256SUMS.sig" -o "$tmp/SHA256SUMS.sig" 2>/dev/null || die "the release has no signature, so nothing was installed"
  cat > "$tmp/verify.js" <<'JS'
const [keys,file,sigFile]=process.argv.slice(2);const c=require('crypto'),fs=require('fs');const data=fs.readFileSync(file),sig=Buffer.from(fs.readFileSync(sigFile,'utf8').trim(),'base64');process.exit(keys.split(',').some((k)=>c.verify(null,data,c.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(k,'base64')]),format:'der',type:'spki'}),sig))?0:1);
JS
  "$AERYX_DIR/node/bin/node" "$tmp/verify.js" "$RELEASE_KEYS" "$tmp/SHA256SUMS.part" "$tmp/SHA256SUMS.sig" || die "the release signature is not valid, so nothing was installed"
  mv "$tmp/SHA256SUMS.part" "$tmp/SHA256SUMS"
}
verified() {
  expected="$(grep " $1\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  [ -n "$expected" ] && [ "$(sha "$2")" = "$expected" ]
}

install_app() {
  if [ "$os" != darwin ]; then
    say "The Linux desktop app is coming soon — the web version is installed and has everything."
    return 0
  fi
  asset="Aeryx-macos-universal.app.tar.gz"
  say "Downloading the Aeryx desktop app…"
  if ! release_sums || ! curl -fsSL "$AERYX_RELEASE/$asset" -o "$tmp/$asset"; then
    say "The desktop app is not released yet — the web version is installed."
    return 0
  fi
  verified "$asset" "$tmp/$asset" || die "the desktop app download failed its checksum"
  mkdir -p "$AERYX_APP_DIR"
  rm -rf "$AERYX_APP_DIR/Aeryx.app"
  tar -xzf "$tmp/$asset" -C "$AERYX_APP_DIR"
  [ -d "$AERYX_APP_DIR/Aeryx.app" ] || die "the desktop app archive did not contain Aeryx.app"
  app_installed=1
  printf '%s\n' "$AERYX_APP_DIR/Aeryx.app" > "$AERYX_DIR/.aeryx-app"
  say "Installed $AERYX_APP_DIR/Aeryx.app"
}

open_aeryx() {
  if [ -n "${app_installed:-}" ]; then
    "$AERYX_DIR/bin/aeryx" start --no-open
    [ "${AERYX_NO_OPEN:-}" = 1 ] || open "$AERYX_APP_DIR/Aeryx.app"
  else
    "$AERYX_DIR/bin/aeryx" start
  fi
}

if [ -e "$AERYX_DIR/app/scripts/aeryx-cli.mjs" ]; then
  say "Aeryx is already installed in $AERYX_DIR — updating instead."
  AERYX_SOURCE="$AERYX_SOURCE" "$AERYX_DIR/bin/aeryx" update
  if [ -n "$want_app" ]; then
    install_app
    open_aeryx
  fi
  exit 0
fi
if [ -e "$AERYX_DIR" ] && [ ! -e "$AERYX_DIR/.aeryx-install" ] && [ -n "$(ls -A "$AERYX_DIR" 2>/dev/null)" ]; then
  die "$AERYX_DIR exists and is not an Aeryx install — set AERYX_DIR to another folder"
fi

mkdir -p "$AERYX_DIR"
: > "$AERYX_DIR/.aeryx-install"

pkg="node-v$NODE_VERSION-$os-$arch"
say "Downloading Node $NODE_VERSION ($os-$arch)…"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$pkg.tar.gz" -o "$tmp/node.tar.gz"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
expected="$(grep " $pkg.tar.gz\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
[ -n "$expected" ] && [ "$(sha "$tmp/node.tar.gz")" = "$expected" ] || die "Node download failed its checksum"
rm -rf "$AERYX_DIR/node" && mkdir -p "$AERYX_DIR/node"
tar -xzf "$tmp/node.tar.gz" -C "$AERYX_DIR/node" --strip-components=1

say "Fetching Aeryx…"
mkdir -p "$AERYX_DIR/app"
if [ -d "$AERYX_SOURCE" ]; then
  (cd "$AERYX_SOURCE" && tar -cf - --exclude=./node_modules --exclude=./lair/node_modules --exclude=./.git --exclude=./dist \
    --exclude=./data --exclude=./backups --exclude=./secrets .) | tar -xf - -C "$AERYX_DIR/app"
elif [ -z "$AERYX_SOURCE" ]; then
  if release_sums && curl -fsSL "$AERYX_RELEASE/aeryx-source.tar.gz" -o "$tmp/aeryx.tar.gz" 2>/dev/null; then
    verified aeryx-source.tar.gz "$tmp/aeryx.tar.gz" || die "the Aeryx source failed its checksum"
  else
    say "No release yet — installing the development branch."
    curl -fsSL "$DEV_SOURCE" -o "$tmp/aeryx.tar.gz"
  fi
  tar -xzf "$tmp/aeryx.tar.gz" -C "$AERYX_DIR/app" --strip-components=1
else
  case "$AERYX_SOURCE" in
    https://*) curl -fsSL "$AERYX_SOURCE" -o "$tmp/aeryx.tar.gz"; archive="$tmp/aeryx.tar.gz" ;;
    *) archive="$AERYX_SOURCE" ;;
  esac
  tar -xzf "$archive" -C "$AERYX_DIR/app" --strip-components=1
fi

mkdir -p "$AERYX_DIR/bin"
shq() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
printf '#!/bin/sh\nexec %s %s "$@"\n' "$(shq "$AERYX_DIR/node/bin/node")" "$(shq "$AERYX_DIR/app/scripts/aeryx-cli.mjs")" > "$AERYX_DIR/bin/aeryx"
chmod +x "$AERYX_DIR/bin/aeryx"

"$AERYX_DIR/bin/aeryx" setup

on_path=""
case ":$PATH:" in *":$HOME/.local/bin:"*) on_path=1 ;; esac
if [ -n "$on_path" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$AERYX_DIR/bin/aeryx" "$HOME/.local/bin/aeryx"
  hint="aeryx"
else
  hint="$AERYX_DIR/bin/aeryx"
fi

[ -z "$want_app" ] || install_app
open_aeryx

say ""
say "Aeryx is installed. Useful commands:"
say "  $hint status | stop | start | update | autostart on | uninstall"
[ -n "$on_path" ] || say "Add it to your PATH:  echo 'export PATH=\"$AERYX_DIR/bin:\$PATH\"' >> ~/.zshrc"

#!/usr/bin/env bash
set -euo pipefail

REPO="townsworld/openclaw-watchtower"
PLUGIN_NAME="openclaw-watchtower"
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"

# ── Parse arguments ──────────────────────────────────────────────────────────
UPGRADE_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --upgrade|-u) UPGRADE_ONLY=true ;;
  esac
done

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
step()    { echo -e "\n${BLUE}══${NC} $* ${BLUE}══${NC}"; }

# ── Helpers ──────────────────────────────────────────────────────────────────
command_exists() { command -v "$1" &>/dev/null; }

HAS_TTY=false
(echo '' >/dev/null </dev/tty) 2>/dev/null && HAS_TTY=true

ask() {
  local prompt="$1" var="$2"
  if [[ "$HAS_TTY" == "true" ]]; then
    read -rp "$prompt" "$var" </dev/tty
  else
    printf '%s' "$prompt"
    read -r "$var" || eval "$var=''"
  fi
}

ask_secret() {
  local prompt="$1" var="$2"
  if [[ "$HAS_TTY" == "true" ]]; then
    read -rsp "$prompt" "$var" </dev/tty
    echo ""
  else
    printf '%s' "$prompt"
    read -r "$var" || eval "$var=''"
  fi
}

# ── Step 1: Check OpenClaw ────────────────────────────────────────────────────
step "Checking OpenClaw"
if ! command_exists openclaw; then
  error "OpenClaw not found. Please install it first:"
  echo "  curl -fsSL https://openclaw.dev/install.sh | bash"
  exit 1
fi
success "OpenClaw found: $(which openclaw)"

# ── Step 2: Download & install plugin files ───────────────────────────────────
step "Installing ${PLUGIN_NAME} plugin"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

EXTENSIONS_DIR="$HOME/.openclaw/extensions"
INSTALL_DIR="$EXTENSIONS_DIR/${PLUGIN_NAME}"
PLUGIN_TGZ="$TMP_DIR/${PLUGIN_NAME}.tgz"

OLD_VERSION=""
if [[ -f "$INSTALL_DIR/package.json" ]]; then
  OLD_VERSION=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$INSTALL_DIR/package.json','utf8')).version)}catch{}" 2>/dev/null || true)
fi

info "Fetching latest release info..."
RELEASE_JSON="$TMP_DIR/release.json"
DOWNLOAD_OK=false

for attempt in 1 2 3; do
  if curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" -o "$RELEASE_JSON" 2>/dev/null; then
    RELEASE_URL=$(node -e "
      const r=JSON.parse(require('fs').readFileSync('$RELEASE_JSON','utf8'));
      const a=r.assets?.find(a=>a.name.endsWith('.tgz'));
      if(a) console.log(a.browser_download_url);
    " 2>/dev/null)
    NEW_VERSION=$(node -e "
      const r=JSON.parse(require('fs').readFileSync('$RELEASE_JSON','utf8'));
      console.log((r.tag_name||'').replace(/^v/,''));
    " 2>/dev/null)

    if [[ -n "$RELEASE_URL" ]]; then
      if [[ -n "$OLD_VERSION" && -n "$NEW_VERSION" && "$OLD_VERSION" == "$NEW_VERSION" ]]; then
        success "Already on latest version v${NEW_VERSION}"
        if [[ "$HAS_TTY" == "true" ]]; then
          ask "  Re-install anyway? (y/N): " REINSTALL
          if [[ "$REINSTALL" != "y" && "$REINSTALL" != "Y" ]]; then
            DOWNLOAD_OK="skip"
            break
          fi
        else
          DOWNLOAD_OK="skip"
          break
        fi
      fi

      info "Downloading v${NEW_VERSION:-latest}..."
      if curl -fsSL -L "$RELEASE_URL" -o "$PLUGIN_TGZ"; then
        DOWNLOAD_OK=true
        break
      fi
    fi
  fi
  warn "Attempt $attempt failed, retrying..."
  sleep 2
done

if [[ "$DOWNLOAD_OK" == "skip" ]]; then
  info "Plugin files unchanged."
elif [[ "$DOWNLOAD_OK" == "true" ]]; then
  mkdir -p "$EXTENSIONS_DIR"
  [[ -d "$INSTALL_DIR" ]] && rm -rf "$INSTALL_DIR"
  mkdir -p "$INSTALL_DIR"
  tar -xzf "$PLUGIN_TGZ" -C "$INSTALL_DIR" --strip-components=1
  success "Plugin files installed to $INSTALL_DIR"
else
  error "Failed to download release after 3 attempts."
  error "Check your network or download manually: https://github.com/${REPO}/releases"
  exit 1
fi

# ── Step 3: Sentry Configuration ──────────────────────────────────────────────
SENTRY_BASE_URL=""
SENTRY_AUTH_TOKEN=""
SENTRY_ORG=""
SENTRY_PROJECTS=""
SENTRY_LOOKBACK=""

if [[ "$UPGRADE_ONLY" == "true" ]]; then
  info "Upgrade mode: skipping Sentry configuration."
elif [[ "$HAS_TTY" == "true" ]]; then
  step "Sentry Configuration"

  # Check if already configured
  EXISTING_SENTRY=""
  if [[ -f "$OPENCLAW_JSON" ]]; then
    EXISTING_SENTRY=$(node -e "
      try {
        const c=JSON.parse(require('fs').readFileSync('$OPENCLAW_JSON','utf8'));
        const s=c?.plugins?.entries?.['${PLUGIN_NAME}']?.config?.sentry;
        if(s?.baseUrl && s?.org) console.log('yes');
      } catch{}
    " 2>/dev/null || true)
  fi

  if [[ "$EXISTING_SENTRY" == "yes" ]]; then
    echo ""
    echo "  Sentry is already configured."
    echo "    [1] Keep current config"
    echo "    [2] Re-configure"
    ask "  Select (1/2): " SENTRY_CHOICE
    [[ "$SENTRY_CHOICE" != "2" ]] && SENTRY_CHOICE="skip"
  else
    SENTRY_CHOICE="configure"
  fi

  if [[ "$SENTRY_CHOICE" != "skip" ]]; then
    echo ""
    echo -e "  ${BOLD}Sentry API Configuration${NC}"
    echo ""
    echo "  You'll need:"
    echo "    - Sentry base URL (e.g. https://sentry.io or your self-hosted URL)"
    echo "    - Auth Token (Settings > Auth Tokens, scopes: project:read + event:read)"
    echo "    - Organization slug"
    echo "    - Project slugs to monitor"
    echo ""

    ask "  Sentry base URL [https://sentry.io]: " SENTRY_BASE_URL
    [[ -z "$SENTRY_BASE_URL" ]] && SENTRY_BASE_URL="https://sentry.io"

    ask_secret "  Auth Token: " SENTRY_AUTH_TOKEN
    if [[ -z "$SENTRY_AUTH_TOKEN" ]]; then
      warn "No auth token provided. You can configure it later in openclaw.json"
    fi

    ask "  Organization slug: " SENTRY_ORG
    if [[ -z "$SENTRY_ORG" ]]; then
      warn "No org provided. You can configure it later in openclaw.json"
    fi

    echo ""
    echo "  Enter project slugs to monitor (comma-separated)."
    echo "  Example: backend,api-gateway,web-app"
    ask "  Projects: " SENTRY_PROJECTS
    if [[ -z "$SENTRY_PROJECTS" ]]; then
      warn "No projects provided. You can configure them later in openclaw.json"
    fi

    echo ""
    ask "  Lookback window in minutes [15]: " SENTRY_LOOKBACK
    [[ -z "$SENTRY_LOOKBACK" ]] && SENTRY_LOOKBACK="15"

    echo ""
    if [[ -n "$SENTRY_AUTH_TOKEN" && -n "$SENTRY_ORG" ]]; then
      # Quick connectivity test
      info "Testing Sentry API connection..."
      TEST_URL="${SENTRY_BASE_URL}/api/0/organizations/${SENTRY_ORG}/"
      HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
        "$TEST_URL" 2>/dev/null || echo "000")
      if [[ "$HTTP_CODE" == "200" ]]; then
        success "Sentry API connection OK (org: ${SENTRY_ORG})"
      elif [[ "$HTTP_CODE" == "401" ]]; then
        warn "Auth failed (HTTP 401). Check your token."
      elif [[ "$HTTP_CODE" == "404" ]]; then
        warn "Org not found (HTTP 404). Check your org slug."
      else
        warn "Sentry API returned HTTP ${HTTP_CODE}. Check your config."
      fi
    fi
  fi
else
  info "Non-interactive mode. Configure Sentry in ~/.openclaw/openclaw.json manually."
fi

# ── Step 4: Write config to openclaw.json ─────────────────────────────────────
step "Configuring plugin"

if [[ -f "$OPENCLAW_JSON" ]]; then
  SENTRY_BASE_URL_ENV="$SENTRY_BASE_URL" \
  SENTRY_AUTH_TOKEN_ENV="$SENTRY_AUTH_TOKEN" \
  SENTRY_ORG_ENV="$SENTRY_ORG" \
  SENTRY_PROJECTS_ENV="$SENTRY_PROJECTS" \
  SENTRY_LOOKBACK_ENV="$SENTRY_LOOKBACK" \
  PLUGIN_NAME_ENV="$PLUGIN_NAME" \
  node --input-type=module <<'NODEJS'
import { readFileSync, writeFileSync } from 'fs';

const path = process.env.HOME + '/.openclaw/openclaw.json';
let cfg;
try {
  cfg = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error('Failed to parse openclaw.json:', e.message);
  process.exit(1);
}

const pluginName = process.env.PLUGIN_NAME_ENV;

cfg.plugins = cfg.plugins ?? {};
cfg.plugins.allow = cfg.plugins.allow ?? [];
cfg.plugins.entries = cfg.plugins.entries ?? {};

if (!cfg.plugins.allow.includes(pluginName)) {
  cfg.plugins.allow.push(pluginName);
}

const entry = cfg.plugins.entries[pluginName] ?? { enabled: true, config: {} };
entry.enabled = true;
entry.config = entry.config ?? {};

const baseUrl = process.env.SENTRY_BASE_URL_ENV;
const authToken = process.env.SENTRY_AUTH_TOKEN_ENV;
const org = process.env.SENTRY_ORG_ENV;
const projects = process.env.SENTRY_PROJECTS_ENV;
const lookback = process.env.SENTRY_LOOKBACK_ENV;

if (baseUrl || authToken || org || projects) {
  entry.config.sentry = entry.config.sentry ?? {};
  if (baseUrl) entry.config.sentry.baseUrl = baseUrl;
  if (authToken) entry.config.sentry.authToken = authToken;
  if (org) entry.config.sentry.org = org;
  if (projects) {
    entry.config.sentry.projects = projects.split(',').map(p => p.trim()).filter(Boolean);
  }
  if (lookback && !isNaN(Number(lookback))) {
    entry.config.sentry.lookbackMinutes = Number(lookback);
  }
  console.log('Sentry config saved (org: ' + (org || 'not set') + ', projects: ' + (projects || 'not set') + ')');
}

cfg.plugins.entries[pluginName] = entry;
writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
console.log('Config updated: allow-list + plugin entry');
NODEJS
  success "Plugin configured"
else
  warn "openclaw.json not found at $OPENCLAW_JSON, skipping config"
fi

# ── Step 5: Restart Gateway ───────────────────────────────────────────────────
if [[ "$DOWNLOAD_OK" != "skip" || "$SENTRY_CHOICE" != "skip" ]]; then
  step "Restarting Gateway"
  if command_exists openclaw; then
    openclaw gateway restart 2>/dev/null || true
    success "Gateway restarted"
  else
    warn "Run 'openclaw gateway restart' to load the updated plugin."
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
if [[ "$UPGRADE_ONLY" == "true" ]]; then
  echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  openclaw-watchtower upgraded successfully!          ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
else
  echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  openclaw-watchtower installed successfully!         ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo "Usage:"
  echo "  /patrol              — run a quick patrol across all projects"
  echo "  /patrol status       — check last patrol time"
  echo "  /patrol cleanup      — clean up old state entries"
  echo ""
  echo "The watchtower_sentry tool is now available for AI-driven patrol."
  echo "Set up a Cron job to automate periodic patrols."
fi
echo ""

#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="openclaw-watchtower"
OPENCLAW_JSON="$HOME/.openclaw/openclaw.json"
INSTALL_DIR="$HOME/.openclaw/extensions/${PLUGIN_NAME}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()    { echo -e "\n${BLUE}══${NC} $* ${BLUE}══${NC}"; }

step "Uninstalling ${PLUGIN_NAME}"

if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  success "Removed plugin files: $INSTALL_DIR"
else
  info "Plugin directory not found, skipping."
fi

if [[ -f "$OPENCLAW_JSON" ]]; then
  PLUGIN_NAME_ENV="$PLUGIN_NAME" node --input-type=module <<'NODEJS'
import { readFileSync, writeFileSync } from 'fs';

const path = process.env.HOME + '/.openclaw/openclaw.json';
const pluginName = process.env.PLUGIN_NAME_ENV;
let cfg;
try {
  cfg = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error('Failed to parse openclaw.json:', e.message);
  process.exit(0);
}

if (cfg.plugins?.allow) {
  cfg.plugins.allow = cfg.plugins.allow.filter(n => n !== pluginName);
}
if (cfg.plugins?.entries?.[pluginName]) {
  delete cfg.plugins.entries[pluginName];
}

writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
console.log('Removed plugin from openclaw.json');
NODEJS
  success "Removed plugin config from openclaw.json"
fi

# Remove state file
STATE_FILE="$HOME/.openclaw/workspace/watchtower-state.json"
if [[ -f "$STATE_FILE" ]]; then
  rm -f "$STATE_FILE"
  success "Removed state file: $STATE_FILE"
fi

step "Restarting Gateway"
if command -v openclaw &>/dev/null; then
  openclaw gateway restart 2>/dev/null || true
  success "Gateway restarted"
else
  warn "Run 'openclaw gateway restart' to apply changes."
fi

echo ""
echo -e "${GREEN}openclaw-watchtower uninstalled successfully.${NC}"
echo ""

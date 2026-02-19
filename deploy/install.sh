#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/openclaw-panel"
CONFIG_DIR="/etc/openclaw-panel"
SERVICE_FILE="/etc/systemd/system/openclaw-panel.service"

if ! command -v node >/dev/null 2>&1; then
  echo "node 未安装，请先安装 Node.js 22+"
  exit 1
fi

mkdir -p "$APP_DIR"
mkdir -p "$CONFIG_DIR"

cp -r ./* "$APP_DIR"/
cd "$APP_DIR"
npm install --omit=dev

if [ ! -f "$CONFIG_DIR/panel.config.json" ]; then
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_DIR/panel.config.json" <<EOF
{
  "panel": {
    "listen_host": "127.0.0.1",
    "listen_port": 18080,
    "container_name": "openclaw-panel",
    "image_repo": "ghcr.io/bianshumeng/openclaw-panel"
  },
  "reverse_proxy": {
    "enabled": false,
    "public_scheme": "http",
    "public_host": "",
    "panel_public_port": 18080,
    "gateway_public_port": 18789,
    "panel_public_base_url": "",
    "webhook_public_base_url": ""
  },
  "openclaw": {
    "config_path": "~/.openclaw/openclaw.json",
    "service_name": "openclaw-gateway",
    "container_name": "openclaw-gateway",
    "image_repo": "ghcr.io/bianshumeng/openclaw-mymy",
    "gateway_port": 18789,
    "gateway_ws_url": ""
  },
  "update": {
    "github_token": "",
    "bot_release_repo": "openclaw/openclaw",
    "panel_release_repo": "Bianshumeng/openclaw-panel-public",
    "panel_service_name": "openclaw-panel",
    "panel_app_dir": "/opt/openclaw-panel"
  },
  "log": {
    "source": "journal",
    "file_path": "~/.openclaw/logs/gateway.log"
  }
}
EOF
  chmod 600 "$CONFIG_DIR/panel.config.json"
fi

cp "$APP_DIR/deploy/openclaw-panel.service" "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable openclaw-panel
systemctl restart openclaw-panel
systemctl status openclaw-panel --no-pager -n 20

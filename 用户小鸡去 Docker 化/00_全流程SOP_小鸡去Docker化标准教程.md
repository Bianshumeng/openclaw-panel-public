# 00_全流程SOP_小鸡去Docker化标准教程

最后更新：2026-02-20

## 0. 先说结论（给执行 AI）
1. 每个窗口开始前，必须先读完本文件，再读目标机器对应的迁移记录。
2. 只要给出机器序号（`vmid`）和机器内网 IP，就按本 SOP 从上到下执行。
3. 绝对禁止跳过“精准备份”和“停 Docker 不删”。
4. 验收没通过前，禁止删除 Docker 容器/镜像。

## 1. 这件事的背景与目标

### 背景
1. 现有用户小鸡历史上使用 Docker 版 OpenClaw（gateway + panel）。
2. 当前目标是统一迁移到直装模式，减少 Docker 路径耦合，并对齐官方默认文件结构。
3. 用户不能感知“系统换底层”，即迁移后应保持历史数据、配置和使用体验连续。

### 核心目标
1. 龙虾 Bot 去 Docker 化：改为直装并以 root 权限运行。
2. 可视化配置页面去 Docker 化：改为直装并继续可用。
3. 数据精准迁移：历史会话、记忆、用户文件、脚本都保留。
4. 用户可开机即用：管理入口、网关入口、配置保存都正常。

### 非目标（本阶段不做）
1. 不改 SSH 策略（禁密码登录等后续再做）。
2. 不改业务端口池策略（每台 50 端口块保持原样）。
3. 不做 Bot 其他功能改造（仅做去 Docker 化核心链路）。

## 2. 并行执行纪律（多窗口必须遵守）
1. 并行上限：建议同时 2 台，最多 3 台。
2. 一台机器同一时刻只能被一个窗口操作。
3. 共享资源（NAT 规则、端口池、Bot 台账）串行提交，不并行改。
4. 任意一台验收失败，其他窗口暂停“删 Docker”步骤。

## 3. 输入参数（执行前先填）
| 参数 | 含义 | 示例 |
|---|---|---|
| `VMID` | 小鸡编号 | `102` |
| `VM_IP` | 小鸡内网 IP | `10.10.10.11` |
| `NODE_SSH` | 母机 SSH | `root@135.181.162.231` |
| `PANEL_RELEASE_TAG` | 面板发布版本 | `v2026.02.20-r4` |
| `PANEL_RELEASE_REPO` | 面板公开仓库 | `Bianshumeng/openclaw-panel-public` |

补充规则：
1. 管理入口端口不要猜，优先查 Bot 台账或母机 `iptables -t nat -S`。
2. 本 SOP 默认沿用已有端口映射：
   - 外层 `18080 -> 28080`（panel）
   - 外层 `18789 -> 28789`（gateway）

## 4. 执行总流程（固定顺序）
1. 阶段 A：迁移前扫描（只读）
2. 阶段 B：精准备份 + 校验
3. 阶段 C：停 Docker（不删）
4. 阶段 D：安装直装 OpenClaw（确保 `node` + `openclaw` 可用）
5. 阶段 E：迁移数据到官方默认目录（`/root/.openclaw`）
6. 阶段 F：部署直装 panel（`/opt/openclaw-panel`）
7. 阶段 G：创建并启用 systemd 服务（gateway + panel）
8. 阶段 H：链路验收（端口、接口、数据）
9. 阶段 I：用户验收通过后，才执行删 Docker

## 5. 标准命令模板（可直接替换参数执行）

### 5.1 迁移前扫描（只读）
```bash
# 在母机执行（可通过 ssh 或 MCP 执行）
qm status <VMID>
qm config <VMID>

qm guest exec <VMID> -- /bin/bash -lc '
set -e
hostname
cat /etc/os-release | sed -n "1,8p"
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true
docker ps -a --format "table {{.Names}}\t{{.Status}}" || true
for p in /data/openclaw /data/panel /opt/openclaw /root/.openclaw; do
  [ -e "$p" ] && ls -ld "$p" || echo "missing:$p"
done
ss -lntp | egrep ":18080|:18789|:28080|:28789|:22 " || true
'
```

### 5.2 精准备份（必须）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
set -euo pipefail
TS=$(date +%F_%H%M%S)
BK=/root/migrate-backup-<VMID>-$TS
mkdir -p "$BK"

tar -C / -czf "$BK/data-openclaw.tgz" data/openclaw
tar -C / -czf "$BK/data-panel.tgz" data/panel
tar -C / -czf "$BK/opt-openclaw.tgz" opt/openclaw
if [ -f /root/OPENCLAW_WEB_LOGIN.txt ]; then
  tar -C / -czf "$BK/root-ssh.tgz" root/.ssh root/OPENCLAW_WEB_LOGIN.txt
else
  tar -C / -czf "$BK/root-ssh.tgz" root/.ssh
fi
sha256sum "$BK"/*.tgz > "$BK/SHA256SUMS.txt"
echo "$BK"
'
```

校验：
```bash
qm guest exec <VMID> -- /bin/bash -lc '
BK=<上一步输出目录>
cd "$BK"
sha256sum -c SHA256SUMS.txt
for f in *.tgz; do tar -tzf "$f" >/dev/null; done
'
```

### 5.3 停 Docker（不删）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
set -euo pipefail
cd /opt/openclaw
docker compose stop
docker ps --format "table {{.Names}}\t{{.Status}}"
docker ps -a --format "table {{.Names}}\t{{.Status}}"
'
```

### 5.4 安装直装 OpenClaw（补齐 node 运行时）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
set -e
export HOME=/root
curl -fsSL https://openclaw.ai/install.sh | bash
command -v node
node -v
command -v openclaw
openclaw --version
'
```

### 5.5 数据迁移到官方默认目录
```bash
qm guest exec <VMID> -- /bin/bash -lc '
set -e
RUN_USER=root
RUN_HOME=$(getent passwd "$RUN_USER" | cut -d: -f6)
TARGET_DIR="$RUN_HOME/.openclaw"
mkdir -p "$TARGET_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -aHAX --delete /data/openclaw/ "$TARGET_DIR/"
else
  rm -rf "$TARGET_DIR"/*
  cp -a /data/openclaw/. "$TARGET_DIR/"
fi
chown -R "$RUN_USER":"$RUN_USER" "$TARGET_DIR"
ls -la "$TARGET_DIR" | head -n 40
'
```

### 5.6 修正网关端口（对齐 Nginx 18789 -> 28789）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
python3 - <<\"PY\"
import json, time
p="/root/.openclaw/openclaw.json"
bak="%s.bak.%s" % (p, time.strftime("%Y%m%d%H%M%S"))
cfg=json.load(open(p,encoding="utf-8"))
open(bak,"w",encoding="utf-8").write(json.dumps(cfg,ensure_ascii=False,indent=2)+"\n")
gw=cfg.setdefault("gateway",{})
gw["port"]=28789
gw["bind"]=gw.get("bind") or "loopback"
gw["mode"]=gw.get("mode") or "remote"
remote=gw.setdefault("remote",{})
remote["url"]="ws://127.0.0.1:28789"
ctrl=gw.setdefault("controlUi",{})
origins=ctrl.get("allowedOrigins") or []
for u in ["http://127.0.0.1:18789","http://localhost:18789"]:
    if u not in origins:
        origins.append(u)
ctrl["allowedOrigins"]=origins
open(p,"w",encoding="utf-8").write(json.dumps(cfg,ensure_ascii=False,indent=2)+"\n")
print("backup", bak)
PY
chmod 600 /root/.openclaw/openclaw.json
'
```

### 5.7 部署直装 panel（公开仓库 release）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
set -euo pipefail
TAG=<PANEL_RELEASE_TAG>
APP_DIR=/opt/openclaw-panel
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT
curl -fsSL "https://api.github.com/repos/<PANEL_RELEASE_REPO>/tarball/${TAG}" -o "$TMP_DIR/panel.tar.gz"
tar -xzf "$TMP_DIR/panel.tar.gz" -C "$TMP_DIR"
SRC_DIR=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)
mkdir -p "$APP_DIR"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude ".git" --exclude "node_modules" --exclude ".runtime" "$SRC_DIR"/ "$APP_DIR"/
else
  find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name ".runtime" -exec rm -rf {} +
  cp -a "$SRC_DIR"/. "$APP_DIR"/
fi
cd "$APP_DIR"
npm install --omit=dev
cat > "$APP_DIR/.panel-release.json" <<JSON
{
  "tag": "${TAG}",
  "releaseRepo": "<PANEL_RELEASE_REPO>",
  "appliedAt": "$(date -Iseconds)"
}
JSON
'
```

### 5.8 生成 panel 配置（直装模式）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
mkdir -p /etc/openclaw-panel
python3 - <<\"PY\"
import json, os
src="/data/panel/panel.config.json"
dst="/etc/openclaw-panel/panel.config.json"
cfg=json.load(open(src,encoding="utf-8")) if os.path.exists(src) else {}
cfg["runtime"]={"mode":"systemd"}
panel=cfg.setdefault("panel",{})
panel["listen_host"]="127.0.0.1"
panel["listen_port"]=28080
openclaw=cfg.setdefault("openclaw",{})
openclaw["config_path"]="/root/.openclaw/openclaw.json"
openclaw["service_name"]="openclaw-gateway"
openclaw["gateway_port"]=28789
openclaw["gateway_ws_url"]=""
cfg.setdefault("docker",{})["enabled"]=False
log=cfg.setdefault("log",{})
log["source"]="journal"
log.setdefault("file_path","/root/.openclaw/logs/gateway.log")
upd=cfg.setdefault("update",{})
upd.setdefault("github_token","")
upd["bot_release_repo"]="openclaw/openclaw"
upd["panel_release_repo"]="<PANEL_RELEASE_REPO>"
upd["panel_service_name"]="openclaw-panel"
upd["panel_app_dir"]="/opt/openclaw-panel"
open(dst,"w",encoding="utf-8").write(json.dumps(cfg,ensure_ascii=False,indent=2)+"\n")
PY
chmod 600 /etc/openclaw-panel/panel.config.json
'
```

### 5.9 systemd 服务创建与启用
```bash
qm guest exec <VMID> -- /bin/bash -lc '
cat > /etc/systemd/system/openclaw-gateway.service <<\"UNIT\"
[Unit]
Description=OpenClaw Gateway (Direct Install)
After=network.target

[Service]
Type=simple
User=root
Environment=HOME=/root
WorkingDirectory=/root
ExecStart=/usr/bin/openclaw gateway run --bind loopback --port 28789 --allow-unconfigured
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/openclaw-panel.service <<\"UNIT\"
[Unit]
Description=OpenClaw Visual Panel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/openclaw-panel
ExecStart=/usr/bin/node /opt/openclaw-panel/src/server.js
Restart=always
RestartSec=3
Environment=PANEL_CONFIG_PATH=/etc/openclaw-panel/panel.config.json

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now openclaw-gateway
systemctl enable --now openclaw-panel
systemctl is-active openclaw-gateway
systemctl is-active openclaw-panel
'
```

### 5.10 验收（必须）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
set -e
ss -lntp | egrep ":28080|:28789|:18080|:18789" || true
curl -s -o /dev/null -w "panel-direct:%{http_code}\n" http://127.0.0.1:28080/
curl -s -o /dev/null -w "gateway-direct:%{http_code}\n" http://127.0.0.1:28789/
curl -s -o /dev/null -w "panel-front:%{http_code}\n" http://127.0.0.1:18080/
curl -s -o /dev/null -w "gateway-front:%{http_code}\n" http://127.0.0.1:18789/
curl -sS http://127.0.0.1:28080/api/update/check?target=bot | head -c 300; echo
curl -sS http://127.0.0.1:28080/api/update/check?target=panel | head -c 300; echo
'
```

用户资产抽样一致性：
```bash
qm guest exec <VMID> -- /bin/bash -lc '
echo source_sessions:$(find /data/openclaw/agents/main/sessions -type f 2>/dev/null | wc -l)
echo target_sessions:$(find /root/.openclaw/agents/main/sessions -type f 2>/dev/null | wc -l)
echo source_workspace:$(find /data/openclaw/workspace -type f 2>/dev/null | wc -l)
echo target_workspace:$(find /root/.openclaw/workspace -type f 2>/dev/null | wc -l)
'
```

## 6. 删 Docker 收尾（仅在验收通过后）
```bash
qm guest exec <VMID> -- /bin/bash -lc '
set -e
cd /opt/openclaw
docker compose down --remove-orphans
docker image prune -f
docker ps -a --format "table {{.Names}}\t{{.Status}}"
'
```

## 7. 回滚标准流程（任何关键验收失败即执行）
1. 停直装：
```bash
systemctl stop openclaw-gateway openclaw-panel
```
2. 恢复 Docker：
```bash
cd /opt/openclaw
docker compose start
```
3. 如配置损坏，恢复备份：
1. 从 `/root/migrate-backup-<VMID>-<TS>` 解包恢复。
2. 如需恢复直装配置，使用 `openclaw.json.bak.<ts>` 回退。

## 8. 每台机器收尾文档（必须）
迁移完成后必须新增：
`用户小鸡去 Docker 化/YYYY-MM-DD_<VMID>_去Docker直装迁移记录.md`

至少记录：
1. 机器信息、执行人、执行时间
2. 备份目录与哈希结果
3. 执行命令与关键输出
4. 验收证据（端口、接口、数据抽样）
5. 风险与回滚点
6. 本机特殊问题与防复发建议

## 9. 给其他窗口 AI 的固定指令模板
```text
先阅读：
1) 用户小鸡去 Docker 化/00_全流程SOP_小鸡去Docker化标准教程.md
2) 用户小鸡去 Docker 化/2026-02-20_结论与执行基线.md

然后按 SOP 执行 vmid=<VMID> 的迁移，严格遵守：
- 先备份
- 停 Docker 不删
- 迁移并验收通过后再删 Docker

执行中每一步都要回报证据（命令输出、状态、风险、回滚点）。
```


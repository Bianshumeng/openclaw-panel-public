# OpenClaw面板 - 变更

## 新增需求

### 需求：网关服务重启跨平台

仪表盘“重启网关服务”必须在 Windows / Linux 环境均有可执行路径：优先调用 `openclaw gateway restart`，若 CLI 缺失则给出可执行提示；在 Linux 且 CLI 缺失时可回退 systemctl。

#### 场景：Windows 本地面板触发重启
- **当** 用户在 Windows 面板点击“重启网关服务”
- **那么** 系统应尝试调用 `openclaw gateway restart`，若 CLI 缺失必须提示“安装 OpenClaw CLI 或在网关主机运行面板”

#### 场景：Linux 主机 CLI 缺失回退
- **当** Linux 面板执行 `openclaw gateway restart` 且 CLI 缺失
- **那么** 系统必须回退到 `systemctl restart openclaw-gateway` 并返回结果

#### 场景：失败原因可见
- **当** 重启失败
- **那么** 前端必须展示后端返回的失败详情（output/message）

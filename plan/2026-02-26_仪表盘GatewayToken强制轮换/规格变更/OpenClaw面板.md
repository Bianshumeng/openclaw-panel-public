# OpenClaw面板 - 变更

## 新增需求

### 需求：Gateway Token 强制轮换

面板必须在仪表盘提供“一键重置 Gateway Token”动作，每次点击都生成新的 Token 并写入真实配置文件，避免复用失效令牌。

#### 场景：点击重置时强制生成新 Token
- **当** 用户在仪表盘点击“一键重置 Gateway Token”
- **那么** 系统必须生成一个不同于当前值的新 Token，并写回 `gateway.auth.token`

#### 场景：重置后引导用户更新 Control UI
- **当** 新 Token 写入成功
- **那么** 系统必须返回可复制的新 Token，并提示用户把新 Token 更新到 Control UI 后重新连接

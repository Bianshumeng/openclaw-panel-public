# OpenClaw面板 - 变更

## 新增需求

### 需求：管理面 SSH 密钥化基线

管理面 SSH 必须默认仅支持密钥登录，禁止密码登录。

#### 场景：小鸡首启安全基线
- 当 新小鸡完成首启初始化
- 那么 系统必须确保 SSH 仅密钥登录且密码登录被拒绝

#### 场景：密钥接入
- 当 用户拿到 Bot 下发的 SSH 私钥文件
- 那么 用户必须可直接使用密钥命令登录，不需要额外改服务器认证方式

#### 场景：业务端口保护边界
- 当 系统收紧管理面 SSH 策略
- 那么 不得影响客户业务端口池（约 50 端口）的对外使用

---

### 需求：管理 Web 双 Token 鉴权

管理 Web 页面必须通过双 Token 鉴权（`panel_token`、`gateway_token`），不再依赖网页账号密码交互流程。

#### 场景：连接流程简化
- 当 用户通过 SSH 隧道访问面板或 Gateway 页面
- 那么 用户应通过携带 token 的链接直接进入，不需要再手工粘贴 token 或输入网页账号密码

#### 场景：交付输出最小化
- 当 Bot 发送 `VM_READY`
- 那么 仅允许输出 SSH 连接脚本与本地隧道访问地址（`127.0.0.1`），不得输出管理 Web 公网地址或公网端口字段

#### 场景：双 Token 分离
- 当 系统初始化管理面鉴权
- 那么 控制台必须使用 `panel_token`，OpenClaw UI 必须使用 `gateway_token`，两者不得共用同一 token

#### 场景：硬门禁
- 当 用户访问“可视化龙虾配置页面”且请求未携带 `panel_token` 或携带错误 `panel_token`
- 那么 控制台服务端必须直接返回 `401/403`，不得进入空白页面等待手工补 token

#### 场景：OpenClaw 自带 UI 交互保留
- 当 用户访问 OpenClaw 自带 UI
- 那么 保持其原生 token 输入/连接交互，不强改为控制台同款 `401/403` 直拒绝流程

#### 场景：鉴权一致性
- 当 用户访问 OpenClaw 自带 UI 与可视化控制台
- 那么 两者必须采用 token 鉴权体系，但允许交互方式不同（控制台硬门禁、OpenClaw UI 原生交互）

---

### 需求：每台小鸡独立双 Token

每台新建小鸡必须生成两枚独立 token（`panel_token`、`gateway_token`），不得继承模板机 token。

#### 场景：首启 token 生成
- 当 小鸡从模板克隆并启动
- 那么 系统必须生成该小鸡独立 `panel_token` 与 `gateway_token` 并写入运行配置

#### 场景：交付回传
- 当 Bot 发送 `VM_READY`
- 那么 Bot 必须明文回传该小鸡 `panel_token` 与 `gateway_token`

#### 场景：URL 直接可用
- 当 Bot 输出 `VM_READY`
- 那么 输出的 `local_panel_url` 必须预拼接 `panel_token`，`local_gateway_url` 必须预拼接 `gateway_token`，用户复制后可直接访问

#### 场景：唯一性校验
- 当 连续创建两台小鸡
- 那么 两台小鸡的 `panel_token` 与 `gateway_token` 均必须不同

---

### 需求：模板版本门禁

模板必须具备版本标识，新小鸡克隆后必须执行版本一致性校验。

#### 场景：模板更新
- 当 运维更新模板内容
- 那么 必须同步更新模板版本标识文件

#### 场景：克隆后校验
- 当 新小鸡完成首启
- 那么 系统必须校验其模板版本与预期一致，不一致即阻断成功交付

---

### 需求：客户小鸡迁移可回滚

从 Docker 版迁移到直装版时，必须先备份、后迁移、可回滚。

#### 场景：迁移前备份
- 当 对任意客户小鸡执行迁移
- 那么 必须先完成全量备份与校验（manifest + hash）

#### 场景：迁移失败回滚
- 当 迁移后关键能力异常（Gateway、Telegram、配置写入不可用）
- 那么 系统必须按预案回滚到迁移前状态

#### 场景：迁移后验收
- 当 迁移完成
- 那么 必须验证配置、渠道、日志、会话与关键业务能力可用

---

### 需求：控制台内置迁移动作

控制台必须提供“无需 SSH 手工敲命令”的迁移与维护入口。

#### 场景：可视化迁移
- 当 运维在控制台发起迁移
- 那么 系统必须在页面中展示步骤、进度、结果与回滚选项

#### 场景：路径适配
- 当 控制台运行在非 Docker 直装模式
- 那么 所有后台读写路径与服务控制逻辑必须适配宿主机环境

---

### 需求：更新功能对齐官方直装更新机制

控制台“版本更新”能力必须从 Docker 镜像更新链路迁移为 OpenClaw 官方直装更新链路。

#### 场景：安装方式识别
- 当 用户在更新页面执行“检查更新”
- 那么 系统必须先识别当前安装方式（`global` 或 `source`），并给出对应更新策略

#### 场景：global 安装更新
- 当 安装方式为 `global`（npm/pnpm）
- 那么 系统必须走包管理器更新（`npm i -g openclaw@latest` 或 `pnpm add -g openclaw@latest`），并在更新后执行 `openclaw doctor`、`openclaw gateway restart`、`openclaw health`

#### 场景：source 安装更新
- 当 安装方式为 `source`（git checkout）
- 那么 系统应优先执行 `openclaw update`（或同等安全流程），并在工作区不干净时阻断更新并提示用户先清理

#### 场景：回滚策略
- 当 更新后出现问题
- 那么 系统必须支持按安装方式执行回滚：`global` 回滚到指定版本；`source` 按 commit/date pin 回滚

#### 场景：弃用镜像更新入口
- 当 运行环境已完成去 Docker 化
- 那么 更新页面不得再展示“拉取镜像/应用容器更新/镜像回滚”等 Docker 专属操作

## 修改需求

### 需求：服务生命周期控制

原文：

> 面板必须支持对 OpenClaw 运行实例执行启动、停止、重启、状态查询，且兼容 `systemd` 与 `docker` 两种运行时。  
>  
> #### 场景：可视化启停  
> - 当 用户点击服务控制按钮  
> - 那么 系统必须返回明确的成功或失败结果及错误原因  
>  
> #### 场景：运行时切换  
> - 当 目标环境采用 Docker 部署  
> - 那么 系统必须通过容器名执行状态查询与启停控制，而不是依赖 systemd

修改后：

> 面板必须支持对 OpenClaw 运行实例执行启动、停止、重启、状态查询，以“非 Docker 直装运行时”为主路径，Docker 仅作为迁移过渡兼容路径。  
>  
> #### 场景：可视化启停  
> - 当 用户点击服务控制按钮  
> - 那么 系统必须返回明确的成功或失败结果及错误原因  
>  
> #### 场景：运行时主路径  
> - 当 目标环境已完成迁移  
> - 那么 系统必须通过宿主机服务控制（systemd/本地进程）执行状态查询与启停  
>  
> #### 场景：迁移期兼容  
> - 当 目标环境仍处于 Docker 迁移期  
> - 那么 系统应保持兼容控制能力，并在迁移完成后回收 Docker 兼容分支

## 配置契约变更（最小表）
| 字段 | 类型 | 必需 | 约束 | 兼容性说明 | 备注 |
|------|------|------|------|-----------|------|
| `gateway.auth.mode` | string | 是 | 固定 `token` | 账号密码登录流程废弃 | 管理 Web 鉴权模式 |
| `gateway.auth.token` | string | 是 | 每机唯一、高熵随机（`gateway_token`） | 模板共享 token 不再允许 | OpenClaw UI 鉴权 |
| `panel.auth.token` | string | 是 | 每机唯一、高熵随机（`panel_token`） | 新增 | 控制台鉴权 |
| `template.version` | string | 是 | 与模板版本文件一致 | 新增门禁校验 | 不一致阻断交付 |
| `vm_ready.ssh_connect_command` | string | 是 | 仅密钥登录命令 | 新增输出字段 | 用户连接入口 |
| `vm_ready.panel_token` | string | 是 | 明文回传 | 新增输出字段 | 控制台 token |
| `vm_ready.gateway_token` | string | 是 | 明文回传 | 新增输出字段 | OpenClaw UI token |
| `vm_ready.local_panel_url` | string | 是 | `127.0.0.1` 本地映射地址，需携带 `panel_token` | 新增/重构 | 控制台本地访问 |
| `vm_ready.local_gateway_url` | string | 是 | `127.0.0.1` 本地映射地址，需携带 `gateway_token` | 新增/重构 | OpenClaw UI 本地访问 |
| `vm_ready.panel_public_url` | string | 否 | 不允许输出 | 废弃 | 管理面公网地址移除 |
| `vm_ready.gateway_public_url` | string | 否 | 不允许输出 | 废弃 | 管理面公网地址移除 |
| `update.install_method` | string | 是 | `global` / `source` | 新增 | 更新策略选择依据 |
| `update.strategy` | string | 是 | `package-manager` / `openclaw-update` | 新增 | 前后端统一语义 |
| `update.docker_mode` | boolean | 是 | 固定 `false`（迁移完成后） | 旧字段降级 | 禁止再走镜像更新 |

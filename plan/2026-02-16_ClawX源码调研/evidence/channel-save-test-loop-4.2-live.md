# 4.2 运行态证据：Telegram/Feishu 保存+测试闭环

时间：2026-02-16

## 1) 页面能力校验

`/channels` 页面新增：

- `save_and_test_telegram`（保存并测试 Telegram）
- `save_and_test_feishu`（保存并测试 Feishu）
- `tg_test_result` / `fs_test_result`（最近测试结果）

## 2) 交互闭环校验（Chrome DevTools MCP，mock 网络）

### 2.1 Telegram 保存并测试

脚本返回：

```json
{
  "ok": true,
  "called": [
    "PUT /api/settings",
    "GET /api/panel-config",
    "GET /api/settings",
    "POST /api/test/telegram"
  ],
  "resultText": "最近测试（18:06:16）：成功 - mock telegram ok",
  "hasSaveAndTestChain": true
}
```

### 2.2 Feishu 保存并测试

脚本返回：

```json
{
  "ok": true,
  "called": [
    "PUT /api/settings",
    "GET /api/panel-config",
    "GET /api/settings",
    "POST /api/test/feishu"
  ],
  "resultText": "最近测试（18:06:29）：成功 - mock feishu ok",
  "hasSaveAndTestChain": true
}
```

结论：
- 两个通道都已形成“保存配置 -> 回填凭证 -> 连通性测试 -> 可见结果”的可复现闭环。

## 3) 自动化验证

命令：

```powershell
node --check public/app.js
npm run test:unit
npm run test:regression
```

结果：
- `node --check` 通过
- `test:unit`：48/48 通过
- `test:regression`：3 通过，1 跳过

## 4) Docker 验证

命令：

```powershell
docker compose up -d --build panel
```

结果：
- `openclaw-panel:local` 构建成功
- `openclaw-panel` 重建并启动成功

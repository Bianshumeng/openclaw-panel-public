# 4.3 运行态证据：Discord/Slack 状态展示与优雅降级

时间：2026-02-16

## 1) 页面能力校验

`/channels` 页面新增：

- `dc_test_result`（Discord 最近测试状态）
- `sl_test_result`（Slack 最近测试状态）

## 2) 交互校验（Chrome DevTools MCP）

执行脚本返回：

```json
{
  "ok": true,
  "discordValidationText": "最近测试（18:09:17）：失败 - 接口不可用或测试失败：Discord 测试失败：Bot Token 不能为空",
  "slackDegradeText": "最近测试（18:09:18）：失败 - 接口不可用或测试失败：mock slack endpoint unavailable",
  "discordValidationWorks": true,
  "slackDegradeWorks": true
}
```

结论：
- Discord 在缺少 Token 时会给出页面内失败状态，不会静默失败；
- Slack 接口不可用时会优雅降级到页面状态提示，不会导致页面异常崩溃。

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

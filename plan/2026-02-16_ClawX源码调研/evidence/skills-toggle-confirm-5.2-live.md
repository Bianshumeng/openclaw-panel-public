# 5.2 运行态证据：Skills 启停二次确认

时间：2026-02-16

## 1) 运行态确认弹窗校验（Chrome DevTools MCP）

目标页面：`http://127.0.0.1:18080/skills`

执行脚本返回：

```json
{
  "ok": true,
  "confirmMessage": "你正在禁用 Skill「feishu-doc」。\n这可能影响已有工作流，确认继续吗？",
  "skillToggleRequestSent": false,
  "confirmShown": true
}
```

结论：
- 点击高风险动作（禁用已启用 Skill）会先弹二次确认。
- 用户取消后不会发送启停请求（`/api/skills/:skillKey/enabled` 未触发）。

## 2) 自动化验证

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

## 3) Docker 验证

命令：

```powershell
docker compose up -d --build panel
```

结果：
- `openclaw-panel:local` 构建成功
- `openclaw-panel` 重建并启动成功

# 3.4 运行态证据：API 模式下拉与 GPT/Claude/Gemini 联动

时间：2026-02-16

## 1) 页面交互校验（Chrome DevTools MCP）

目标页面：`http://127.0.0.1:18080/model`

### 1.1 自定义模式控件存在性

- `custom_api` 已是下拉框（含 `custom` 选项）
- `custom_default_model_id` 已是下拉框（含 `custom` 选项）

### 1.2 模型切换联动（AICodeCat）

执行脚本返回：

```json
{
  "ok": true,
  "afterClaude": {
    "providerId": "aicodecat-claude",
    "apiMode": "anthropic-messages",
    "baseUrl": "https://aicode.cat"
  },
  "afterGpt": {
    "providerId": "aicodecat-gpt",
    "apiMode": "openai-responses",
    "baseUrl": "https://aicode.cat/v1"
  },
  "afterGemini": {
    "providerId": "aicodecat-gemini",
    "apiMode": "google-generative-ai",
    "baseUrl": "https://aicode.cat/v1beta"
  }
}
```

### 1.3 API 模式切换联动（AICodeCat）

执行脚本返回：

```json
{
  "byClaudeApi": {
    "providerId": "aicodecat-claude",
    "apiMode": "anthropic-messages",
    "baseUrl": "https://aicode.cat"
  },
  "byGeminiApi": {
    "providerId": "aicodecat-gemini",
    "apiMode": "google-generative-ai",
    "baseUrl": "https://aicode.cat/v1beta"
  }
}
```

结论：
- 在 AICodeCat 提供商下，模型族与 API 模式互相驱动，并同步切换默认 URL。
- GPT/Claude/Gemini 三条路径已按预期联动。

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

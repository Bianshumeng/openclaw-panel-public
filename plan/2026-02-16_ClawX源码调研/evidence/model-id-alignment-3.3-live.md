# 3.3 运行态证据：默认模型列表与配置生成器模型 ID 对齐

时间：2026-02-16

## 1) 运行时页面校验（Chrome DevTools MCP）

目标页面：`http://127.0.0.1:18080/model`

执行脚本结果：

```json
{
  "cfgCount": 9,
  "templateCount": 8,
  "modelDefaultCount": 10,
  "sameAsTemplate": true,
  "firstCfg": [
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "claude-opus-4-6",
    "claude-sonnet-4-5-20250929"
  ],
  "firstTemplate": [
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "claude-opus-4-6",
    "claude-sonnet-4-5-20250929"
  ],
  "hasCustomOption": true
}
```

补充校验：

```json
{
  "presetIdsCount": 8,
  "defaultTextsCount": 10,
  "missingPresetIdsInDefault": []
}
```

结论：
- 配置生成器与模板高级参数的模型 ID 列表已同源一致；
- “设置当前默认模型”下拉包含全部预置模型 ID（并可额外显示当前环境自定义模型）。

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

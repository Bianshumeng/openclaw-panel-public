# 3.2 运行态证据：模型页基础模板/自定义模式切换

时间：2026-02-16

## 1) 页面结构校验

命令：

```powershell
Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:18080/model
```

关键节点命中：

- `model_provider_mode_section`
- `data-model-provider-mode="template"`
- `data-model-provider-mode="custom"`
- `data-model-provider-mode-panel="template"`
- `data-model-provider-mode-panel="custom"`
- `高级参数（通常不用改）`

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

## 4) 行为结论

- 路径 2 默认进入“基础配置（推荐）”，只暴露核心输入项（provider/baseUrl/apiKey）。
- 模板高级参数（API 模式/默认模型/是否切默认）已折叠，降低小白误操作概率。
- “自定义模式”仅在用户主动切换后展示。

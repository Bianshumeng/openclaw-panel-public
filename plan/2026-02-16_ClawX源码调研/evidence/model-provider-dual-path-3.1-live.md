# 3.1 运行态证据：模型与提供商双通道解耦

时间：2026-02-16

## 1) 静态结构校验

命令：

```powershell
Invoke-WebRequest -UseBasicParsing -Uri http://127.0.0.1:18080/model
```

结果：页面包含以下关键节点（全部命中）：

- `template_set_as_primary`
- `custom_set_as_primary`
- `model_provider_template_section`
- `model_default_section`

## 2) 语法与自动化验证

命令：

```powershell
node --check public/app.js
node --check public/config-generator.js
npm run test:unit
npm run test:regression
```

结果：

- `node --check` 全部通过
- `test:unit`：48/48 通过
- `test:regression`：3 通过，1 跳过（历史已存在）

## 3) Docker 运行态验证

命令：

```powershell
docker compose up -d --build panel
```

结果：

- `openclaw-panel:local` 构建成功
- `openclaw-panel` 容器重建并启动成功

## 4) 行为结论

- 路径 1（设置当前默认模型）与路径 2（新增提供商）已实现显式解耦：
  - 默认行为：新增提供商不会改动当前默认模型
  - 显式勾选“保存后设为当前默认模型”时才会切换 `primary`

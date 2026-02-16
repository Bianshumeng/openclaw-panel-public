# 7.1 运行态证据：自动化测试收口

时间：2026-02-16

## 执行命令

```powershell
node --check public/app.js
node --check src/server.js
npm run test:unit
npm run test:regression
npm run test
```

## 结果

- 语法检查：
  - `public/app.js` 通过
  - `src/server.js` 通过
- 单元测试：`51/51` 通过
- 回归测试：`3` 通过，`1` 跳过（`docker-rollback keeps .env unchanged when target image pull fails`）
- 聚合测试命令 `npm run test` 通过（等价执行 `test:unit + test:regression`）

## 结论

- 当前主线改造在自动化层面通过；
- 可进入 `7.2` 手工关键路径回放。

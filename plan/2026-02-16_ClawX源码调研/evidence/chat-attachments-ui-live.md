# Chat 附件链路联调证据

时间：2026-02-16

## 验证目标
验证“点击上传/粘贴/拖拽 -> 附件落盘 -> 发送 -> 网关读取”闭环。

## 关键结果
1. `POST /api/chat/attachments/stage` 成功，返回 `stagedPath=/data/openclaw/media/outbound/*.txt`。
2. `POST /api/chat/send` 请求体包含附件数组（`fileName/mimeType/fileSize/stagedPath`）。
3. 发送前会把面板本地路径映射为网关可见路径：
   - 本地：`/data/openclaw/media/outbound/...`
   - 网关：`/home/node/.openclaw/media/outbound/...`
4. 网关工具成功读取附件内容并回复 `ok`（无 `ENOENT/EACCES`）。

## 浏览器页面验证
- 页面：`/chat-console`
- 操作：点击“添加附件”上传 `attachment-ui-test.txt`
- 结果：页面出现附件卡片（文件名、类型、大小、移除按钮），发送后历史消息可见附件引用。

## 证据文件
- `chat-attachments-live.json`
- `chat-attachments-pathmap-live.json`
- DevTools network req `POST /api/chat/send`（请求体含附件字段）

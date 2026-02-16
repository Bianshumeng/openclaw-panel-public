import { api, chatConsoleState, getInputValue, setInput, setMessage } from "../core/panel-core.js";

function setChatStreamStatus(text) {
  setInput("chat_stream_status", text || "");
}

function setChatComposerSending(sending) {
  chatConsoleState.sending = Boolean(sending);
  const sendButton = document.querySelector("#chat_send_message");
  const abortButton = document.querySelector("#chat_abort_run");
  if (sendButton) {
    sendButton.disabled = chatConsoleState.sending;
    sendButton.textContent = chatConsoleState.sending ? "发送中..." : "发送消息";
  }
  if (abortButton) {
    abortButton.disabled = !chatConsoleState.sending;
  }
}

function setChatAttachmentHint(text) {
  const hint = document.querySelector("#chat_attachment_hint");
  if (!hint) {
    return;
  }
  hint.textContent = String(text || "").trim() || "支持点击上传、粘贴或拖拽文件（图片会显示预览）";
}

function setChatInlineHint(text, type = "") {
  const hint = document.querySelector("#chat_inline_hint");
  if (!hint) {
    return;
  }
  hint.textContent = String(text || "").trim();
  hint.classList.remove("error", "ok");
  if (type === "error") {
    hint.classList.add("error");
  } else if (type === "ok") {
    hint.classList.add("ok");
  }
}

function reportChatActionError(error, fallback = "操作失败") {
  const message = String(error?.message || error || "").trim() || fallback;
  setChatInlineHint(message, "error");
  setMessage(message, "error");
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "-";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function renderChatAttachments() {
  const container = document.querySelector("#chat_attachment_list");
  if (!container) {
    return;
  }
  container.innerHTML = "";
  const items = Array.isArray(chatConsoleState.attachments) ? chatConsoleState.attachments : [];
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "当前没有附件";
    container.appendChild(empty);
    return;
  }

  items.forEach((item, index) => {
    const node = document.createElement("div");
    node.className = "chat-attachment-item";

    const row = document.createElement("div");
    row.className = "chat-attachment-row";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "chat-attachment-name";
    name.textContent = String(item.fileName || "file");
    const meta = document.createElement("div");
    meta.className = "chat-attachment-meta";
    meta.textContent = `${String(item.mimeType || "application/octet-stream")} | ${formatFileSize(item.fileSize)}`;
    info.appendChild(name);
    info.appendChild(meta);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-soft";
    removeBtn.dataset.attachmentIndex = String(index);
    removeBtn.textContent = "移除";

    row.appendChild(info);
    row.appendChild(removeBtn);
    node.appendChild(row);

    if (item.preview && String(item.mimeType || "").startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "chat-attachment-preview";
      image.src = item.preview;
      image.alt = String(item.fileName || "image");
      node.appendChild(image);
    }
    container.appendChild(node);
  });
}

function removeChatAttachmentByIndex(index) {
  if (!Array.isArray(chatConsoleState.attachments)) {
    return;
  }
  if (!Number.isInteger(index) || index < 0 || index >= chatConsoleState.attachments.length) {
    return;
  }
  chatConsoleState.attachments.splice(index, 1);
  renderChatAttachments();
  setChatAttachmentHint(`已移除附件，当前 ${chatConsoleState.attachments.length} 个`);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      const match = raw.match(/^data:[^;]+;base64,(.+)$/i);
      resolve(match ? match[1] : raw);
    };
    reader.onerror = () => {
      reject(new Error(`读取文件失败：${file?.name || "unknown"}`));
    };
    reader.readAsDataURL(file);
  });
}

async function stageChatFile(file) {
  const fileName = String(file?.name || "").trim() || "file";
  const mimeType = String(file?.type || "").trim() || "application/octet-stream";
  const base64 = await fileToBase64(file);
  const response = await api("/api/chat/attachments/stage", {
    method: "POST",
    body: JSON.stringify({
      fileName,
      mimeType,
      base64
    })
  });
  return response?.result && typeof response.result === "object" ? response.result : null;
}

async function stageChatFiles(files) {
  const list = Array.from(files || []).filter(Boolean);
  if (list.length === 0) {
    return;
  }
  if (chatConsoleState.staging) {
    setChatAttachmentHint("附件还在处理中，请稍候再操作");
    return;
  }
  chatConsoleState.staging = true;
  setChatAttachmentHint(`正在处理附件（${list.length} 个）...`);
  try {
    for (const file of list) {
      const staged = await stageChatFile(file);
      if (!staged) {
        continue;
      }
      const stagedPath = String(staged.stagedPath || "").trim();
      if (!stagedPath) {
        continue;
      }
      const existedIndex = chatConsoleState.attachments.findIndex((item) => item.stagedPath === stagedPath);
      if (existedIndex >= 0) {
        chatConsoleState.attachments[existedIndex] = staged;
      } else {
        chatConsoleState.attachments.push(staged);
      }
    }
    renderChatAttachments();
    setChatAttachmentHint(`附件已就绪：${chatConsoleState.attachments.length} 个`);
  } finally {
    chatConsoleState.staging = false;
  }
}

function renderChatStreamLines() {
  const output = document.querySelector("#chat_stream_output");
  if (!output) {
    return;
  }
  output.textContent = chatConsoleState.streamLines.length > 0 ? chatConsoleState.streamLines.join("\n") : "等待流式事件...";
}

function pushChatStreamLine(text) {
  const line = `[${new Date().toLocaleTimeString()}] ${text}`;
  chatConsoleState.streamLines.push(line);
  if (chatConsoleState.streamLines.length > 300) {
    chatConsoleState.streamLines = chatConsoleState.streamLines.slice(-300);
  }
  renderChatStreamLines();
}

function resetChatStreamOutput() {
  chatConsoleState.streamLines = [];
  chatConsoleState.streamDeltasByRunId = {};
  chatConsoleState.streamThinkingByRunId = {};
  renderChatStreamLines();
  renderChatMessageList();
}

function closeChatStreamSource() {
  if (chatConsoleState.streamSource) {
    chatConsoleState.streamSource.close();
    chatConsoleState.streamSource = null;
  }
  chatConsoleState.streamSessionKey = "";
}

function extractStreamTextFromMessage(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .join("");
}

function normalizeChatContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        if (entry.type === "toolCall" || entry.type === "tool_call") {
          const toolName = String(entry.name || entry.tool || "unknown");
          const args =
            typeof entry.arguments === "string"
              ? entry.arguments
              : JSON.stringify(entry.arguments ?? entry.partialJson ?? {}, null, 2);
          return `[工具调用] ${toolName}\n参数:\n${args}`;
        }
        if (entry.type === "toolResult" || entry.type === "tool_result") {
          const resultText =
            typeof entry.text === "string"
              ? entry.text
              : JSON.stringify(entry.details ?? entry.result ?? entry, null, 2);
          return `[工具结果]\n${resultText}`;
        }
        if (typeof entry.text === "string") {
          return entry.text;
        }
        if (typeof entry.content === "string") {
          return entry.content;
        }
        return JSON.stringify(entry);
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
    return JSON.stringify(content);
  }
  return String(content ?? "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRichTextSegment(segment) {
  let html = escapeHtml(segment);
  html = html.replace(/\*\*([^\n*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\n/g, "<br>");
  return `<span>${html}</span>`;
}

function renderRichMessageBody(text) {
  const source = String(text || "");
  if (!source) {
    return "<span>(空消息)</span>";
  }
  const parts = source.split("```");
  return parts
    .map((part, index) => {
      if (index % 2 === 0) {
        return renderRichTextSegment(part);
      }
      const firstBreak = part.indexOf("\n");
      let codeLang = "";
      let codeBody = part;
      if (firstBreak >= 0) {
        codeLang = part.slice(0, firstBreak).trim();
        codeBody = part.slice(firstBreak + 1);
      }
      const langAttr = codeLang ? ` data-lang="${escapeHtml(codeLang)}"` : "";
      return `<pre class="chat-code"><code${langAttr}>${escapeHtml(codeBody)}</code></pre>`;
    })
    .join("");
}

function formatChatRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "user") {
    return "你";
  }
  if (normalized === "assistant") {
    return "助手";
  }
  if (normalized === "system") {
    return "系统";
  }
  if (
    normalized === "tool" ||
    normalized === "tool_use" ||
    normalized === "tool_result" ||
    normalized === "toolresult" ||
    normalized === "toolcall"
  ) {
    return "工具";
  }
  return normalized || "未知";
}

function normalizeChatMessage(message = {}, index = 0) {
  const role = String(message?.role || message?.author || message?.type || "assistant").trim().toLowerCase() || "assistant";
  const status = String(message?.status || "").trim();
  const thinking = String(
    message?.thinkingState || message?.thinking || message?.reasoning || message?.reasoningEffort || ""
  ).trim();
  const body = normalizeChatContent(
    message?.content ?? message?.parts ?? message?.message ?? message?.delta ?? message?.text ?? ""
  );
  const attachments = Array.isArray(message?._attachedFiles)
    ? message._attachedFiles
        .map((entry) => ({
          fileName: String(entry?.fileName || "").trim(),
          mimeType: String(entry?.mimeType || "").trim() || "application/octet-stream",
          fileSize: Number(entry?.fileSize || 0) || 0,
          preview: String(entry?.preview || "").trim() || ""
        }))
        .filter((entry) => entry.fileName)
    : [];
  return {
    id: `history-${index + 1}`,
    role,
    status,
    thinking,
    body: body || "(空消息)",
    timestamp: message?.timestamp || message?.createdAt || message?.at || "",
    attachments
  };
}

function createChatMessageNode(item, { streaming = false, showThinking = true } = {}) {
  const node = document.createElement("div");
  const role = String(item?.role || "assistant").toLowerCase();
  node.className = `chat-message ${role === "user" ? "user" : "assistant"}${streaming ? " streaming" : ""}`;

  const header = document.createElement("div");
  header.className = "chat-message-header";

  const roleEl = document.createElement("span");
  roleEl.className = "chat-role";
  roleEl.textContent = formatChatRole(role);
  header.appendChild(roleEl);

  const metaEl = document.createElement("span");
  metaEl.textContent = streaming ? "实时生成中..." : String(item?.status || "").trim() || "";
  header.appendChild(metaEl);

  node.appendChild(header);

  if (showThinking && String(item?.thinking || "").trim()) {
    const thinkingEl = document.createElement("span");
    thinkingEl.className = "chat-thinking";
    thinkingEl.textContent = `思考：${item.thinking}`;
    node.appendChild(thinkingEl);
  }

  const body = document.createElement("div");
  body.className = "chat-message-body";
  const bodyText = String(item?.body || "").trim() || "(空消息)";
  const shouldRenderRich =
    role === "assistant" || role === "system" || role === "tool" || role === "toolresult" || role === "toolcall";
  if (shouldRenderRich) {
    body.innerHTML = renderRichMessageBody(bodyText);
  } else {
    body.textContent = bodyText;
  }
  node.appendChild(body);

  const files = Array.isArray(item?.attachments) ? item.attachments : [];
  if (files.length > 0) {
    const fileList = document.createElement("div");
    fileList.className = "chip-line";
    files.forEach((entry) => {
      const chip = document.createElement("span");
      chip.className = "mini-chip";
      chip.textContent = `${String(entry?.fileName || "file")} (${formatFileSize(entry?.fileSize)})`;
      fileList.appendChild(chip);
    });
    node.appendChild(fileList);
  }
  return node;
}

function renderChatMessageList() {
  const container = document.querySelector("#chat_messages");
  if (!container) {
    return;
  }
  const showThinking = Boolean(getInputValue("chat_show_thinking"));
  container.innerHTML = "";

  const items = Array.isArray(chatConsoleState.historyMessages) ? chatConsoleState.historyMessages : [];
  items.forEach((item) => {
    container.appendChild(createChatMessageNode(item, { showThinking }));
  });

  Object.entries(chatConsoleState.streamDeltasByRunId).forEach(([runId, text]) => {
    const thinking = String(chatConsoleState.streamThinkingByRunId[runId] || "").trim();
    container.appendChild(
      createChatMessageNode(
        {
          role: "assistant",
          status: runId ? `runId: ${runId}` : "",
          thinking,
          body: String(text || "").trim() || "正在生成..."
        },
        { streaming: true, showThinking }
      )
    );
  });

  if (container.childElementCount === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.textContent = "请选择会话后开始对话";
    container.appendChild(empty);
  }

  container.scrollTop = container.scrollHeight;
}

function renderChatHistory(history = {}) {
  const output = document.querySelector("#chat_history_output");
  if (!output) {
    return;
  }
  const sessionKey = String(history.sessionKey || chatConsoleState.selectedSessionKey || "").trim();
  const sessionId = String(history.sessionId || "").trim();
  const thinkingLevel = String(history.thinkingLevel || "").trim();
  const verboseLevel = String(history.verboseLevel || "").trim();
  const messages = Array.isArray(history.messages) ? history.messages : [];

  const lines = [];
  lines.push(`sessionKey: ${sessionKey || "-"}`);
  lines.push(`sessionId: ${sessionId || "-"}`);
  lines.push(`thinkingLevel: ${thinkingLevel || "-"}`);
  lines.push(`verboseLevel: ${verboseLevel || "-"}`);
  lines.push(`messages: ${messages.length}`);

  chatConsoleState.historyMessages = messages.map((message, index) => normalizeChatMessage(message, index));
  renderChatMessageList();

  messages.forEach((message, index) => {
    const role = String(message?.role || message?.author || message?.type || "unknown").trim() || "unknown";
    const status = String(message?.status || "").trim();
    const thinkingState = String(
      message?.thinkingState || message?.thinking || message?.reasoning || message?.reasoningEffort || ""
    ).trim();
    const content = normalizeChatContent(
      message?.content ?? message?.parts ?? message?.message ?? message?.delta ?? message?.text ?? ""
    );

    lines.push("");
    lines.push(`#${index + 1} ${role}${status ? ` [${status}]` : ""}`);
    if (thinkingState) {
      lines.push(`思考状态: ${thinkingState}`);
    }
    lines.push(content || "(empty)");
  });

  output.textContent = lines.join("\n");
}

function handleChatStreamEvent(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const state = String(data.state || "").trim();
  const runId = String(data.runId || "").trim();
  const sessionKey = String(data.sessionKey || "").trim();
  if (runId) {
    chatConsoleState.lastRunId = runId;
    setInput("chat_last_run_id", runId);
  }

  const deltaChunk = extractStreamTextFromMessage(data.message);
  if (state === "delta") {
    if (runId) {
      const previous = String(chatConsoleState.streamDeltasByRunId[runId] || "");
      chatConsoleState.streamDeltasByRunId[runId] = previous + deltaChunk;
    }
    pushChatStreamLine(`[chat:${state}] ${runId || "-"} ${deltaChunk || "(empty-delta)"}`);
    renderChatMessageList();
    return;
  }

  if (state === "final") {
    const mergedText = runId ? String(chatConsoleState.streamDeltasByRunId[runId] || "") : "";
    const finalChunk = deltaChunk || mergedText || "(empty)";
    pushChatStreamLine(`[chat:final] ${runId || "-"} ${finalChunk}`);
    if (runId) {
      delete chatConsoleState.streamDeltasByRunId[runId];
      delete chatConsoleState.streamThinkingByRunId[runId];
    }
    setChatComposerSending(false);
    renderChatMessageList();
    if (sessionKey) {
      loadChatHistory({ sessionKey, silent: true }).catch(() => {});
    }
    return;
  }

  if (state === "aborted" || state === "error") {
    const reason = String(data.stopReason || data.errorMessage || "").trim();
    pushChatStreamLine(`[chat:${state}] ${runId || "-"} ${reason || "-"}`);
    if (runId) {
      delete chatConsoleState.streamDeltasByRunId[runId];
      delete chatConsoleState.streamThinkingByRunId[runId];
    }
    setChatComposerSending(false);
    renderChatMessageList();
    if (sessionKey) {
      loadChatHistory({ sessionKey, silent: true }).catch(() => {});
    }
    return;
  }

  pushChatStreamLine(`[chat:${state || "unknown"}] ${runId || "-"} seq=${data.seq ?? "-"}`);
}

function handleAgentStreamEvent(payload) {
  const data = payload && typeof payload === "object" ? payload : {};
  const stream = String(data.stream || "").trim() || "-";
  const phase = String(data.phase || "").trim() || "-";
  const runId = String(data.runId || "").trim() || "-";
  pushChatStreamLine(`[agent:${stream}] ${runId} phase=${phase}`);
  if (runId !== "-") {
    chatConsoleState.streamThinkingByRunId[runId] = phase;
    renderChatMessageList();
  }
}

function connectChatStream(sessionKey, { silent = false, force = false } = {}) {
  const normalizedSessionKey = String(sessionKey || chatConsoleState.selectedSessionKey || "").trim();
  if (!normalizedSessionKey) {
    setChatStreamStatus("未连接（未选择会话）");
    return;
  }
  if (!force && chatConsoleState.streamSource && chatConsoleState.streamSessionKey === normalizedSessionKey) {
    return;
  }

  closeChatStreamSource();
  chatConsoleState.streamSessionKey = normalizedSessionKey;
  resetChatStreamOutput();
  setChatStreamStatus(`连接中 (${normalizedSessionKey})`);
  if (!silent) {
    setMessage(`实时通道连接中：${normalizedSessionKey}`, "info");
  }

  const query = new URLSearchParams({
    sessionKey: normalizedSessionKey,
    includeAgent: "true"
  });
  const source = new EventSource(`/api/chat/stream?${query.toString()}`);
  chatConsoleState.streamSource = source;

  source.addEventListener("ready", (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      setChatStreamStatus(`已建立 (${payload.sessionKey || normalizedSessionKey})`);
      pushChatStreamLine(`[stream:ready] session=${payload.sessionKey || normalizedSessionKey}`);
    } catch {
      setChatStreamStatus("已建立");
    }
  });

  source.addEventListener("status", (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      const state = String(payload.state || "").trim();
      if (state === "connected") {
        setChatStreamStatus(`已连接 (${payload.sessionKey || normalizedSessionKey})`);
      } else if (state === "reconnecting") {
        setChatStreamStatus(`重连中（第${payload.attempt || 1}次）`);
      } else if (state === "connect-failed") {
        setChatStreamStatus("连接失败，自动重试中");
      } else if (state === "gateway-closed") {
        setChatStreamStatus("网关断开，自动重连中");
      } else {
        setChatStreamStatus(state || "状态更新");
      }
      pushChatStreamLine(`[stream:${state || "status"}] ${payload.reason || payload.message || ""}`.trim());
    } catch {
      setChatStreamStatus("状态更新");
    }
  });

  source.addEventListener("chat", (event) => {
    try {
      handleChatStreamEvent(JSON.parse(event.data || "{}"));
    } catch (error) {
      pushChatStreamLine(`[stream:parse-error] ${error.message || String(error)}`);
    }
  });

  source.addEventListener("agent", (event) => {
    try {
      handleAgentStreamEvent(JSON.parse(event.data || "{}"));
    } catch (error) {
      pushChatStreamLine(`[stream:parse-error] ${error.message || String(error)}`);
    }
  });

  source.addEventListener("stream-error", (event) => {
    try {
      const payload = JSON.parse(event.data || "{}");
      pushChatStreamLine(`[stream:error] ${payload.message || "unknown error"}`);
      setChatComposerSending(false);
    } catch {
      pushChatStreamLine("[stream:error] unknown error");
      setChatComposerSending(false);
    }
  });

  source.addEventListener("error", () => {
    setChatStreamStatus("连接波动，浏览器重连中");
  });
}

function renderChatSessionSelect() {
  const select = document.querySelector("#chat_session_select");
  if (!select) {
    return;
  }
  const sessions = Array.isArray(chatConsoleState.sessions) ? chatConsoleState.sessions : [];
  select.innerHTML = "";
  if (sessions.length === 0) {
    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "暂无会话";
    select.appendChild(emptyOption);
    select.value = "";
    return;
  }

  sessions.forEach((session) => {
    const option = document.createElement("option");
    option.value = session?.key || "";
    const ctx = Number(session?.contextTokens || 0);
    const model = String(session?.model || "-");
    const name = String(session?.displayName || session?.key || "未命名会话");
    option.textContent = `${name} | ${model} | ctx ${ctx > 0 ? ctx.toLocaleString() : "-"}`;
    select.appendChild(option);
  });

  if (chatConsoleState.selectedSessionKey && sessions.some((item) => item?.key === chatConsoleState.selectedSessionKey)) {
    select.value = chatConsoleState.selectedSessionKey;
  } else {
    select.selectedIndex = 0;
    chatConsoleState.selectedSessionKey = String(select.value || "").trim();
  }
}

async function loadChatSessions({ silent = false, preserveSelection = true, selectedSessionKey = "" } = {}) {
  const response = await api("/api/chat/sessions");
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  const sessions = Array.isArray(result.sessions) ? result.sessions : [];
  const previous = String(chatConsoleState.selectedSessionKey || "").trim();
  const requested = String(selectedSessionKey || "").trim();
  chatConsoleState.sessions = sessions;

  if (requested && sessions.some((item) => item?.key === requested)) {
    chatConsoleState.selectedSessionKey = requested;
  } else if (preserveSelection && previous && sessions.some((item) => item?.key === previous)) {
    chatConsoleState.selectedSessionKey = previous;
  } else {
    chatConsoleState.selectedSessionKey = String(sessions[0]?.key || "").trim();
  }

  chatConsoleState.attachments = [];
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");

  renderChatSessionSelect();
  if (chatConsoleState.selectedSessionKey) {
    connectChatStream(chatConsoleState.selectedSessionKey, { silent: true });
    await loadChatHistory({
      sessionKey: chatConsoleState.selectedSessionKey,
      silent: true
    });
  } else {
    closeChatStreamSource();
    setChatStreamStatus("未连接（暂无会话）");
    chatConsoleState.historyMessages = [];
    renderChatMessageList();
    setChatComposerSending(false);
    const output = document.querySelector("#chat_history_output");
    if (output) {
      output.textContent = "暂无会话可展示";
    }
  }
  if (!silent) {
    setMessage(`会话列表刷新完成，共 ${sessions.length} 条`, "ok");
  }
  if (silent) {
    setChatInlineHint("");
  }
}

async function loadChatHistory({ sessionKey = "", silent = false } = {}) {
  const normalizedSessionKey = String(sessionKey || chatConsoleState.selectedSessionKey || "").trim();
  if (!normalizedSessionKey) {
    throw new Error("请先选择会话");
  }
  chatConsoleState.selectedSessionKey = normalizedSessionKey;
  const query = new URLSearchParams({
    sessionKey: normalizedSessionKey,
    limit: "200"
  });
  const response = await api(`/api/chat/history?${query.toString()}`);
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  renderChatHistory({
    ...result,
    sessionKey: normalizedSessionKey
  });
  if (!silent) {
    setMessage(`会话历史刷新完成：${normalizedSessionKey}`, "ok");
  }
}

async function createChatSession() {
  const response = await api("/api/chat/session/new", {
    method: "POST",
    body: JSON.stringify({})
  });
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  const sessionKey = String(result.key || "").trim();
  if (!sessionKey) {
    throw new Error("新建会话失败：未返回会话 key");
  }
  await loadChatSessions({
    silent: true,
    preserveSelection: false,
    selectedSessionKey: sessionKey
  });
  setChatInlineHint("新会话创建成功", "ok");
  setMessage(`已创建新会话：${sessionKey}`, "ok");
}

async function sendChatConsoleMessage() {
  const sessionKey = String(getInputValue("chat_session_select") || chatConsoleState.selectedSessionKey || "").trim();
  const message = String(getInputValue("chat_message_input") || "").trim();
  const attachments = Array.isArray(chatConsoleState.attachments) ? [...chatConsoleState.attachments] : [];
  if (!sessionKey) {
    throw new Error("请先选择会话");
  }
  if (!message && attachments.length === 0) {
    throw new Error("请输入消息或添加至少一个附件");
  }
  if (chatConsoleState.sending) {
    throw new Error("当前正在生成回复，请稍候或先点击“停止回复”");
  }
  if (chatConsoleState.staging) {
    throw new Error("附件仍在处理中，请稍候再发送");
  }

  const payload = {
    sessionKey,
    message,
    thinking: String(getInputValue("chat_thinking_level") || "").trim(),
    idempotencyKey: String(getInputValue("chat_idempotency_key") || "").trim(),
    attachments: attachments.map((item) => ({
      fileName: String(item?.fileName || "").trim() || "file",
      mimeType: String(item?.mimeType || "").trim() || "application/octet-stream",
      fileSize: Number(item?.fileSize || 0) || 0,
      stagedPath: String(item?.stagedPath || "").trim(),
      preview: String(item?.preview || "").trim() || ""
    }))
  };
  if (payload.attachments.some((item) => !item.stagedPath)) {
    throw new Error("存在未完成的附件，请重新添加后再发送");
  }

  const optimisticMessage = {
    id: `local-user-${Date.now()}`,
    role: "user",
    status: payload.attachments.length > 0 ? `附件 ${payload.attachments.length} 个` : "",
    thinking: "",
    body: message || "(仅附件)",
    attachments: payload.attachments
      .map((item) => ({
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        preview: item.preview
      }))
      .filter((item) => item.fileName)
  };
  chatConsoleState.historyMessages.push(optimisticMessage);
  chatConsoleState.attachments = [];
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
  setInput("chat_message_input", "");
  setInput("chat_file_input", "");

  chatConsoleState.streamDeltasByRunId = {};
  chatConsoleState.streamThinkingByRunId = {};
  renderChatMessageList();

  setChatComposerSending(true);
  connectChatStream(sessionKey, { silent: true });
  try {
    const response = await api("/api/chat/send", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const result = response?.result && typeof response.result === "object" ? response.result : {};
    chatConsoleState.lastRunId = String(result.runId || "").trim();
    setInput("chat_last_run_id", chatConsoleState.lastRunId);
    if (!chatConsoleState.lastRunId) {
      setChatComposerSending(false);
    }
    setMessage(
      payload.attachments.length > 0
        ? `消息和附件已发送（status=${result.status || "unknown"}，附件=${payload.attachments.length}）`
        : `消息已发送（status=${result.status || "unknown"}）`,
      "ok"
    );
    setChatInlineHint("消息已发送，正在等待回复...", "ok");
  } catch (error) {
    setChatComposerSending(false);
    chatConsoleState.historyMessages = chatConsoleState.historyMessages.filter((item) => item.id !== optimisticMessage.id);
    chatConsoleState.attachments = attachments;
    renderChatAttachments();
    renderChatMessageList();
    throw error;
  }
}

function setupChatAttachmentInput() {
  const fileInput = document.querySelector("#chat_file_input");
  const pickBtn = document.querySelector("#chat_pick_files");
  const attachmentList = document.querySelector("#chat_attachment_list");
  const messageInput = document.querySelector("#chat_message_input");

  pickBtn?.addEventListener("click", () => {
    fileInput?.click();
  });

  fileInput?.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    if (files.length === 0) {
      return;
    }
    stageChatFiles(files).catch((error) => reportChatActionError(error, "附件处理失败"));
    fileInput.value = "";
  });

  attachmentList?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const idx = Number.parseInt(String(target.dataset.attachmentIndex || ""), 10);
    if (Number.isInteger(idx)) {
      removeChatAttachmentByIndex(idx);
    }
  });

  const dragTargets = [messageInput, attachmentList].filter(Boolean);
  dragTargets.forEach((node) => {
    node.addEventListener("dragover", (event) => {
      event.preventDefault();
      attachmentList?.classList.add("is-dragover");
    });
    node.addEventListener("dragleave", () => {
      attachmentList?.classList.remove("is-dragover");
    });
    node.addEventListener("drop", (event) => {
      event.preventDefault();
      attachmentList?.classList.remove("is-dragover");
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0) {
        stageChatFiles(files).catch((error) => reportChatActionError(error, "附件处理失败"));
      }
    });
  });

  messageInput?.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    stageChatFiles(files).catch((error) => reportChatActionError(error, "附件处理失败"));
  });
}

async function abortChatConsoleRun() {
  const sessionKey = String(getInputValue("chat_session_select") || chatConsoleState.selectedSessionKey || "").trim();
  if (!sessionKey) {
    throw new Error("请先选择会话");
  }
  const runId = String(getInputValue("chat_last_run_id") || "").trim();
  const response = await api("/api/chat/abort", {
    method: "POST",
    body: JSON.stringify({
      sessionKey,
      runId
    })
  });
  const result = response?.result && typeof response.result === "object" ? response.result : {};
  const runIds = Array.isArray(result.runIds) ? result.runIds : [];
  setChatComposerSending(false);
  setMessage(
    result.aborted ? `已发送中止请求，runIds=${runIds.join(",") || "-"}` : "当前没有可中止的运行任务",
    result.aborted ? "ok" : "info"
  );
  setChatInlineHint(result.aborted ? "已发送停止请求" : "当前没有可停止的任务", result.aborted ? "ok" : "");
  await loadChatHistory({ sessionKey, silent: true }).catch(() => {});
}

async function resetChatConsoleSession() {
  const sessionKey = String(getInputValue("chat_session_select") || chatConsoleState.selectedSessionKey || "").trim();
  if (!sessionKey) {
    throw new Error("请先选择会话");
  }
  await api("/api/chat/session/reset", {
    method: "POST",
    body: JSON.stringify({
      sessionKey,
      reason: "reset"
    })
  });
  chatConsoleState.lastRunId = "";
  setInput("chat_last_run_id", "");
  setChatComposerSending(false);
  chatConsoleState.streamDeltasByRunId = {};
  chatConsoleState.streamThinkingByRunId = {};
  chatConsoleState.attachments = [];
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
  renderChatMessageList();
  setMessage(`会话已重置：${sessionKey}`, "ok");
  setChatInlineHint("会话已清空", "ok");
  await loadChatHistory({ sessionKey, silent: true }).catch(() => {});
}

function setupChatConsole() {
  if (chatConsoleState.bound) {
    return;
  }
  chatConsoleState.bound = true;
  setChatStreamStatus("未连接");
  setChatComposerSending(false);
  renderChatAttachments();
  setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
  setChatInlineHint("");
  setupChatAttachmentInput();
  const sessionSelect = document.querySelector("#chat_session_select");
  sessionSelect?.addEventListener("change", () => {
    const selected = String(sessionSelect.value || "").trim();
    chatConsoleState.selectedSessionKey = selected;
    setChatComposerSending(false);
    chatConsoleState.attachments = [];
    renderChatAttachments();
    setChatAttachmentHint("支持点击上传、粘贴或拖拽文件（图片会显示预览）");
    connectChatStream(selected, { silent: true, force: true });
    loadChatHistory({ sessionKey: selected }).catch((error) => setMessage(error.message || String(error), "error"));
  });

  document.querySelector("#chat_new_session")?.addEventListener("click", () => {
    createChatSession().catch((error) => reportChatActionError(error, "新建会话失败"));
  });
  document.querySelector("#chat_refresh_sessions")?.addEventListener("click", () => {
    loadChatSessions()
      .then(() => setChatInlineHint("会话列表已刷新", "ok"))
      .catch((error) => reportChatActionError(error, "刷新会话失败"));
  });
  document.querySelector("#chat_load_history")?.addEventListener("click", () => {
    loadChatHistory()
      .then(() => setChatInlineHint("会话历史已刷新", "ok"))
      .catch((error) => reportChatActionError(error, "刷新历史失败"));
  });
  document.querySelector("#chat_reconnect_stream")?.addEventListener("click", () => {
    connectChatStream(chatConsoleState.selectedSessionKey, { force: true });
    setChatInlineHint("已触发实时通道重连", "ok");
  });
  document.querySelector("#chat_send_message")?.addEventListener("click", () => {
    sendChatConsoleMessage().catch((error) => reportChatActionError(error, "发送失败"));
  });
  const messageInput = document.querySelector("#chat_message_input");
  messageInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendChatConsoleMessage().catch((error) => reportChatActionError(error, "发送失败"));
    }
  });
  document.querySelector("#chat_show_thinking")?.addEventListener("change", () => {
    renderChatMessageList();
  });
  document.querySelector("#chat_abort_run")?.addEventListener("click", () => {
    abortChatConsoleRun().catch((error) => reportChatActionError(error, "停止失败"));
  });
  document.querySelector("#chat_reset_session")?.addEventListener("click", () => {
    resetChatConsoleSession().catch((error) => reportChatActionError(error, "重置会话失败"));
  });

  window.addEventListener("beforeunload", () => {
    closeChatStreamSource();
  });
}


export {
  loadChatSessions,
  setupChatConsole
};

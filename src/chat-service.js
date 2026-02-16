import { randomUUID } from "node:crypto";
import { callGatewayRpc, subscribeGatewayEvents } from "./gateway-client.js";

const CHAT_GATEWAY_TIMEOUT_MS = 1_000;
const CHAT_GATEWAY_RETRIES = 6;
const CHAT_GATEWAY_RETRY_DELAY_MS = 1_000;

function trimString(value) {
  return String(value || "").trim();
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

async function callChatRpc(panelConfig, method, params, deps = {}, options = {}) {
  const callRpc = deps.callGatewayRpc || callGatewayRpc;
  const gatewayToken = trimString(deps.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN);
  return await callRpc({
    panelConfig,
    method,
    params: params || {},
    expectFinal: options.expectFinal === true,
    timeoutMs: toPositiveInt(options.timeoutMs, CHAT_GATEWAY_TIMEOUT_MS),
    retries: toPositiveInt(options.retries, CHAT_GATEWAY_RETRIES),
    retryDelayMs: toPositiveInt(options.retryDelayMs, CHAT_GATEWAY_RETRY_DELAY_MS),
    token: gatewayToken
  });
}

function normalizeSessionItem(item) {
  return {
    key: trimString(item?.key),
    displayName: trimString(item?.displayName || item?.key),
    kind: trimString(item?.kind),
    updatedAt: Number(item?.updatedAt || 0) || 0,
    sessionId: trimString(item?.sessionId),
    modelProvider: trimString(item?.modelProvider),
    model: trimString(item?.model),
    contextTokens: Number(item?.contextTokens || 0) || null,
    totalTokens: Number(item?.totalTokens || 0) || null,
    abortedLastRun: item?.abortedLastRun === true
  };
}

function getCanonicalSessionPrefix(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const canonical = list.find((item) => trimString(item?.key).startsWith("agent:"));
  if (!canonical) {
    return "";
  }
  const parts = trimString(canonical.key).split(":");
  if (parts.length < 2) {
    return "";
  }
  return `${parts[0]}:${parts[1]}`;
}

function normalizeSessionPrefix(value) {
  const raw = trimString(value).replace(/:+$/, "");
  if (!raw) {
    return "";
  }
  if (raw.includes(":")) {
    return raw;
  }
  return `agent:${raw}`;
}

function buildSessionKey(prefix) {
  const finalPrefix = normalizeSessionPrefix(prefix) || "agent:main";
  return `${finalPrefix}:session-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function normalizeChatEventPayload(eventFrame) {
  const payload = eventFrame?.payload && typeof eventFrame.payload === "object" ? eventFrame.payload : {};
  return {
    type: "chat",
    event: "chat",
    seq: Number(eventFrame?.seq || 0) || null,
    at: Date.now(),
    runId: trimString(payload?.runId),
    sessionKey: trimString(payload?.sessionKey),
    state: trimString(payload?.state),
    stopReason: trimString(payload?.stopReason),
    errorMessage: trimString(payload?.errorMessage),
    message: payload?.message && typeof payload.message === "object" ? payload.message : payload?.message ?? null
  };
}

function normalizeAgentEventPayload(eventFrame) {
  const payload = eventFrame?.payload && typeof eventFrame.payload === "object" ? eventFrame.payload : {};
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  return {
    type: "agent",
    event: "agent",
    seq: Number(eventFrame?.seq || 0) || null,
    at: Date.now(),
    runId: trimString(payload?.runId),
    sessionKey: trimString(payload?.sessionKey),
    stream: trimString(payload?.stream),
    phase: trimString(data?.phase),
    data
  };
}

function isTerminalChatState(state) {
  return state === "final" || state === "error" || state === "aborted";
}

export async function listChatSessions({ panelConfig, deps = {} }) {
  const payload = await callChatRpc(panelConfig, "sessions.list", {}, deps);
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions.map((item) => normalizeSessionItem(item)) : [];
  return {
    total: Number(payload?.count || sessions.length) || sessions.length,
    sessions
  };
}

export async function getChatHistory({
  panelConfig,
  sessionKey,
  limit = 200,
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }

  const payload = await callChatRpc(
    panelConfig,
    "chat.history",
    {
      sessionKey: normalizedSessionKey,
      limit: toPositiveInt(limit, 200)
    },
    deps
  );

  return {
    sessionKey: normalizedSessionKey,
    sessionId: trimString(payload?.sessionId),
    thinkingLevel: trimString(payload?.thinkingLevel),
    verboseLevel: trimString(payload?.verboseLevel),
    messages: Array.isArray(payload?.messages) ? payload.messages : []
  };
}

export async function sendChatMessage({
  panelConfig,
  sessionKey,
  message,
  thinking = "",
  attachments = [],
  idempotencyKey = "",
  timeoutMs,
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  const normalizedMessage = trimString(message);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }
  if (!normalizedMessage && (!Array.isArray(attachments) || attachments.length === 0)) {
    throw new Error("message 或 attachments 至少填一个");
  }

  const finalIdempotencyKey = trimString(idempotencyKey) || randomUUID();
  const payload = await callChatRpc(
    panelConfig,
    "chat.send",
    {
      sessionKey: normalizedSessionKey,
      message: normalizedMessage,
      thinking: trimString(thinking),
      attachments: Array.isArray(attachments) ? attachments : [],
      idempotencyKey: finalIdempotencyKey
    },
    deps,
    {
      timeoutMs: toPositiveInt(timeoutMs, CHAT_GATEWAY_TIMEOUT_MS)
    }
  );

  return {
    sessionKey: normalizedSessionKey,
    runId: trimString(payload?.runId),
    status: trimString(payload?.status),
    idempotencyKey: finalIdempotencyKey
  };
}

export async function createChatSession({
  panelConfig,
  keyPrefix = "",
  deps = {}
}) {
  let resolvedPrefix = normalizeSessionPrefix(keyPrefix);
  if (!resolvedPrefix) {
    try {
      const listed = await listChatSessions({ panelConfig, deps });
      resolvedPrefix = getCanonicalSessionPrefix(listed?.sessions);
    } catch {
      resolvedPrefix = "";
    }
  }
  const sessionKey = buildSessionKey(resolvedPrefix || "agent:main");
  const result = await resetChatSession({
    panelConfig,
    sessionKey,
    reason: "new",
    deps
  });
  return {
    key: trimString(result?.key || sessionKey),
    entry: result?.entry && typeof result.entry === "object" ? result.entry : {}
  };
}

export async function abortChatRun({
  panelConfig,
  sessionKey,
  runId = "",
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }

  const payload = await callChatRpc(
    panelConfig,
    "chat.abort",
    {
      sessionKey: normalizedSessionKey,
      ...(trimString(runId) ? { runId: trimString(runId) } : {})
    },
    deps
  );

  return {
    sessionKey: normalizedSessionKey,
    aborted: payload?.aborted === true,
    runIds: Array.isArray(payload?.runIds) ? payload.runIds : []
  };
}

export async function resetChatSession({
  panelConfig,
  sessionKey,
  reason = "new",
  deps = {}
}) {
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }
  const normalizedReason = reason === "reset" ? "reset" : "new";

  const payload = await callChatRpc(
    panelConfig,
    "sessions.reset",
    {
      key: normalizedSessionKey,
      reason: normalizedReason
    },
    deps
  );

  return {
    key: trimString(payload?.key || normalizedSessionKey),
    entry: payload?.entry && typeof payload.entry === "object" ? payload.entry : {}
  };
}

export function createChatEventSubscription({
  panelConfig,
  sessionKey,
  includeAgent = true,
  deps = {},
  onEvent,
  onError,
  onClose
}) {
  const subscribeEvents = deps.subscribeGatewayEvents || subscribeGatewayEvents;
  const gatewayToken = trimString(deps.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN);
  const normalizedSessionKey = trimString(sessionKey);
  if (!normalizedSessionKey) {
    throw new Error("sessionKey 不能为空");
  }

  return subscribeEvents({
    panelConfig,
    token: gatewayToken,
    onEvent: (eventFrame) => {
      const eventName = trimString(eventFrame?.event);
      if (!eventName) {
        return;
      }

      if (eventName === "chat") {
        const normalized = normalizeChatEventPayload(eventFrame);
        if (normalized.sessionKey !== normalizedSessionKey) {
          return;
        }
        onEvent?.(normalized);
        if (isTerminalChatState(normalized.state)) {
          onEvent?.({
            type: "terminal",
            event: "terminal",
            at: Date.now(),
            runId: normalized.runId,
            sessionKey: normalized.sessionKey,
            state: normalized.state
          });
        }
        return;
      }

      if (includeAgent && eventName === "agent") {
        const normalized = normalizeAgentEventPayload(eventFrame);
        if (normalized.sessionKey !== normalizedSessionKey) {
          return;
        }
        onEvent?.(normalized);
      }
    },
    onError,
    onClose
  });
}

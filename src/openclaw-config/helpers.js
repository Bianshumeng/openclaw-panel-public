import { isLikelyMasked } from "../utils.js";

function pickChannel(config, key, fallback = {}) {
  return config?.channels?.[key] || fallback;
}

function toDelimitedList(input) {
  if (!Array.isArray(input)) {
    return "";
  }
  return input.map((v) => String(v).trim()).filter(Boolean).join("\n");
}

function parseDelimitedText(input) {
  const raw = String(input || "")
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(raw)];
}

function toOptionalPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function toOptionalNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeInlineButtons(rawCapabilities) {
  if (Array.isArray(rawCapabilities)) {
    return rawCapabilities.map((item) => String(item || "").trim()).includes("inlineButtons") ? "all" : "allowlist";
  }
  const value = String(rawCapabilities?.inlineButtons || "").trim();
  if (["off", "dm", "group", "all", "allowlist"].includes(value)) {
    return value;
  }
  return "allowlist";
}

function toPrettyJson(value) {
  if (!value || typeof value !== "object") {
    return "";
  }
  try {
    if (Array.isArray(value)) {
      return value.length > 0 ? JSON.stringify(value, null, 2) : "";
    }
    return Object.keys(value).length > 0 ? JSON.stringify(value, null, 2) : "";
  } catch {
    return "";
  }
}

function parseOptionalJson(value, fieldName, expectedType) {
  const displayNameMap = {
    groupsJson: "Telegram 群组覆盖（groupsJson）",
    accountsJson: "Telegram 账号映射（accountsJson）",
    customCommandsJson: "Telegram 自定义命令（customCommandsJson）",
    draftChunkJson: "Telegram 草稿分块（draftChunkJson）"
  };
  const displayName = displayNameMap[fieldName] || fieldName;
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${displayName} 不是有效 JSON`);
  }
  if (expectedType === "array") {
    if (!Array.isArray(parsed)) {
      throw new Error(`${displayName} 必须是数组 JSON`);
    }
    return parsed;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${displayName} 必须是对象 JSON`);
  }
  return parsed;
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function pickDefaultAccount(channelConfig) {
  const accounts = channelConfig?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return {
      accountId: "main",
      account: {}
    };
  }
  if (accounts.main && typeof accounts.main === "object") {
    return {
      accountId: "main",
      account: accounts.main
    };
  }
  const first = Object.entries(accounts).find(([, value]) => value && typeof value === "object");
  if (!first) {
    return {
      accountId: "main",
      account: {}
    };
  }
  return {
    accountId: first[0],
    account: first[1]
  };
}

function resolveSecret(nextValue, currentValue) {
  if (!nextValue || isLikelyMasked(nextValue)) {
    return currentValue || "";
  }
  return nextValue;
}

function toPositiveIntOrFallback(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeInputList(input, fallback) {
  const raw = Array.isArray(input) ? input : Array.isArray(fallback) ? fallback : [];
  return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeModelDraft(nextDraft, fallbackModel = {}) {
  const fallbackId = String(fallbackModel?.id || "").trim();
  const modelId = String(nextDraft?.id || fallbackId).trim();
  const modelName = String(nextDraft?.name || fallbackModel?.name || modelId).trim() || modelId;
  const normalized = {
    ...fallbackModel,
    ...nextDraft,
    id: modelId,
    name: modelName,
    contextWindow: toPositiveIntOrFallback(
      nextDraft?.contextWindow,
      toPositiveIntOrFallback(fallbackModel?.contextWindow, 200000)
    ),
    maxTokens: toPositiveIntOrFallback(nextDraft?.maxTokens, toPositiveIntOrFallback(fallbackModel?.maxTokens, 8192))
  };

  const normalizedInput = normalizeInputList(nextDraft?.input, fallbackModel?.input);
  if (normalizedInput.length > 0) {
    normalized.input = normalizedInput;
  } else {
    delete normalized.input;
  }

  if (nextDraft?.reasoning === undefined && fallbackModel?.reasoning !== undefined) {
    normalized.reasoning = Boolean(fallbackModel.reasoning);
  } else if (nextDraft?.reasoning !== undefined) {
    normalized.reasoning = Boolean(nextDraft.reasoning);
  }

  if (nextDraft?.cost === undefined && fallbackModel?.cost !== undefined) {
    normalized.cost = fallbackModel.cost;
  }

  return normalized;
}

function setOptionalString(target, key, value) {
  const text = String(value || "").trim();
  if (text) {
    target[key] = text;
    return;
  }
  delete target[key];
}

function setOptionalNumber(target, key, value, { allowZero = false } = {}) {
  const parsed = Number(value);
  const valid = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    delete target[key];
    return;
  }
  target[key] = Math.floor(parsed);
}

export {
  pickChannel,
  toDelimitedList,
  parseDelimitedText,
  toOptionalPositiveInt,
  toOptionalNonNegativeInt,
  normalizeInlineButtons,
  toPrettyJson,
  parseOptionalJson,
  firstNonEmptyString,
  pickDefaultAccount,
  resolveSecret,
  toPositiveIntOrFallback,
  normalizeInputList,
  normalizeModelDraft,
  setOptionalString,
  setOptionalNumber
};

import fs from "node:fs/promises";
import { z } from "zod";
import { expandHome, isLikelyMasked, maskSecret, nowIso, readJsonFile, writeJsonFileAtomic } from "./utils.js";

const modelDraftSchema = z.object({
  id: z.string().min(1, "model.id 不能为空"),
  name: z.string().optional().default(""),
  api: z.string().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.string()).optional(),
  cost: z.record(z.number()).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional()
});

const settingsSchema = z.object({
  model: z.object({
    primary: z.string().min(1, "model.primary 不能为空"),
    providerId: z.string().min(1, "model.providerId 不能为空"),
    providerApi: z.string().min(1, "model.providerApi 不能为空"),
    providerBaseUrl: z.string().min(1, "model.providerBaseUrl 不能为空"),
    providerApiKey: z.string().optional().default(""),
    modelId: z.string().min(1, "model.modelId 不能为空"),
    modelName: z.string().min(1, "model.modelName 不能为空"),
    contextWindow: z.number().int().positive().default(200000),
    maxTokens: z.number().int().positive().default(8192),
    providerModels: z.array(modelDraftSchema).optional().default([])
  }),
  channels: z
    .object({
      telegram: z.object({
        enabled: z.boolean().default(false),
        botToken: z.string().optional().default(""),
        tokenFile: z.string().optional().default(""),
        dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        groupAllowFrom: z.string().optional().default(""),
        requireMention: z.boolean().default(true),
        streamMode: z.enum(["off", "partial", "block"]).default("partial"),
        chunkMode: z.enum(["length", "newline"]).default("length"),
        textChunkLimit: z.number().int().positive().nullable().optional().default(null),
        replyToMode: z.enum(["off", "first", "all"]).default("off"),
        linkPreview: z.boolean().default(true),
        blockStreaming: z.boolean().default(false),
        timeoutSeconds: z.number().int().positive().nullable().optional().default(null),
        mediaMaxMb: z.number().int().positive().nullable().optional().default(null),
        dmHistoryLimit: z.number().int().nonnegative().nullable().optional().default(null),
        historyLimit: z.number().int().nonnegative().nullable().optional().default(null),
        webhookUrl: z.string().optional().default(""),
        webhookSecret: z.string().optional().default(""),
        webhookPath: z.string().optional().default("/telegram-webhook"),
        proxy: z.string().optional().default(""),
        configWrites: z.boolean().default(true),
        reactionLevel: z.enum(["off", "ack", "minimal", "extensive"]).default("minimal"),
        reactionNotifications: z.enum(["off", "own", "all"]).default("own"),
        inlineButtons: z.enum(["off", "dm", "group", "all", "allowlist"]).default("allowlist"),
        actionSendMessage: z.boolean().default(true),
        actionReactions: z.boolean().default(true),
        actionDeleteMessage: z.boolean().default(true),
        actionSticker: z.boolean().default(false),
        networkAutoSelectFamily: z.boolean().nullable().optional().default(null),
        retryAttempts: z.number().int().positive().nullable().optional().default(null),
        retryMinDelayMs: z.number().int().positive().nullable().optional().default(null),
        retryMaxDelayMs: z.number().int().positive().nullable().optional().default(null),
        retryJitter: z.boolean().default(true),
        commandsNative: z.enum(["default", "auto", "true", "false"]).default("default"),
        groupsJson: z.string().optional().default(""),
        accountsJson: z.string().optional().default(""),
        customCommandsJson: z.string().optional().default(""),
        draftChunkJson: z.string().optional().default("")
      }),
      feishu: z.object({
        enabled: z.boolean().default(false),
        appId: z.string().optional().default(""),
        appSecret: z.string().optional().default(""),
        domain: z.string().optional().default("feishu"),
        connectionMode: z.enum(["websocket", "webhook"]).default("websocket"),
        dmPolicy: z.enum(["open", "pairing", "allowlist"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        groupAllowFrom: z.string().optional().default(""),
        requireMention: z.boolean().default(true)
      }),
      discord: z.object({
        enabled: z.boolean().default(false),
        token: z.string().optional().default(""),
        dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        allowBots: z.boolean().default(false),
        requireMention: z.boolean().default(true)
      }),
      slack: z.object({
        enabled: z.boolean().default(false),
        mode: z.enum(["socket", "http"]).default("socket"),
        botToken: z.string().optional().default(""),
        appToken: z.string().optional().default(""),
        signingSecret: z.string().optional().default(""),
        dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).default("pairing"),
        allowFrom: z.string().optional().default(""),
        groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
        allowBots: z.boolean().default(false),
        requireMention: z.boolean().default(true)
      })
    })
    .optional()
});

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
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${fieldName} 不是有效 JSON`);
  }
  if (expectedType === "array") {
    if (!Array.isArray(parsed)) {
      throw new Error(`${fieldName} 必须是数组 JSON`);
    }
    return parsed;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} 必须是对象 JSON`);
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

export async function loadOpenClawConfig(configPath) {
  return readJsonFile(expandHome(configPath), {});
}

export function extractSettings(openclawConfig) {
  const providers = openclawConfig?.models?.providers || {};
  const agentDefaults = openclawConfig?.agents?.defaults || {};
  const agentModelOverrides = agentDefaults?.models && typeof agentDefaults.models === "object" ? agentDefaults.models : {};
  const globalThinkingDefault = String(agentDefaults?.thinkingDefault || "").trim();
  const primaryRef = openclawConfig?.agents?.defaults?.model?.primary || "";
  const [primaryProviderId, primaryModelId] = primaryRef.includes("/")
    ? primaryRef.split("/", 2)
    : ["", ""];

  const providerId = primaryProviderId || Object.keys(providers)[0] || "anthropic";
  const provider = providers[providerId] || {};
  const providerModels = Array.isArray(provider.models) ? provider.models : [];
  const model =
    providerModels.find((item) => String(item?.id || "") === String(primaryModelId || "")) ||
    providerModels[0] ||
    {};

  const telegram = pickChannel(openclawConfig, "telegram", {});
  const rawFeishu = pickChannel(
    openclawConfig,
    "feishu",
    pickChannel(openclawConfig, "feishu-china", {})
  );
  const feishuAccount = pickDefaultAccount(rawFeishu);
  const feishu = {
    ...rawFeishu,
    ...(feishuAccount.account || {})
  };
  const rawDiscord = pickChannel(openclawConfig, "discord", {});
  const discordAccount = pickDefaultAccount(rawDiscord);
  const discord = {
    ...rawDiscord,
    ...(discordAccount.account || {})
  };
  const rawSlack = pickChannel(openclawConfig, "slack", {});
  const slackAccount = pickDefaultAccount(rawSlack);
  const slack = {
    ...rawSlack,
    ...(slackAccount.account || {})
  };
  const telegramWildcardGroup = telegram?.groups?.["*"] || {};
  const telegramActions = telegram?.actions && typeof telegram.actions === "object" ? telegram.actions : {};
  const telegramRetry = telegram?.retry && typeof telegram.retry === "object" ? telegram.retry : {};
  const telegramNetwork = telegram?.network && typeof telegram.network === "object" ? telegram.network : {};
  const telegramInlineButtons = normalizeInlineButtons(telegram?.capabilities);
  const telegramCommands = telegram?.commands && typeof telegram.commands === "object" ? telegram.commands : {};
  const telegramCommandsNative =
    typeof telegramCommands.native === "boolean"
      ? String(telegramCommands.native)
      : String(telegramCommands.native || "").trim() === "auto"
      ? "auto"
      : "default";
  const discordWildcardGuild = discord?.guilds?.["*"] || {};
  const discordDmPolicy = discord.dmPolicy || discord?.dm?.policy || "pairing";
  const discordAllowFrom = discord.allowFrom ?? discord?.dm?.allowFrom ?? [];
  const slackDmPolicy = slack.dmPolicy || slack?.dm?.policy || "pairing";
  const slackAllowFrom = slack.allowFrom ?? slack?.dm?.allowFrom ?? [];
  const providerEntries = Object.entries(providers).map(([id, item]) => {
    const models = Array.isArray(item?.models) ? item.models : [];
    return {
      id,
      api: String(item?.api || ""),
      baseUrl: String(item?.baseUrl || ""),
      modelCount: models.length,
      models: models.map((providerModel) => {
        const modelId = String(providerModel?.id || "");
        const modelRef = `${id}/${modelId}`;
        const modelOverride = agentModelOverrides?.[modelRef] || {};
        const thinkingStrength =
          firstNonEmptyString([
            modelOverride?.thinkingStrength,
            modelOverride?.thinking,
            modelOverride?.thinkingLevel,
            modelOverride?.reasoningEffort,
            providerModel?.thinkingStrength,
            providerModel?.thinking,
            providerModel?.thinkingLevel,
            providerModel?.reasoningEffort,
            globalThinkingDefault
          ]) || "无";

        return {
          id: modelId,
          name: String(providerModel?.name || providerModel?.id || ""),
          reasoning: Boolean(providerModel?.reasoning),
          input: Array.isArray(providerModel?.input) ? providerModel.input.map((inputType) => String(inputType)) : [],
          contextWindow: Number(providerModel?.contextWindow || 0) || undefined,
          maxTokens: Number(providerModel?.maxTokens || 0) || undefined,
          thinkingStrength
        };
      })
    };
  });
  const modelRefs = providerEntries.flatMap((entry) =>
    entry.models.map((providerModel) => ({
      ref: `${entry.id}/${providerModel.id}`,
      providerId: entry.id,
      providerApi: entry.api,
      providerBaseUrl: entry.baseUrl,
      modelId: providerModel.id,
      modelName: providerModel.name || providerModel.id,
      contextWindow: providerModel.contextWindow,
      maxTokens: providerModel.maxTokens,
      thinkingStrength: providerModel.thinkingStrength || "无"
    }))
  );
  const currentModelRef = primaryRef || `${providerId}/${model.id || "default-model"}`;
  const currentModelRefEntry = modelRefs.find((entry) => entry.ref === currentModelRef);

  return {
    model: {
      primary: currentModelRef,
      providerId,
      providerApi: provider.api || "anthropic-messages",
      providerBaseUrl: provider.baseUrl || "https://api.anthropic.com",
      providerApiKey: maskSecret(provider.apiKey || ""),
      modelId: model.id || "claude-sonnet-4-5-20250929",
      modelName: model.name || model.id || "Claude Sonnet",
      contextWindow: Number(model.contextWindow || 200000),
      maxTokens: Number(model.maxTokens || 8192),
      thinkingStrength: currentModelRefEntry?.thinkingStrength || "无",
      catalog: {
        providers: providerEntries,
        modelRefs
      }
    },
    channels: {
      telegram: {
        enabled: Boolean(telegram.enabled),
        botToken: maskSecret(telegram.botToken || telegram.token || ""),
        tokenFile: telegram.tokenFile || "",
        dmPolicy: telegram.dmPolicy || "pairing",
        allowFrom: toDelimitedList(telegram.allowFrom || []),
        groupPolicy: telegram.groupPolicy || "allowlist",
        groupAllowFrom: toDelimitedList(telegram.groupAllowFrom || []),
        requireMention: telegramWildcardGroup.requireMention !== false,
        streamMode: telegram.streamMode || "partial",
        chunkMode: telegram.chunkMode || "length",
        textChunkLimit: toOptionalPositiveInt(telegram.textChunkLimit),
        replyToMode: telegram.replyToMode || "off",
        linkPreview: telegram.linkPreview !== false,
        blockStreaming: telegram.blockStreaming === true,
        timeoutSeconds: toOptionalPositiveInt(telegram.timeoutSeconds),
        mediaMaxMb: toOptionalPositiveInt(telegram.mediaMaxMb),
        dmHistoryLimit: toOptionalNonNegativeInt(telegram.dmHistoryLimit),
        historyLimit: toOptionalNonNegativeInt(telegram.historyLimit),
        webhookUrl: telegram.webhookUrl || "",
        webhookSecret: maskSecret(telegram.webhookSecret || ""),
        webhookPath: telegram.webhookPath || "/telegram-webhook",
        proxy: telegram.proxy || "",
        configWrites: telegram.configWrites !== false,
        reactionLevel: telegram.reactionLevel || "minimal",
        reactionNotifications: telegram.reactionNotifications || "own",
        inlineButtons: telegramInlineButtons,
        actionSendMessage: telegramActions.sendMessage !== false,
        actionReactions: telegramActions.reactions !== false,
        actionDeleteMessage: telegramActions.deleteMessage !== false,
        actionSticker: telegramActions.sticker === true,
        networkAutoSelectFamily:
          typeof telegramNetwork.autoSelectFamily === "boolean" ? telegramNetwork.autoSelectFamily : null,
        retryAttempts: toOptionalPositiveInt(telegramRetry.attempts),
        retryMinDelayMs: toOptionalPositiveInt(telegramRetry.minDelayMs),
        retryMaxDelayMs: toOptionalPositiveInt(telegramRetry.maxDelayMs),
        retryJitter: typeof telegramRetry.jitter === "boolean" ? telegramRetry.jitter : true,
        commandsNative: telegramCommandsNative,
        groupsJson: toPrettyJson(telegram.groups),
        accountsJson: toPrettyJson(telegram.accounts),
        customCommandsJson: toPrettyJson(telegram.customCommands),
        draftChunkJson: toPrettyJson(telegram.draftChunk)
      },
      feishu: {
        enabled: Boolean(feishu.enabled),
        appId: feishu.appId || "",
        appSecret: maskSecret(feishu.appSecret || ""),
        domain: feishu.domain || "feishu",
        connectionMode: feishu.connectionMode || "websocket",
        dmPolicy: feishu.dmPolicy || "pairing",
        allowFrom: toDelimitedList(feishu.allowFrom || []),
        groupPolicy: feishu.groupPolicy || "allowlist",
        groupAllowFrom: toDelimitedList(feishu.groupAllowFrom || []),
        requireMention: feishu.requireMention !== false
      },
      discord: {
        enabled: Boolean(discord.enabled),
        token: maskSecret(discord.token || ""),
        dmPolicy: discordDmPolicy,
        allowFrom: toDelimitedList(discordAllowFrom),
        groupPolicy: discord.groupPolicy || "allowlist",
        allowBots: Boolean(discord.allowBots),
        requireMention: discordWildcardGuild.requireMention !== false
      },
      slack: {
        enabled: Boolean(slack.enabled),
        mode: slack.mode || "socket",
        botToken: maskSecret(slack.botToken || ""),
        appToken: maskSecret(slack.appToken || ""),
        signingSecret: maskSecret(slack.signingSecret || ""),
        dmPolicy: slackDmPolicy,
        allowFrom: toDelimitedList(slackAllowFrom),
        groupPolicy: slack.groupPolicy || "allowlist",
        allowBots: Boolean(slack.allowBots),
        requireMention: slack.requireMention !== false
      }
    }
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

export function applySettings(currentConfig, payload) {
  const parsed = settingsSchema.parse(payload);
  const providerId = parsed.model.providerId.trim();
  const modelId = parsed.model.modelId.trim();
  const primaryRef = String(parsed.model.primary || "").trim() || `${providerId}/${modelId}`;

  const next = structuredClone(currentConfig || {});

  if (!next.models) {
    next.models = {};
  }
  if (!next.models.providers) {
    next.models.providers = {};
  }
  if (!next.models.providers[providerId]) {
    next.models.providers[providerId] = {};
  }

  const provider = next.models.providers[providerId];
  provider.baseUrl = parsed.model.providerBaseUrl;
  provider.api = parsed.model.providerApi;
  provider.apiKey = resolveSecret(parsed.model.providerApiKey, provider.apiKey);

  const existingProviderModels = Array.isArray(provider.models) ? [...provider.models] : [];
  const modelPatchList = Array.isArray(parsed.model.providerModels)
    ? parsed.model.providerModels.map((draft) => ({
        ...draft,
        id: String(draft.id || "").trim()
      }))
    : [];
  if (modelPatchList.length > 0) {
    const existingById = new Map(
      existingProviderModels
        .map((providerModel) => [String(providerModel?.id || "").trim(), providerModel])
        .filter(([id]) => Boolean(id))
    );
    const touchedIds = new Set();
    const mergedPatchedModels = modelPatchList
      .filter((draft) => draft.id)
      .map((draft) => {
        touchedIds.add(draft.id);
        return normalizeModelDraft(draft, existingById.get(draft.id) || {});
      });
    const untouchedModels = existingProviderModels.filter((providerModel) => {
      const id = String(providerModel?.id || "").trim();
      return id && !touchedIds.has(id);
    });
    provider.models = [...mergedPatchedModels, ...untouchedModels];
  } else {
    const existingModelIndex = existingProviderModels.findIndex((item) => String(item?.id || "") === modelId);
    const mergedModel = normalizeModelDraft(
      {
        id: modelId,
        name: parsed.model.modelName.trim(),
        contextWindow: parsed.model.contextWindow,
        maxTokens: parsed.model.maxTokens
      },
      existingModelIndex >= 0 ? existingProviderModels[existingModelIndex] : {}
    );
    if (existingModelIndex >= 0) {
      existingProviderModels[existingModelIndex] = mergedModel;
    } else {
      existingProviderModels.unshift(mergedModel);
    }
    provider.models = existingProviderModels;
  }

  if (!next.models.mode) {
    next.models.mode = "merge";
  }

  if (!next.agents) {
    next.agents = {};
  }
  if (!next.agents.defaults) {
    next.agents.defaults = {};
  }
  if (!next.agents.defaults.model) {
    next.agents.defaults.model = {};
  }
  next.agents.defaults.model.primary = primaryRef;

  if (parsed.channels) {
    if (!next.channels) {
      next.channels = {};
    }

    if (!next.channels.telegram) {
      next.channels.telegram = {};
    }
    const telegram = next.channels.telegram;
    telegram.enabled = parsed.channels.telegram.enabled;
    telegram.dmPolicy = parsed.channels.telegram.dmPolicy;
    telegram.groupPolicy = parsed.channels.telegram.groupPolicy;
    telegram.allowFrom = parseDelimitedText(parsed.channels.telegram.allowFrom);
    telegram.groupAllowFrom = parseDelimitedText(parsed.channels.telegram.groupAllowFrom);
    telegram.streamMode = parsed.channels.telegram.streamMode;
    telegram.chunkMode = parsed.channels.telegram.chunkMode;
    telegram.replyToMode = parsed.channels.telegram.replyToMode;
    telegram.linkPreview = parsed.channels.telegram.linkPreview;
    telegram.blockStreaming = parsed.channels.telegram.blockStreaming;
    telegram.configWrites = parsed.channels.telegram.configWrites;
    telegram.reactionLevel = parsed.channels.telegram.reactionLevel;
    telegram.reactionNotifications = parsed.channels.telegram.reactionNotifications;

    setOptionalString(telegram, "tokenFile", parsed.channels.telegram.tokenFile);
    setOptionalString(telegram, "webhookUrl", parsed.channels.telegram.webhookUrl);
    setOptionalString(telegram, "webhookPath", parsed.channels.telegram.webhookPath);
    setOptionalString(telegram, "proxy", parsed.channels.telegram.proxy);
    setOptionalNumber(telegram, "textChunkLimit", parsed.channels.telegram.textChunkLimit);
    setOptionalNumber(telegram, "timeoutSeconds", parsed.channels.telegram.timeoutSeconds);
    setOptionalNumber(telegram, "mediaMaxMb", parsed.channels.telegram.mediaMaxMb);
    setOptionalNumber(telegram, "dmHistoryLimit", parsed.channels.telegram.dmHistoryLimit, { allowZero: true });
    setOptionalNumber(telegram, "historyLimit", parsed.channels.telegram.historyLimit, { allowZero: true });

    const groupsOverride = parseOptionalJson(parsed.channels.telegram.groupsJson, "groupsJson", "object");
    if (groupsOverride !== null) {
      telegram.groups = groupsOverride;
    }
    const accountsOverride = parseOptionalJson(parsed.channels.telegram.accountsJson, "accountsJson", "object");
    if (accountsOverride !== null) {
      telegram.accounts = accountsOverride;
    } else {
      delete telegram.accounts;
    }
    const customCommandsOverride = parseOptionalJson(
      parsed.channels.telegram.customCommandsJson,
      "customCommandsJson",
      "array"
    );
    if (customCommandsOverride !== null) {
      telegram.customCommands = customCommandsOverride;
    } else {
      delete telegram.customCommands;
    }
    const draftChunkOverride = parseOptionalJson(parsed.channels.telegram.draftChunkJson, "draftChunkJson", "object");
    if (draftChunkOverride !== null) {
      telegram.draftChunk = draftChunkOverride;
    } else {
      delete telegram.draftChunk;
    }

    if (telegram.dmPolicy === "open") {
      const allowFrom = telegram.allowFrom || [];
      if (!allowFrom.includes("*")) {
        throw new Error('telegram 开放模式要求 allowFrom 至少包含 "*"');
      }
    }

    if (!telegram.groups || typeof telegram.groups !== "object" || Array.isArray(telegram.groups)) {
      telegram.groups = {};
    }
    if (!telegram.groups["*"] || typeof telegram.groups["*"] !== "object") {
      telegram.groups["*"] = {};
    }
    telegram.groups["*"].requireMention = parsed.channels.telegram.requireMention;

    if (!telegram.capabilities || typeof telegram.capabilities !== "object" || Array.isArray(telegram.capabilities)) {
      telegram.capabilities = {};
    }
    telegram.capabilities.inlineButtons = parsed.channels.telegram.inlineButtons;

    if (!telegram.actions || typeof telegram.actions !== "object") {
      telegram.actions = {};
    }
    telegram.actions.sendMessage = parsed.channels.telegram.actionSendMessage;
    telegram.actions.reactions = parsed.channels.telegram.actionReactions;
    telegram.actions.deleteMessage = parsed.channels.telegram.actionDeleteMessage;
    telegram.actions.sticker = parsed.channels.telegram.actionSticker;

    if (!telegram.commands || typeof telegram.commands !== "object") {
      telegram.commands = {};
    }
    if (parsed.channels.telegram.commandsNative === "default") {
      delete telegram.commands.native;
    } else if (parsed.channels.telegram.commandsNative === "auto") {
      telegram.commands.native = "auto";
    } else {
      telegram.commands.native = parsed.channels.telegram.commandsNative === "true";
    }
    if (Object.keys(telegram.commands).length === 0) {
      delete telegram.commands;
    }

    if (!telegram.network || typeof telegram.network !== "object") {
      telegram.network = {};
    }
    if (parsed.channels.telegram.networkAutoSelectFamily === null) {
      delete telegram.network.autoSelectFamily;
    } else {
      telegram.network.autoSelectFamily = parsed.channels.telegram.networkAutoSelectFamily;
    }
    if (Object.keys(telegram.network).length === 0) {
      delete telegram.network;
    }

    if (!telegram.retry || typeof telegram.retry !== "object") {
      telegram.retry = {};
    }
    setOptionalNumber(telegram.retry, "attempts", parsed.channels.telegram.retryAttempts);
    setOptionalNumber(telegram.retry, "minDelayMs", parsed.channels.telegram.retryMinDelayMs);
    setOptionalNumber(telegram.retry, "maxDelayMs", parsed.channels.telegram.retryMaxDelayMs);
    telegram.retry.jitter = parsed.channels.telegram.retryJitter;

    const existingWebhookSecret = telegram.webhookSecret || "";
    const webhookSecret = resolveSecret(parsed.channels.telegram.webhookSecret, existingWebhookSecret);
    if (webhookSecret) {
      telegram.webhookSecret = webhookSecret;
    } else {
      delete telegram.webhookSecret;
    }

    const existingTelegramToken = telegram.botToken || telegram.token || "";
    const telegramToken = resolveSecret(parsed.channels.telegram.botToken, existingTelegramToken);
    if (telegramToken) {
      telegram.botToken = telegramToken;
      telegram.token = telegramToken;
    } else {
      delete telegram.botToken;
      delete telegram.token;
    }

    if (!next.channels.feishu || typeof next.channels.feishu !== "object") {
      next.channels.feishu = {};
    }
    const feishu = next.channels.feishu;
    feishu.enabled = parsed.channels.feishu.enabled;
    feishu.appId = parsed.channels.feishu.appId;
    feishu.appSecret = resolveSecret(parsed.channels.feishu.appSecret, feishu.appSecret);
    feishu.domain = parsed.channels.feishu.domain;
    feishu.connectionMode = parsed.channels.feishu.connectionMode;
    feishu.dmPolicy = parsed.channels.feishu.dmPolicy;
    feishu.groupPolicy = parsed.channels.feishu.groupPolicy;
    feishu.allowFrom = parseDelimitedText(parsed.channels.feishu.allowFrom);
    feishu.groupAllowFrom = parseDelimitedText(parsed.channels.feishu.groupAllowFrom);
    feishu.requireMention = parsed.channels.feishu.requireMention;

    if (feishu.dmPolicy === "open") {
      const allowFrom = feishu.allowFrom || [];
      if (!allowFrom.includes("*")) {
        throw new Error('feishu 开放模式要求 allowFrom 至少包含 "*"');
      }
    }

    if (feishu.accounts && typeof feishu.accounts === "object") {
      const accountId = feishu.accounts.main ? "main" : Object.keys(feishu.accounts)[0] || "main";
      if (!feishu.accounts[accountId] || typeof feishu.accounts[accountId] !== "object") {
        feishu.accounts[accountId] = {};
      }
      const account = feishu.accounts[accountId];
      account.enabled = parsed.channels.feishu.enabled;
      account.appId = parsed.channels.feishu.appId;
      account.appSecret = resolveSecret(parsed.channels.feishu.appSecret, account.appSecret);
      account.domain = parsed.channels.feishu.domain;
      account.connectionMode = parsed.channels.feishu.connectionMode;
      account.dmPolicy = parsed.channels.feishu.dmPolicy;
      account.groupPolicy = parsed.channels.feishu.groupPolicy;
      account.allowFrom = parseDelimitedText(parsed.channels.feishu.allowFrom);
      account.groupAllowFrom = parseDelimitedText(parsed.channels.feishu.groupAllowFrom);
      account.requireMention = parsed.channels.feishu.requireMention;
    }

    if (next.channels["feishu-china"] && typeof next.channels["feishu-china"] === "object") {
      next.channels["feishu-china"].enabled = parsed.channels.feishu.enabled;
      next.channels["feishu-china"].appId = parsed.channels.feishu.appId;
      next.channels["feishu-china"].appSecret = resolveSecret(
        parsed.channels.feishu.appSecret,
        next.channels["feishu-china"].appSecret
      );
    }

    if (!next.channels.discord || typeof next.channels.discord !== "object") {
      next.channels.discord = {};
    }
    const discord = next.channels.discord;
    const discordAllowFrom = parseDelimitedText(parsed.channels.discord.allowFrom);
    discord.enabled = parsed.channels.discord.enabled;
    discord.dmPolicy = parsed.channels.discord.dmPolicy;
    discord.allowFrom = discordAllowFrom;
    discord.groupPolicy = parsed.channels.discord.groupPolicy;
    discord.allowBots = parsed.channels.discord.allowBots;

    if (!discord.dm || typeof discord.dm !== "object") {
      discord.dm = {};
    }
    discord.dm.policy = parsed.channels.discord.dmPolicy;
    discord.dm.allowFrom = discordAllowFrom;

    if (discord.dmPolicy === "open" && !discordAllowFrom.includes("*")) {
      throw new Error('discord 开放模式要求 allowFrom 至少包含 "*"');
    }

    if (!discord.guilds || typeof discord.guilds !== "object") {
      discord.guilds = {};
    }
    if (!discord.guilds["*"] || typeof discord.guilds["*"] !== "object") {
      discord.guilds["*"] = {};
    }
    discord.guilds["*"].requireMention = parsed.channels.discord.requireMention;

    discord.token = resolveSecret(parsed.channels.discord.token, discord.token);

    if (discord.accounts && typeof discord.accounts === "object") {
      const accountId = discord.accounts.main ? "main" : Object.keys(discord.accounts)[0] || "main";
      if (!discord.accounts[accountId] || typeof discord.accounts[accountId] !== "object") {
        discord.accounts[accountId] = {};
      }
      const account = discord.accounts[accountId];
      account.enabled = parsed.channels.discord.enabled;
      account.dmPolicy = parsed.channels.discord.dmPolicy;
      account.allowFrom = discordAllowFrom;
      account.groupPolicy = parsed.channels.discord.groupPolicy;
      account.allowBots = parsed.channels.discord.allowBots;
      if (!account.dm || typeof account.dm !== "object") {
        account.dm = {};
      }
      account.dm.policy = parsed.channels.discord.dmPolicy;
      account.dm.allowFrom = discordAllowFrom;
      if (!account.guilds || typeof account.guilds !== "object") {
        account.guilds = {};
      }
      if (!account.guilds["*"] || typeof account.guilds["*"] !== "object") {
        account.guilds["*"] = {};
      }
      account.guilds["*"].requireMention = parsed.channels.discord.requireMention;
      account.token = resolveSecret(parsed.channels.discord.token, account.token);
    }

    if (!next.channels.slack || typeof next.channels.slack !== "object") {
      next.channels.slack = {};
    }
    const slack = next.channels.slack;
    const slackAllowFrom = parseDelimitedText(parsed.channels.slack.allowFrom);
    slack.enabled = parsed.channels.slack.enabled;
    slack.mode = parsed.channels.slack.mode;
    slack.dmPolicy = parsed.channels.slack.dmPolicy;
    slack.allowFrom = slackAllowFrom;
    slack.groupPolicy = parsed.channels.slack.groupPolicy;
    slack.allowBots = parsed.channels.slack.allowBots;
    slack.requireMention = parsed.channels.slack.requireMention;

    if (!slack.dm || typeof slack.dm !== "object") {
      slack.dm = {};
    }
    slack.dm.policy = parsed.channels.slack.dmPolicy;
    slack.dm.allowFrom = slackAllowFrom;

    if (slack.dmPolicy === "open" && !slackAllowFrom.includes("*")) {
      throw new Error('slack 开放模式要求 allowFrom 至少包含 "*"');
    }

    slack.botToken = resolveSecret(parsed.channels.slack.botToken, slack.botToken);
    slack.appToken = resolveSecret(parsed.channels.slack.appToken, slack.appToken);
    slack.signingSecret = resolveSecret(parsed.channels.slack.signingSecret, slack.signingSecret);

    if (slack.mode === "http" && !slack.signingSecret) {
      throw new Error('slack HTTP 模式要求 signingSecret 不能为空');
    }

    if (slack.accounts && typeof slack.accounts === "object") {
      const accountId = slack.accounts.main ? "main" : Object.keys(slack.accounts)[0] || "main";
      if (!slack.accounts[accountId] || typeof slack.accounts[accountId] !== "object") {
        slack.accounts[accountId] = {};
      }
      const account = slack.accounts[accountId];
      account.enabled = parsed.channels.slack.enabled;
      account.mode = parsed.channels.slack.mode;
      account.dmPolicy = parsed.channels.slack.dmPolicy;
      account.allowFrom = slackAllowFrom;
      account.groupPolicy = parsed.channels.slack.groupPolicy;
      account.allowBots = parsed.channels.slack.allowBots;
      account.requireMention = parsed.channels.slack.requireMention;
      if (!account.dm || typeof account.dm !== "object") {
        account.dm = {};
      }
      account.dm.policy = parsed.channels.slack.dmPolicy;
      account.dm.allowFrom = slackAllowFrom;
      account.botToken = resolveSecret(parsed.channels.slack.botToken, account.botToken);
      account.appToken = resolveSecret(parsed.channels.slack.appToken, account.appToken);
      account.signingSecret = resolveSecret(parsed.channels.slack.signingSecret, account.signingSecret);
      if (account.mode === "http" && !(account.signingSecret || slack.signingSecret)) {
        throw new Error(`slack 账号 ${accountId} 的 HTTP 模式需要 signingSecret`);
      }
    }
  }

  return next;
}

export async function saveOpenClawConfig(configPath, content) {
  const realPath = expandHome(configPath);
  const backupPath = `${realPath}.bak.${nowIso().replaceAll(":", "-")}`;
  try {
    await fs.copyFile(realPath, backupPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  await writeJsonFileAtomic(realPath, content, 0o600);
  return {
    path: realPath,
    backupPath
  };
}

export const openClawSettingsSchema = settingsSchema;

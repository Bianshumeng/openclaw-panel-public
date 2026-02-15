import fs from "node:fs/promises";
import { z } from "zod";
import { expandHome, isLikelyMasked, maskSecret, nowIso, readJsonFile, writeJsonFileAtomic } from "./utils.js";

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
    maxTokens: z.number().int().positive().default(8192)
  }),
  channels: z.object({
    telegram: z.object({
      enabled: z.boolean().default(false),
      botToken: z.string().optional().default(""),
      dmPolicy: z.enum(["open", "pairing", "allowlist", "disabled"]).default("pairing"),
      allowFrom: z.string().optional().default(""),
      groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("allowlist"),
      groupAllowFrom: z.string().optional().default(""),
      requireMention: z.boolean().default(true),
      streamMode: z.enum(["off", "partial", "block"]).default("partial")
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
  const discordWildcardGuild = discord?.guilds?.["*"] || {};
  const discordDmPolicy = discord.dmPolicy || discord?.dm?.policy || "pairing";
  const discordAllowFrom = discord.allowFrom ?? discord?.dm?.allowFrom ?? [];
  const slackDmPolicy = slack.dmPolicy || slack?.dm?.policy || "pairing";
  const slackAllowFrom = slack.allowFrom ?? slack?.dm?.allowFrom ?? [];

  return {
    model: {
      primary: primaryRef || `${providerId}/${model.id || "default-model"}`,
      providerId,
      providerApi: provider.api || "anthropic-messages",
      providerBaseUrl: provider.baseUrl || "https://api.anthropic.com",
      providerApiKey: maskSecret(provider.apiKey || ""),
      modelId: model.id || "claude-sonnet-4-5-20250929",
      modelName: model.name || model.id || "Claude Sonnet",
      contextWindow: Number(model.contextWindow || 200000),
      maxTokens: Number(model.maxTokens || 8192)
    },
    channels: {
      telegram: {
        enabled: Boolean(telegram.enabled),
        botToken: maskSecret(telegram.botToken || telegram.token || ""),
        dmPolicy: telegram.dmPolicy || "pairing",
        allowFrom: toDelimitedList(telegram.allowFrom || []),
        groupPolicy: telegram.groupPolicy || "allowlist",
        groupAllowFrom: toDelimitedList(telegram.groupAllowFrom || []),
        requireMention: telegramWildcardGroup.requireMention !== false,
        streamMode: telegram.streamMode || "partial"
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

export function applySettings(currentConfig, payload) {
  const parsed = settingsSchema.parse(payload);
  const providerId = parsed.model.providerId.trim();
  const modelId = parsed.model.modelId.trim();
  const modelRef = `${providerId}/${modelId}`;

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

  const providerModels = Array.isArray(provider.models) ? [...provider.models] : [];
  const existingModelIndex = providerModels.findIndex((item) => String(item?.id || "") === modelId);
  const mergedModel = {
    ...(existingModelIndex >= 0 ? providerModels[existingModelIndex] : {}),
    id: modelId,
    name: parsed.model.modelName.trim(),
    reasoning: false,
    input: ["text"],
    contextWindow: parsed.model.contextWindow,
    maxTokens: parsed.model.maxTokens
  };
  if (existingModelIndex >= 0) {
    providerModels[existingModelIndex] = mergedModel;
  } else {
    providerModels.unshift(mergedModel);
  }
  provider.models = providerModels;

  if (!next.agents) {
    next.agents = {};
  }
  if (!next.agents.defaults) {
    next.agents.defaults = {};
  }
  if (!next.agents.defaults.model) {
    next.agents.defaults.model = {};
  }
  next.agents.defaults.model.primary = modelRef;

  if (!next.channels) {
    next.channels = {};
  }

  if (!next.channels.telegram) {
    next.channels.telegram = {};
  }
  next.channels.telegram.enabled = parsed.channels.telegram.enabled;
  next.channels.telegram.dmPolicy = parsed.channels.telegram.dmPolicy;
  next.channels.telegram.groupPolicy = parsed.channels.telegram.groupPolicy;
  next.channels.telegram.allowFrom = parseDelimitedText(parsed.channels.telegram.allowFrom);
  next.channels.telegram.groupAllowFrom = parseDelimitedText(parsed.channels.telegram.groupAllowFrom);
  next.channels.telegram.streamMode = parsed.channels.telegram.streamMode;

  if (next.channels.telegram.dmPolicy === "open") {
    const allowFrom = next.channels.telegram.allowFrom || [];
    if (!allowFrom.includes("*")) {
      throw new Error('telegram 开放模式要求 allowFrom 至少包含 "*"');
    }
  }

  if (!next.channels.telegram.groups || typeof next.channels.telegram.groups !== "object") {
    next.channels.telegram.groups = {};
  }
  if (!next.channels.telegram.groups["*"] || typeof next.channels.telegram.groups["*"] !== "object") {
    next.channels.telegram.groups["*"] = {};
  }
  next.channels.telegram.groups["*"].requireMention = parsed.channels.telegram.requireMention;

  const existingTelegramToken = next.channels.telegram.botToken || next.channels.telegram.token || "";
  const telegramToken = resolveSecret(parsed.channels.telegram.botToken, existingTelegramToken);
  if (telegramToken) {
    next.channels.telegram.botToken = telegramToken;
    next.channels.telegram.token = telegramToken;
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

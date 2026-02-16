import {
  normalizeModelDraft,
  parseDelimitedText,
  parseOptionalJson,
  resolveSecret,
  setOptionalNumber,
  setOptionalString
} from "./helpers.js";
import { settingsSchema } from "./schema.js";

function applySettings(currentConfig, payload) {
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

export { applySettings };

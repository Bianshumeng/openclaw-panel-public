import { maskSecret } from "../utils.js";
import {
  firstNonEmptyString,
  normalizeInlineButtons,
  pickChannel,
  pickDefaultAccount,
  toDelimitedList,
  toOptionalNonNegativeInt,
  toOptionalPositiveInt,
  toPrettyJson
} from "./helpers.js";

function extractSettings(openclawConfig) {
  const providers = openclawConfig?.models?.providers || {};
  const agentDefaults = openclawConfig?.agents?.defaults || {};
  const agentModelOverrides = agentDefaults?.models && typeof agentDefaults.models === "object" ? agentDefaults.models : {};
  const globalThinkingDefault = String(agentDefaults?.thinkingDefault || "").trim();
  const primaryRef = String(openclawConfig?.agents?.defaults?.model?.primary || "").trim();
  const [primaryProviderId, primaryModelId] = primaryRef.includes("/") ? primaryRef.split("/", 2) : ["", ""];

  const providerIds = Object.keys(providers);
  const hasPrimaryProvider = Boolean(primaryProviderId && Object.prototype.hasOwnProperty.call(providers, primaryProviderId));
  const providerId = hasPrimaryProvider ? primaryProviderId : providerIds[0] || "";
  const provider = providerId ? providers[providerId] || {} : {};
  const providerModels = Array.isArray(provider.models) ? provider.models : [];
  const model =
    providerModels.find((item) => String(item?.id || "") === String(primaryModelId || "")) || providerModels[0] || {};

  const telegram = pickChannel(openclawConfig, "telegram", {});
  const rawFeishu = pickChannel(openclawConfig, "feishu", pickChannel(openclawConfig, "feishu-china", {}));
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
  const currentModelRef = primaryRef || (providerId && model.id ? `${providerId}/${model.id}` : "");
  const currentModelRefEntry = modelRefs.find((entry) => entry.ref === currentModelRef);

  return {
    model: {
      primary: currentModelRef,
      providerId,
      providerApi: String(provider.api || ""),
      providerBaseUrl: String(provider.baseUrl || ""),
      providerApiKey: maskSecret(provider.apiKey || ""),
      modelId: String(model.id || ""),
      modelName: String(model.name || model.id || ""),
      contextWindow: Number(model.contextWindow || 0) || undefined,
      maxTokens: Number(model.maxTokens || 0) || undefined,
      thinkingStrength: currentModelRefEntry?.thinkingStrength || globalThinkingDefault || "无",
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

export { extractSettings };

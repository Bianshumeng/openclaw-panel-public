import {
  api,
  channelSettingsSnapshot,
  els,
  getInputValue,
  modelEditorState,
  setInput,
  setMessage,
  setText
} from "../core/panel-core.js";
import {
  fillModelEditor,
  renderDashboardModelCards,
  updateDashboardErrorSummary,
  updateDashboardVersionSummary
} from "./model-dashboard-page.js";

let stream = null;
const UPDATE_TARGET_CONFIG = Object.freeze({
  bot: {
    label: "龙虾 Bot",
    stateId: "bot_update_state",
    hintId: "bot_update_hint",
    currentTagId: "bot_update_current_tag",
    latestTagId: "bot_update_latest_tag",
    targetTagId: "bot_update_target_tag",
    checkButtonId: "bot_check_update",
    upgradeButtonId: "bot_upgrade_update",
    rollbackButtonId: "bot_rollback_update",
    progressWrapId: "bot_update_progress_wrap",
    progressBarId: "bot_update_progress",
    progressTextId: "bot_update_progress_text"
  },
  panel: {
    label: "龙虾控制台",
    stateId: "panel_update_state",
    hintId: "panel_update_hint",
    currentTagId: "panel_update_current_tag",
    latestTagId: "panel_update_latest_tag",
    targetTagId: "panel_update_target_tag",
    checkButtonId: "panel_check_update",
    upgradeButtonId: "panel_upgrade_update",
    rollbackButtonId: "panel_rollback_update",
    applyButtonId: "panel_apply_update",
    progressWrapId: "panel_update_progress_wrap",
    progressBarId: "panel_update_progress",
    progressTextId: "panel_update_progress_text"
  }
});

function normalizeUpdateTarget(target = "bot") {
  return target === "panel" ? "panel" : "bot";
}

function getUpdateTargetConfig(target = "bot") {
  return UPDATE_TARGET_CONFIG[normalizeUpdateTarget(target)];
}

function fillPanelMeta(config, deployment = {}) {
  const runtime = config.runtime?.mode || "systemd";
  const target =
    runtime === "docker" ? config.openclaw.container_name || config.openclaw.service_name : config.openclaw.service_name;
  if (els.metaServiceName) {
    els.metaServiceName.textContent = `target: ${target}`;
  }
  if (els.metaLogSource) {
    els.metaLogSource.textContent = `log: ${config.log.source} (${runtime})`;
  }
  setInput("dashboard_panel_local_url", deployment.panelLocalUrl || "-");
  setInput("dashboard_panel_public_url", deployment.panelPublicUrl || "未配置（请填写公网 IP + 端口）");
  setInput("dashboard_gateway_public_url", deployment.gatewayPublicUrl || "未配置（请填写公网 IP + 端口）");
  setInput("dashboard_webhook_base_url", deployment.webhookBaseUrl || "未配置（请填写公网 IP + 端口）");
  if (els.dashboardPublicHint) {
    if (deployment.hasPublicEndpoint && deployment.hasWebhookEndpoint) {
      els.dashboardPublicHint.textContent = "公网访问地址与 Webhook 回调基地址已就绪，可直接复制到外部平台。";
    } else {
      els.dashboardPublicHint.innerHTML =
        "若为空，请在 <code>data/panel/panel.config.json</code> 的 <code>reverse_proxy</code> 中填写公网 IP 与端口。";
    }
  }
  if (els.serviceHint) {
    els.serviceHint.textContent =
      runtime === "docker" ? "当前为 Docker 运行时，按钮将控制容器。" : "当前为 systemd 运行时，按钮将控制服务。";
  }
}

function setUpdateState(text, mode = "info", target = "bot") {
  const config = getUpdateTargetConfig(target);
  const stateElement = document.querySelector(`#${config.stateId}`);
  if (!stateElement) {
    return;
  }
  stateElement.textContent = text;
  stateElement.classList.toggle("success", mode === "success");
  stateElement.classList.toggle("fail", mode === "fail");
}

function setUpdateHint(text, target = "bot") {
  const config = getUpdateTargetConfig(target);
  const hintElement = document.querySelector(`#${config.hintId}`);
  if (!hintElement) {
    return;
  }
  hintElement.textContent = text;
}

const updateActionLocks = {
  bot: false,
  panel: false
};

const updateProgressState = {
  bot: {
    value: 0,
    timer: null
  },
  panel: {
    value: 0,
    timer: null
  }
};

function setUpdateProgress(value = 0, { target = "bot", mode = "idle", text = "" } = {}) {
  const targetKey = normalizeUpdateTarget(target);
  const targetConfig = getUpdateTargetConfig(targetKey);
  const wrap = document.querySelector(`#${targetConfig.progressWrapId}`);
  const progress = document.querySelector(`#${targetConfig.progressBarId}`);
  const progressText = document.querySelector(`#${targetConfig.progressTextId}`);
  if (!wrap || !(progress instanceof HTMLProgressElement) || !progressText) {
    return;
  }

  const normalizedValue = Math.max(0, Math.min(100, Number(value) || 0));
  updateProgressState[targetKey].value = normalizedValue;
  progress.value = normalizedValue;
  progressText.textContent = text || `等待操作（${Math.round(normalizedValue)}%）`;
  wrap.classList.toggle("is-working", mode === "working");
  wrap.classList.toggle("is-done", mode === "done");
  wrap.classList.toggle("is-fail", mode === "fail");
}

function stopUpdateProgressTicker(target = "bot") {
  const targetKey = normalizeUpdateTarget(target);
  const timer = updateProgressState[targetKey].timer;
  if (timer) {
    clearInterval(timer);
    updateProgressState[targetKey].timer = null;
  }
}

function startUpdateProgressTicker(target = "bot", text = "正在处理...") {
  const targetKey = normalizeUpdateTarget(target);
  stopUpdateProgressTicker(targetKey);
  const initial = Math.max(updateProgressState[targetKey].value || 0, 10);
  setUpdateProgress(initial, {
    target: targetKey,
    mode: "working",
    text: `${text}（${Math.round(initial)}%）`
  });

  updateProgressState[targetKey].timer = setInterval(() => {
    const current = updateProgressState[targetKey].value || 0;
    if (current >= 92) {
      return;
    }
    const step = current < 55 ? 6 : 2;
    const next = Math.min(92, current + step);
    setUpdateProgress(next, {
      target: targetKey,
      mode: "working",
      text: `${text}（${Math.round(next)}%）`
    });
  }, 550);
}

function completeUpdateProgress(target = "bot", { success = true, text = "" } = {}) {
  const targetKey = normalizeUpdateTarget(target);
  stopUpdateProgressTicker(targetKey);
  setUpdateProgress(100, {
    target: targetKey,
    mode: success ? "done" : "fail",
    text: text || `${success ? "操作完成" : "操作失败"}（100%）`
  });
}

function setUpdateButtonsBusy(target = "bot", busy = false) {
  const targetKey = normalizeUpdateTarget(target);
  const targetConfig = getUpdateTargetConfig(targetKey);
  [
    targetConfig.checkButtonId,
    targetConfig.upgradeButtonId,
    targetConfig.rollbackButtonId,
    targetConfig.applyButtonId
  ]
    .filter(Boolean)
    .forEach((id) => {
      const button = document.querySelector(`#${id}`);
      if (!(button instanceof HTMLButtonElement)) {
        return;
      }
      button.disabled = Boolean(busy);
      button.setAttribute("aria-busy", busy ? "true" : "false");
    });
}

function initUpdateProgressState() {
  ["bot", "panel"].forEach((targetKey) => {
    setUpdateProgress(0, {
      target: targetKey,
      mode: "idle",
      text: "等待操作（0%）"
    });
  });
}

function hasNonEmptyChannelValue(value) {
  return String(value ?? "").trim().length > 0;
}

function isChannelConfigured(channelKey, channelSettings = {}) {
  if (!channelSettings || typeof channelSettings !== "object") {
    return false;
  }
  if (channelKey === "telegram") {
    return hasNonEmptyChannelValue(channelSettings.botToken);
  }
  if (channelKey === "feishu") {
    return hasNonEmptyChannelValue(channelSettings.appId) && hasNonEmptyChannelValue(channelSettings.appSecret);
  }
  if (channelKey === "discord") {
    return hasNonEmptyChannelValue(channelSettings.token);
  }
  if (channelKey === "slack") {
    const mode = String(channelSettings.mode || "socket").trim().toLowerCase();
    if (!hasNonEmptyChannelValue(channelSettings.botToken)) {
      return false;
    }
    return mode === "http"
      ? hasNonEmptyChannelValue(channelSettings.signingSecret)
      : hasNonEmptyChannelValue(channelSettings.appToken);
  }
  return false;
}

function setChannelAccessStatusTag(elementId, text, variant) {
  const tag = document.querySelector(`#${elementId}`);
  if (!tag) {
    return;
  }
  tag.textContent = text;
  if ("variant" in tag) {
    tag.variant = variant;
  } else {
    tag.className = `status-pill ${variant}`;
  }
}

function renderChannelAccessOverview(channels = {}) {
  const channelKeys = ["telegram", "feishu", "discord", "slack"];
  channelKeys.forEach((channelKey) => {
    const channelSettings = channels?.[channelKey] && typeof channels[channelKey] === "object" ? channels[channelKey] : {};
    const enabled = Boolean(channelSettings.enabled);
    const configured = isChannelConfigured(channelKey, channelSettings);
    const summary = document.querySelector(`#channel_status_${channelKey}_summary`);
    const card = document.querySelector(`[data-channel-card="${channelKey}"]`);
    const isDisabledCard = Boolean(card?.dataset?.channelDisabled === "true");

    setChannelAccessStatusTag(`channel_status_${channelKey}_enabled`, enabled ? "已启用" : "未启用", enabled ? "success" : "neutral");
    setChannelAccessStatusTag(
      `channel_status_${channelKey}_configured`,
      configured ? "已配置" : "未配置",
      configured ? "success" : "warning"
    );

    if (summary) {
      if (isDisabledCard) {
        summary.textContent = "功能开发中，暂不支持进入配置页。";
      } else if (configured && enabled) {
        summary.textContent = "配置完整，可直接使用。";
      } else if (configured) {
        summary.textContent = "配置已填，但当前处于未启用状态。";
      } else {
        summary.textContent = "还没填完关键凭证，点进去补齐即可。";
      }
    }

    if (card) {
      card.classList.toggle("is-ready", configured && enabled);
      card.classList.toggle("is-partial", configured && !enabled);
      card.classList.toggle("is-missing", !configured);
    }
  });
}

function readChannelString(id, fallback = "") {
  const element = document.querySelector(`#${id}`);
  if (!element) {
    return String(fallback ?? "");
  }
  return String(getInputValue(id) || "");
}

function readChannelBoolean(id, fallback = false) {
  const element = document.querySelector(`#${id}`);
  if (!element) {
    return Boolean(fallback);
  }
  return Boolean(getInputValue(id));
}

function normalizeOptionalPositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function normalizeOptionalNonNegativeInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function readChannelOptionalPositiveInt(id, fallback = null) {
  const element = document.querySelector(`#${id}`);
  if (!element) {
    return normalizeOptionalPositiveInt(fallback);
  }
  const raw = String(getInputValue(id) || "").trim();
  if (!raw) {
    return null;
  }
  return normalizeOptionalPositiveInt(raw);
}

function readChannelOptionalNonNegativeInt(id, fallback = null) {
  const element = document.querySelector(`#${id}`);
  if (!element) {
    return normalizeOptionalNonNegativeInt(fallback);
  }
  const raw = String(getInputValue(id) || "").trim();
  if (!raw) {
    return null;
  }
  return normalizeOptionalNonNegativeInt(raw);
}

function normalizeOptionalProbability(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return null;
  }
  return Number(parsed.toFixed(4));
}

function readChannelOptionalProbability(id, fallback = null) {
  const element = document.querySelector(`#${id}`);
  if (!element) {
    return normalizeOptionalProbability(fallback);
  }
  const raw = String(getInputValue(id) || "").trim();
  if (!raw) {
    return null;
  }
  return normalizeOptionalProbability(raw);
}

function readChannelTriStateBoolean(id, fallback = null) {
  const element = document.querySelector(`#${id}`);
  if (!element) {
    return typeof fallback === "boolean" ? fallback : null;
  }
  const value = String(getInputValue(id) || "default").trim().toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function getChannelSnapshot() {
  const settings = channelSettingsSnapshot.settings;
  if (!settings || typeof settings !== "object") {
    return {};
  }
  const channels = settings.channels;
  if (!channels || typeof channels !== "object") {
    return {};
  }
  return channels;
}

const TELEGRAM_JSON_FIELD_RULES = Object.freeze([
  {
    elementId: "tg_groups_json",
    label: "群组覆盖（groupsJson）",
    expectedType: "object"
  },
  {
    elementId: "tg_accounts_json",
    label: "账号映射（accountsJson）",
    expectedType: "object"
  },
  {
    elementId: "tg_custom_commands_json",
    label: "自定义命令（customCommandsJson）",
    expectedType: "array"
  },
  {
    elementId: "tg_draft_chunk_json",
    label: "草稿分块（draftChunkJson）",
    expectedType: "object"
  }
]);

function validateOptionalJsonField(elementId, label, expectedType) {
  const element = document.querySelector(`#${elementId}`);
  if (!element) {
    return;
  }
  const text = String(getInputValue(elementId) || "").trim();
  if (!text) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} JSON 格式不正确，请检查括号与引号。`);
  }

  const isArray = Array.isArray(parsed);
  if (expectedType === "array" && !isArray) {
    throw new Error(`${label} 必须是 JSON 数组。`);
  }
  if (expectedType === "object" && (!parsed || typeof parsed !== "object" || isArray)) {
    throw new Error(`${label} 必须是 JSON 对象。`);
  }
}

function validateTelegramJsonOverrides() {
  TELEGRAM_JSON_FIELD_RULES.forEach((rule) => {
    validateOptionalJsonField(rule.elementId, `Telegram ${rule.label}`, rule.expectedType);
  });
}

function collectChannelSettings() {
  const snapshot = getChannelSnapshot();
  const telegramSnapshot = snapshot.telegram && typeof snapshot.telegram === "object" ? snapshot.telegram : {};
  const feishuSnapshot = snapshot.feishu && typeof snapshot.feishu === "object" ? snapshot.feishu : {};
  const discordSnapshot = snapshot.discord && typeof snapshot.discord === "object" ? snapshot.discord : {};
  const slackSnapshot = snapshot.slack && typeof snapshot.slack === "object" ? snapshot.slack : {};

  return {
    telegram: {
      enabled: readChannelBoolean("tg_enabled", telegramSnapshot.enabled),
      botToken: readChannelString("tg_bot_token", telegramSnapshot.botToken),
      tokenFile: readChannelString("tg_token_file", telegramSnapshot.tokenFile),
      dmPolicy: readChannelString("tg_dm_policy", telegramSnapshot.dmPolicy || "pairing") || "pairing",
      allowFrom: readChannelString("tg_allow_from", telegramSnapshot.allowFrom),
      groupPolicy: readChannelString("tg_group_policy", telegramSnapshot.groupPolicy || "allowlist") || "allowlist",
      groupAllowFrom: readChannelString("tg_group_allow_from", telegramSnapshot.groupAllowFrom),
      requireMention: readChannelBoolean("tg_require_mention", telegramSnapshot.requireMention),
      streamMode: readChannelString("tg_stream_mode", telegramSnapshot.streamMode || "partial") || "partial",
      chunkMode: readChannelString("tg_chunk_mode", telegramSnapshot.chunkMode || "length") || "length",
      textChunkLimit: readChannelOptionalPositiveInt("tg_text_chunk_limit", telegramSnapshot.textChunkLimit),
      replyToMode: readChannelString("tg_reply_to_mode", telegramSnapshot.replyToMode || "off") || "off",
      linkPreview: readChannelBoolean("tg_link_preview", telegramSnapshot.linkPreview),
      blockStreaming: readChannelBoolean("tg_block_streaming", telegramSnapshot.blockStreaming),
      timeoutSeconds: readChannelOptionalPositiveInt("tg_timeout_seconds", telegramSnapshot.timeoutSeconds),
      mediaMaxMb: readChannelOptionalPositiveInt("tg_media_max_mb", telegramSnapshot.mediaMaxMb),
      dmHistoryLimit: readChannelOptionalNonNegativeInt("tg_dm_history_limit", telegramSnapshot.dmHistoryLimit),
      historyLimit: readChannelOptionalNonNegativeInt("tg_history_limit", telegramSnapshot.historyLimit),
      webhookUrl: readChannelString("tg_webhook_url", telegramSnapshot.webhookUrl),
      webhookSecret: readChannelString("tg_webhook_secret", telegramSnapshot.webhookSecret),
      webhookPath: readChannelString("tg_webhook_path", telegramSnapshot.webhookPath || "/telegram-webhook"),
      proxy: readChannelString("tg_proxy", telegramSnapshot.proxy),
      configWrites: readChannelBoolean("tg_config_writes", telegramSnapshot.configWrites),
      reactionLevel: readChannelString("tg_reaction_level", telegramSnapshot.reactionLevel || "minimal") || "minimal",
      reactionNotifications:
        readChannelString("tg_reaction_notifications", telegramSnapshot.reactionNotifications || "own") || "own",
      inlineButtons: readChannelString("tg_inline_buttons", telegramSnapshot.inlineButtons || "allowlist") || "allowlist",
      actionSendMessage: readChannelBoolean("tg_action_send_message", telegramSnapshot.actionSendMessage),
      actionReactions: readChannelBoolean("tg_action_reactions", telegramSnapshot.actionReactions),
      actionDeleteMessage: readChannelBoolean("tg_action_delete_message", telegramSnapshot.actionDeleteMessage),
      actionSticker: readChannelBoolean("tg_action_sticker", telegramSnapshot.actionSticker),
      networkAutoSelectFamily: readChannelTriStateBoolean(
        "tg_network_auto_select_family",
        telegramSnapshot.networkAutoSelectFamily
      ),
      retryAttempts: readChannelOptionalPositiveInt("tg_retry_attempts", telegramSnapshot.retryAttempts),
      retryMinDelayMs: readChannelOptionalPositiveInt("tg_retry_min_delay_ms", telegramSnapshot.retryMinDelayMs),
      retryMaxDelayMs: readChannelOptionalPositiveInt("tg_retry_max_delay_ms", telegramSnapshot.retryMaxDelayMs),
      retryJitter: readChannelOptionalProbability("tg_retry_jitter", telegramSnapshot.retryJitter),
      commandsNative: readChannelString("tg_commands_native", telegramSnapshot.commandsNative || "default") || "default",
      groupsJson: readChannelString("tg_groups_json", telegramSnapshot.groupsJson),
      accountsJson: readChannelString("tg_accounts_json", telegramSnapshot.accountsJson),
      customCommandsJson: readChannelString("tg_custom_commands_json", telegramSnapshot.customCommandsJson),
      draftChunkJson: readChannelString("tg_draft_chunk_json", telegramSnapshot.draftChunkJson)
    },
    feishu: {
      enabled: readChannelBoolean("fs_enabled", feishuSnapshot.enabled),
      appId: readChannelString("fs_app_id", feishuSnapshot.appId),
      appSecret: readChannelString("fs_app_secret", feishuSnapshot.appSecret),
      domain: readChannelString("fs_domain", feishuSnapshot.domain || "feishu") || "feishu",
      connectionMode: readChannelString("fs_connection_mode", feishuSnapshot.connectionMode || "websocket") || "websocket",
      dmPolicy: readChannelString("fs_dm_policy", feishuSnapshot.dmPolicy || "pairing") || "pairing",
      allowFrom: readChannelString("fs_allow_from", feishuSnapshot.allowFrom),
      groupPolicy: readChannelString("fs_group_policy", feishuSnapshot.groupPolicy || "allowlist") || "allowlist",
      groupAllowFrom: readChannelString("fs_group_allow_from", feishuSnapshot.groupAllowFrom),
      requireMention: readChannelBoolean("fs_require_mention", feishuSnapshot.requireMention)
    },
    discord: {
      enabled: readChannelBoolean("dc_enabled", discordSnapshot.enabled),
      token: readChannelString("dc_token", discordSnapshot.token),
      dmPolicy: readChannelString("dc_dm_policy", discordSnapshot.dmPolicy || "pairing") || "pairing",
      allowFrom: readChannelString("dc_allow_from", discordSnapshot.allowFrom),
      groupPolicy: readChannelString("dc_group_policy", discordSnapshot.groupPolicy || "allowlist") || "allowlist",
      allowBots: readChannelBoolean("dc_allow_bots", discordSnapshot.allowBots),
      requireMention: readChannelBoolean("dc_require_mention", discordSnapshot.requireMention)
    },
    slack: {
      enabled: readChannelBoolean("sl_enabled", slackSnapshot.enabled),
      mode: readChannelString("sl_mode", slackSnapshot.mode || "socket") || "socket",
      botToken: readChannelString("sl_bot_token", slackSnapshot.botToken),
      appToken: readChannelString("sl_app_token", slackSnapshot.appToken),
      signingSecret: readChannelString("sl_signing_secret", slackSnapshot.signingSecret),
      dmPolicy: readChannelString("sl_dm_policy", slackSnapshot.dmPolicy || "pairing") || "pairing",
      allowFrom: readChannelString("sl_allow_from", slackSnapshot.allowFrom),
      groupPolicy: readChannelString("sl_group_policy", slackSnapshot.groupPolicy || "allowlist") || "allowlist",
      allowBots: readChannelBoolean("sl_allow_bots", slackSnapshot.allowBots),
      requireMention: readChannelBoolean("sl_require_mention", slackSnapshot.requireMention)
    }
  };
}

function fillSettings(settings) {
  renderDashboardModelCards(settings.model);
  fillModelEditor(settings.model);
  renderChannelAccessOverview(settings.channels || {});

  setInput("tg_enabled", settings.channels.telegram.enabled);
  setInput("tg_bot_token", settings.channels.telegram.botToken);
  setInput("tg_token_file", settings.channels.telegram.tokenFile);
  setInput("tg_dm_policy", settings.channels.telegram.dmPolicy);
  setInput("tg_allow_from", settings.channels.telegram.allowFrom);
  setInput("tg_group_policy", settings.channels.telegram.groupPolicy);
  setInput("tg_group_allow_from", settings.channels.telegram.groupAllowFrom);
  setInput("tg_require_mention", settings.channels.telegram.requireMention);
  setInput("tg_stream_mode", settings.channels.telegram.streamMode);
  setInput("tg_chunk_mode", settings.channels.telegram.chunkMode);
  setInput("tg_text_chunk_limit", settings.channels.telegram.textChunkLimit ?? "");
  setInput("tg_reply_to_mode", settings.channels.telegram.replyToMode);
  setInput("tg_link_preview", settings.channels.telegram.linkPreview);
  setInput("tg_block_streaming", settings.channels.telegram.blockStreaming);
  setInput("tg_timeout_seconds", settings.channels.telegram.timeoutSeconds ?? "");
  setInput("tg_media_max_mb", settings.channels.telegram.mediaMaxMb ?? "");
  setInput("tg_dm_history_limit", settings.channels.telegram.dmHistoryLimit ?? "");
  setInput("tg_history_limit", settings.channels.telegram.historyLimit ?? "");
  setInput("tg_webhook_url", settings.channels.telegram.webhookUrl);
  setInput("tg_webhook_secret", settings.channels.telegram.webhookSecret);
  setInput("tg_webhook_path", settings.channels.telegram.webhookPath || "/telegram-webhook");
  setInput("tg_proxy", settings.channels.telegram.proxy);
  setInput("tg_config_writes", settings.channels.telegram.configWrites);
  setInput("tg_reaction_level", settings.channels.telegram.reactionLevel);
  setInput("tg_reaction_notifications", settings.channels.telegram.reactionNotifications);
  setInput("tg_inline_buttons", settings.channels.telegram.inlineButtons);
  setInput("tg_action_send_message", settings.channels.telegram.actionSendMessage);
  setInput("tg_action_reactions", settings.channels.telegram.actionReactions);
  setInput("tg_action_delete_message", settings.channels.telegram.actionDeleteMessage);
  setInput("tg_action_sticker", settings.channels.telegram.actionSticker);
  setInput(
    "tg_network_auto_select_family",
    settings.channels.telegram.networkAutoSelectFamily === null
      ? "default"
      : settings.channels.telegram.networkAutoSelectFamily
      ? "true"
      : "false"
  );
  setInput("tg_retry_attempts", settings.channels.telegram.retryAttempts ?? "");
  setInput("tg_retry_min_delay_ms", settings.channels.telegram.retryMinDelayMs ?? "");
  setInput("tg_retry_max_delay_ms", settings.channels.telegram.retryMaxDelayMs ?? "");
  setInput("tg_retry_jitter", settings.channels.telegram.retryJitter ?? "");
  setInput("tg_commands_native", settings.channels.telegram.commandsNative || "default");
  setInput("tg_groups_json", settings.channels.telegram.groupsJson || "");
  setInput("tg_accounts_json", settings.channels.telegram.accountsJson || "");
  setInput("tg_custom_commands_json", settings.channels.telegram.customCommandsJson || "");
  setInput("tg_draft_chunk_json", settings.channels.telegram.draftChunkJson || "");

  setInput("fs_enabled", settings.channels.feishu.enabled);
  setInput("fs_app_id", settings.channels.feishu.appId);
  setInput("fs_app_secret", settings.channels.feishu.appSecret);
  setInput("fs_domain", settings.channels.feishu.domain);
  setInput("fs_connection_mode", settings.channels.feishu.connectionMode);
  setInput("fs_dm_policy", settings.channels.feishu.dmPolicy);
  setInput("fs_allow_from", settings.channels.feishu.allowFrom);
  setInput("fs_group_policy", settings.channels.feishu.groupPolicy);
  setInput("fs_group_allow_from", settings.channels.feishu.groupAllowFrom);
  setInput("fs_require_mention", settings.channels.feishu.requireMention);

  setInput("dc_enabled", settings.channels.discord.enabled);
  setInput("dc_token", settings.channels.discord.token);
  setInput("dc_dm_policy", settings.channels.discord.dmPolicy);
  setInput("dc_allow_from", settings.channels.discord.allowFrom);
  setInput("dc_group_policy", settings.channels.discord.groupPolicy);
  setInput("dc_allow_bots", settings.channels.discord.allowBots);
  setInput("dc_require_mention", settings.channels.discord.requireMention);

  setInput("sl_enabled", settings.channels.slack.enabled);
  setInput("sl_mode", settings.channels.slack.mode);
  setInput("sl_bot_token", settings.channels.slack.botToken);
  setInput("sl_app_token", settings.channels.slack.appToken);
  setInput("sl_signing_secret", settings.channels.slack.signingSecret);
  setInput("sl_dm_policy", settings.channels.slack.dmPolicy);
  setInput("sl_allow_from", settings.channels.slack.allowFrom);
  setInput("sl_group_policy", settings.channels.slack.groupPolicy);
  setInput("sl_allow_bots", settings.channels.slack.allowBots);
  setInput("sl_require_mention", settings.channels.slack.requireMention);
}

async function loadInitialData() {
  const [panelConfig, settings] = await Promise.all([api("/api/panel-config"), api("/api/settings")]);
  channelSettingsSnapshot.settings = settings.settings || null;
  initUpdateProgressState();
  fillPanelMeta(panelConfig.config, panelConfig.deployment || {});
  fillSettings(settings.settings);
}

async function checkUpdate({ silent = false, target = "bot" } = {}) {
  const targetKey = normalizeUpdateTarget(target);
  const targetConfig = getUpdateTargetConfig(targetKey);
  let result;
  try {
    result = await api(`/api/update/check?target=${encodeURIComponent(targetKey)}`);
  } catch (error) {
    const detail = String(error?.message || error || "").trim();
    if (detail.includes("当前不是 Docker 运行模式")) {
      setInput(targetConfig.currentTagId, "");
      setInput(targetConfig.latestTagId, "");
      setUpdateState("直装模式", "success", targetKey);
      setUpdateHint("当前为直装模式，已禁用 Docker 镜像升级/回滚。", targetKey);
      if (targetKey === "bot") {
        setText("dashboard_summary_version", "直装模式");
        setText("dashboard_summary_version_meta", "镜像升级入口已禁用");
      }
      if (!silent) {
        setMessage(`${targetConfig.label}：当前为直装模式，已禁用 Docker 镜像更新。`, "info");
      }
      return {
        disabled: true,
        mode: "systemd"
      };
    }
    throw error;
  }
  const data = result.result || {};

  setInput(targetConfig.currentTagId, data.currentTag || "");
  setInput(targetConfig.latestTagId, data.latestTag || "");
  if (!String(getInputValue(targetConfig.targetTagId) || "").trim() && data.latestTag) {
    setInput(targetConfig.targetTagId, data.latestTag);
  }

  if (data.warning) {
    setUpdateState("检查异常", "fail", targetKey);
    setUpdateHint(`已读取当前版本，但远程版本检查失败：${data.warning}`, targetKey);
    if (targetKey === "bot") {
      updateDashboardVersionSummary(data);
    }
    if (!silent) {
      setMessage(`${targetConfig.label} 更新检查告警：${data.warning}`, "error");
    }
    return data;
  }

  if (data.updateAvailable) {
    setUpdateState("有可用更新", "success", targetKey);
    setUpdateHint(`当前 ${data.currentTag || "-"}，最新 ${data.latestTag || "-"}`, targetKey);
  } else {
    setUpdateState("已是最新", "success", targetKey);
    setUpdateHint(`当前 ${data.currentTag || "-"}，无需升级`, targetKey);
  }
  if (targetKey === "bot") {
    updateDashboardVersionSummary(data);
  }
  if (!silent) {
    setMessage(
      `${targetConfig.label} 版本检查完成：current=${data.currentTag || "-"} latest=${data.latestTag || "-"}`,
      "ok"
    );
  }
  return data;
}

async function checkAllUpdates({ silent = false } = {}) {
  const results = await Promise.allSettled([
    checkUpdate({ silent, target: "bot" }),
    checkUpdate({ silent, target: "panel" })
  ]);
  const firstError = results.find((item) => item.status === "rejected");
  if (firstError && firstError.status === "rejected") {
    throw firstError.reason;
  }
}

async function resolveUpgradeTargetTag(rawTag = "", target = "bot") {
  const targetKey = normalizeUpdateTarget(target);
  const targetConfig = getUpdateTargetConfig(targetKey);
  const directTag = String(rawTag || "").trim();
  if (directTag) {
    return directTag;
  }

  const latestInput = String(getInputValue(targetConfig.latestTagId) || "").trim();
  if (latestInput) {
    setInput(targetConfig.targetTagId, latestInput);
    return latestInput;
  }

  const result = await api(`/api/update/check?target=${encodeURIComponent(targetKey)}`);
  const latestTag = String(result?.result?.latestTag || "").trim();
  if (!latestTag) {
    throw new Error("无法自动获取最新版本，请先点击“检查新版本”或手工填写目标版本");
  }
  setInput(targetConfig.latestTagId, latestTag);
  setInput(targetConfig.targetTagId, latestTag);
  return latestTag;
}

async function mutateVersion(action, { target = "bot" } = {}) {
  const targetKey = normalizeUpdateTarget(target);
  const targetConfig = getUpdateTargetConfig(targetKey);
  if (updateActionLocks[targetKey]) {
    setMessage(`${targetConfig.label} 正在执行更新操作，请稍候`, "info");
    return;
  }

  const actionLabelMap = {
    upgrade: "升级",
    rollback: "回滚",
    apply: "重启并应用"
  };
  const actionLabel = actionLabelMap[action] || "更新";
  let tag = String(getInputValue(targetConfig.targetTagId) || "").trim();
  if (!tag && (action === "upgrade" || action === "apply")) {
    tag = await resolveUpgradeTargetTag(tag, targetKey);
    setMessage(`${targetConfig.label} 未填写目标版本，已自动选择最新版本：${tag}`, "info");
  }
  if (!tag) {
    if (action === "rollback") {
      throw new Error("请先输入回滚目标版本");
    }
    throw new Error("请先输入目标版本");
  }

  updateActionLocks[targetKey] = true;
  setUpdateButtonsBusy(targetKey, true);
  setUpdateState(`${actionLabel}进行中`, "info", targetKey);
  setUpdateHint(`${actionLabel}执行中，请稍候...`, targetKey);
  startUpdateProgressTicker(targetKey, `${actionLabel}执行中`);

  try {
    const endpoint = action === "apply" ? "/api/update/apply" : `/api/update/${action}`;
    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ tag, target: targetKey }),
      allowBusinessError: true
    });
    const payload = result.result || {};
    if (payload.ok) {
      const targetImageTag = String(payload.targetImage || "")
        .trim()
        .split(":")
        .pop();
      const oldImageTag = String(payload.oldImage || "")
        .trim()
        .split(":")
        .pop();

      if (targetKey === "panel" && action !== "apply") {
        const successText = action === "upgrade" ? "镜像已拉取" : "回滚镜像已拉取";
        setUpdateState(successText, "success", targetKey);
        setUpdateHint(payload.message || "镜像已拉取完成，请点击“重启并应用更新”生效", targetKey);
        // pull-only flow: keep current tag as running container tag until apply step recreates the container
        setInput(targetConfig.currentTagId, oldImageTag || "");
        if (targetImageTag) {
          setInput(targetConfig.targetTagId, targetImageTag);
        }
        completeUpdateProgress(targetKey, { success: true, text: `${actionLabel}完成（100%）` });
        setMessage(`${targetConfig.label}${actionLabel}成功：${payload.targetImage}`, "ok");
        return;
      }

      const successStateText =
        action === "apply" ? "已重启并应用" : action === "upgrade" ? "升级成功" : "回滚成功";
      setUpdateState(successStateText, "success", targetKey);
      setUpdateHint(payload.message || `当前镜像：${payload.targetImage || "-"}`, targetKey);
      setInput(targetConfig.currentTagId, targetImageTag || tag);
      completeUpdateProgress(targetKey, { success: true, text: `${actionLabel}完成（100%）` });
      setMessage(`${targetConfig.label}${actionLabel}成功：${payload.targetImage}`, "ok");

      await checkUpdate({ silent: true, target: targetKey }).catch(() => {});
      if (targetKey === "bot") {
        await runService("status").catch(() => {});
        await loadTail().catch(() => {});
      }
      if (targetKey === "panel" && action === "apply" && payload.requiresReconnect) {
        const reconnectDelay = Math.max(2000, Number(payload.reconnectAfterMs) || 6000);
        setMessage(`控制台正在重启，页面将在约 ${Math.ceil(reconnectDelay / 1000)} 秒后自动刷新`, "info");
        window.setTimeout(() => {
          window.location.reload();
        }, reconnectDelay);
      }
      return;
    }

    const rollbackNote = payload.rollbackMessage ? `；${payload.rollbackMessage}` : payload.rolledBack ? "；已自动回滚" : "";
    const detail = `${payload.message || "操作失败"}${rollbackNote}`;
    const failText = action === "apply" ? "应用失败" : action === "upgrade" ? "升级失败" : "回滚失败";
    setUpdateState(failText, "fail", targetKey);
    setUpdateHint(detail, targetKey);
    completeUpdateProgress(targetKey, { success: false, text: `${actionLabel}失败（100%）` });
    setMessage(`${targetConfig.label}${actionLabel}失败：${detail}`, "error");
  } catch (error) {
    const detail = error?.message || String(error);
    const failText = action === "apply" ? "应用失败" : action === "upgrade" ? "升级失败" : "回滚失败";
    setUpdateState(failText, "fail", targetKey);
    setUpdateHint(detail, targetKey);
    completeUpdateProgress(targetKey, { success: false, text: `${actionLabel}失败（100%）` });
    setMessage(`${targetConfig.label}${actionLabel}异常：${detail}`, "error");
  } finally {
    updateActionLocks[targetKey] = false;
    setUpdateButtonsBusy(targetKey, false);
  }
}

async function saveModelSettings(modelPayload, actionLabel) {
  const payload = {
    model: modelPayload
  };
  const result = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  modelEditorState.currentModelPayload = modelPayload;
  setMessage(`${actionLabel}：${result.path}`, "ok");
  await loadInitialData();
}

async function saveSettings() {
  if (!modelEditorState.currentModelPayload) {
    throw new Error("模型配置尚未初始化，请刷新页面后重试");
  }
  validateTelegramJsonOverrides();
  const payload = {
    model: modelEditorState.currentModelPayload,
    channels: collectChannelSettings()
  };
  const result = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  setMessage(`平台接入配置写入成功（模型保持当前值）：${result.path}`, "ok");
  await loadInitialData();
}

async function runService(action, { silentMessage = false, autoRefresh = true } = {}) {
  const result = await api(`/api/service/${action}`, {
    method: "POST",
    allowBusinessError: true
  });
  const payload = result.result || {};
  const output = payload.output || payload.message || "(empty)";
  if (els.serviceOutput) {
    els.serviceOutput.textContent = output;
  }

  if (!result.ok) {
    if (action === "status" && els.serviceState && els.serviceHint) {
      els.serviceState.textContent = "状态异常";
      els.serviceState.classList.toggle("success", false);
      els.serviceState.classList.toggle("fail", true);
      els.serviceHint.textContent = payload.message || "服务状态读取失败，请检查容器或 systemd 权限。";
    }
    if (autoRefresh && action !== "status" && els.serviceState && els.serviceHint) {
      try {
        await runService("status", { silentMessage: true, autoRefresh: false });
      } catch {
        // ignore refresh errors on failure branch; primary error is already surfaced
      }
    }
    if (!silentMessage) {
      setMessage(`service ${action}: 失败 - ${payload.message || payload.output || "未知错误"}`, "error");
    }
    return;
  }

  if (action === "status" && els.serviceState && els.serviceHint) {
    const active = Boolean(payload.active);
    els.serviceState.textContent = active ? "运行中" : "未运行";
    els.serviceState.classList.toggle("success", active);
    els.serviceState.classList.toggle("fail", !active);
    els.serviceHint.textContent = active
      ? "服务状态正常。你可以继续联调渠道或查看日志。"
      : "服务未运行。请先启动或检查 systemd 权限。";
  }
  if (!silentMessage) {
    setMessage(`service ${action}: 成功`, "ok");
  }

  if (autoRefresh && action !== "status" && els.serviceState && els.serviceHint) {
    try {
      await runService("status", { silentMessage: true, autoRefresh: false });
      if (!silentMessage) {
        setMessage("服务状态已自动刷新", "info");
      }
    } catch (error) {
      if (!silentMessage) {
        setMessage(`服务状态自动刷新失败：${error.message || String(error)}`, "error");
      }
    }
  }
}

async function loadTail() {
  if (!els.logOutput) {
    return;
  }
  const filter = encodeURIComponent(String(getInputValue("log_filter") || ""));
  const result = await api(`/api/logs/tail?lines=200&filter=${filter}`);
  els.logOutput.textContent = result.lines.join("\n");
  setMessage(`日志加载完成，共 ${result.lines.length} 行`, "ok");
}

async function loadErrorSummary({ silent = false } = {}) {
  const result = await api("/api/logs/errors?count=20");
  if (els.errorSummary) {
    els.errorSummary.innerHTML = "";
    result.lines.forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      els.errorSummary.appendChild(li);
    });
  }
  updateDashboardErrorSummary(result.lines);
  if (!silent) {
    setMessage(`错误摘要加载完成，共 ${result.lines.length} 条`, "ok");
  }
}

function stopStream() {
  if (stream) {
    stream.close();
    stream = null;
    setMessage("实时日志流已停止", "info");
  }
}

function startStream() {
  stopStream();
  if (!els.logOutput) {
    throw new Error("当前页面未加载日志面板");
  }
  const filter = encodeURIComponent(String(getInputValue("log_filter") || ""));
  stream = new EventSource(`/api/logs/stream?filter=${filter}`);
  stream.addEventListener("line", (event) => {
    const payload = JSON.parse(event.data);
    const next = `${payload.line}\n${els.logOutput.textContent}`;
    els.logOutput.textContent = next.slice(0, 30000);
  });
  stream.addEventListener("error", () => {
    setMessage("日志流出现错误，请检查日志来源配置", "error");
  });
  setMessage("实时日志流已启动", "ok");
}

function setChannelTestResult(elementId, detail, success) {
  const el = document.querySelector(`#${elementId}`);
  if (!el) {
    return;
  }
  const timestamp = new Date().toLocaleTimeString();
  el.textContent = `最近测试（${timestamp}）：${success ? "成功" : "失败"} - ${detail}`;
  el.classList.toggle("success", Boolean(success));
  el.classList.toggle("fail", !success);
}

function setChannelActionResult(elementId, detail, success) {
  const el = document.querySelector(`#${elementId}`);
  if (!el) {
    return;
  }
  const timestamp = new Date().toLocaleTimeString();
  el.textContent = `最近执行（${timestamp}）：${detail}`;
  if (success === null) {
    el.classList.remove("success", "fail");
    return;
  }
  el.classList.toggle("success", Boolean(success));
  el.classList.toggle("fail", !success);
}

function renderTelegramTrace(elementId, steps = []) {
  const trace = document.querySelector(`#${elementId}`);
  if (!trace) {
    return;
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    trace.textContent = "暂无执行记录";
    return;
  }

  const lines = [];
  steps.forEach((step, index) => {
    const label = String(step?.label || `步骤 ${index + 1}`).trim();
    const statusText = step?.ok ? "成功" : "失败";
    const command = String(step?.command || "").trim();
    const output = String(step?.output || "").trim() || "(无输出)";
    lines.push(`[${index + 1}] ${label} - ${statusText}`);
    if (command) {
      lines.push(`命令: ${command}`);
    }
    lines.push(`输出: ${output}`);
    lines.push("");
  });
  trace.textContent = lines.join("\n").trim();
}

const telegramFlowLocks = {
  setup: false,
  pairing: false
};

function setActionButtonBusy(buttonId, busy, busyLabel) {
  const button = document.querySelector(`#${buttonId}`);
  if (!(button instanceof HTMLButtonElement)) {
    return;
  }
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = String(button.textContent || "").trim();
  }
  button.disabled = Boolean(busy);
  button.setAttribute("aria-busy", busy ? "true" : "false");
  button.textContent = busy ? busyLabel : button.dataset.originalLabel;
}

async function runTelegramFlowWithLock({
  lockKey,
  buttonId,
  busyLabel,
  pendingResultId,
  pendingDetail,
  duplicateClickMessage,
  pendingMessage,
  run
}) {
  if (telegramFlowLocks[lockKey]) {
    if (duplicateClickMessage) {
      setMessage(duplicateClickMessage, "info");
    }
    return;
  }

  telegramFlowLocks[lockKey] = true;
  setActionButtonBusy(buttonId, true, busyLabel);
  if (pendingResultId && pendingDetail) {
    setChannelActionResult(pendingResultId, pendingDetail, null);
  }
  if (pendingMessage) {
    setMessage(pendingMessage, "info");
  }

  try {
    await run();
  } finally {
    telegramFlowLocks[lockKey] = false;
    setActionButtonBusy(buttonId, false, busyLabel);
  }
}

async function setupTelegramBasicFlow() {
  const botToken = String(getInputValue("tg_bot_token") || "").trim();
  if (!botToken) {
    setChannelActionResult("tg_setup_result", "失败：请先填写 Bot Token", false);
    throw new Error("Telegram 基础配置失败：Bot Token 不能为空");
  }

  await runTelegramFlowWithLock({
    lockKey: "setup",
    buttonId: "tg_setup_basic",
    busyLabel: "保存中...",
    pendingResultId: "tg_setup_result",
    pendingDetail: "处理中：正在启用 Telegram 插件并写入 Bot Token",
    duplicateClickMessage: "Telegram 基础配置正在处理中，请勿重复点击",
    pendingMessage: "Telegram 基础配置处理中，请稍候…",
    run: async () => {
      const result = await api("/api/channels/telegram/setup", {
        method: "POST",
        body: JSON.stringify({ botToken }),
        allowBusinessError: true
      });
      const payload = result.result && typeof result.result === "object" ? result.result : {};
      const steps = Array.isArray(payload.steps) ? payload.steps : [];
      renderTelegramTrace("tg_setup_trace", steps);

      if (!result.ok || payload.ok === false) {
        const detail = String(payload.message || result.message || "Telegram 基础配置失败");
        setChannelActionResult("tg_setup_result", `失败：${detail}`, false);
        setMessage(`Telegram 基础配置失败：${detail}`, "error");
        return;
      }

      const detail = String(payload.message || "Telegram 基础配置完成");
      setChannelActionResult("tg_setup_result", `成功：${detail}`, true);
      setMessage(detail, "ok");
      await loadInitialData();
    }
  });
}

async function approveTelegramPairingFlow() {
  const code = String(getInputValue("tg_pairing_code") || "").trim();
  if (!code) {
    setChannelActionResult("tg_pairing_result", "失败：请先填写验证码", false);
    throw new Error("Telegram 配对失败：验证码不能为空");
  }

  await runTelegramFlowWithLock({
    lockKey: "pairing",
    buttonId: "tg_pairing_approve",
    busyLabel: "验证中...",
    pendingResultId: "tg_pairing_result",
    pendingDetail: "处理中：正在提交验证码并等待验证结果",
    duplicateClickMessage: "Telegram 验证正在处理中，请勿重复点击",
    pendingMessage: "Telegram 验证处理中，请稍候…",
    run: async () => {
      const result = await api("/api/channels/telegram/pairing/approve", {
        method: "POST",
        body: JSON.stringify({ code }),
        allowBusinessError: true
      });
      const payload = result.result && typeof result.result === "object" ? result.result : {};
      const step = payload.step && typeof payload.step === "object" ? payload.step : null;
      if (step) {
        renderTelegramTrace("tg_pairing_trace", [step]);
      }

      if (!result.ok || payload.ok === false) {
        const detail = String(payload.message || result.message || "验证码验证失败");
        setChannelActionResult("tg_pairing_result", `失败：${detail}`, false);
        setMessage(`Telegram 配对失败：${detail}`, "error");
        return;
      }

      const detail = String(payload.message || "验证码验证成功");
      setChannelActionResult("tg_pairing_result", `成功：${detail}`, true);
      setMessage(detail, "ok");
    }
  });
}

async function saveAndTestTelegram() {
  const botToken = String(getInputValue("tg_bot_token") || "").trim();
  await saveSettings();
  if (botToken) {
    setInput("tg_bot_token", botToken);
  }
  await testTelegram();
}

async function saveAndTestFeishu() {
  const appId = String(getInputValue("fs_app_id") || "").trim();
  const appSecret = String(getInputValue("fs_app_secret") || "").trim();
  await saveSettings();
  if (appId) {
    setInput("fs_app_id", appId);
  }
  if (appSecret) {
    setInput("fs_app_secret", appSecret);
  }
  await testFeishu();
}

async function testTelegram() {
  const payload = {
    botToken: String(getInputValue("tg_bot_token") || "")
  };
  if (!payload.botToken) {
    setChannelTestResult("tg_test_result", "失败：请先填写 Bot Token", false);
    throw new Error("Telegram 测试失败：Bot Token 不能为空");
  }
  const result = await api("/api/test/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("tg_test_result", result.message || "-", result.ok);
  setMessage(`Telegram 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testFeishu() {
  const payload = {
    appId: String(getInputValue("fs_app_id") || ""),
    appSecret: String(getInputValue("fs_app_secret") || "")
  };
  if (!payload.appId || !payload.appSecret) {
    setChannelTestResult("fs_test_result", "失败：请先填写 App ID 与 App Secret", false);
    throw new Error("Feishu 测试失败：App ID / App Secret 不能为空");
  }
  const result = await api("/api/test/feishu", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("fs_test_result", result.message || "-", result.ok);
  setMessage(`Feishu 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testDiscord() {
  const payload = {
    token: String(getInputValue("dc_token") || "")
  };
  if (!payload.token) {
    setChannelTestResult("dc_test_result", "失败：请先填写 Discord Bot Token", false);
    throw new Error("Discord 测试失败：Bot Token 不能为空");
  }
  const result = await api("/api/test/discord", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("dc_test_result", result.message || "-", result.ok);
  setMessage(`Discord 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testSlack() {
  const mode = String(getInputValue("sl_mode") || "socket");
  const payload = {
    mode,
    botToken: String(getInputValue("sl_bot_token") || ""),
    appToken: String(getInputValue("sl_app_token") || ""),
    signingSecret: String(getInputValue("sl_signing_secret") || "")
  };
  if (!payload.botToken) {
    setChannelTestResult("sl_test_result", "失败：请先填写 Slack Bot Token", false);
    throw new Error("Slack 测试失败：Bot Token 不能为空");
  }
  if (mode === "socket" && !payload.appToken) {
    setChannelTestResult("sl_test_result", "失败：socket 模式需要 App Token", false);
    throw new Error("Slack 测试失败：socket 模式需要 App Token");
  }
  if (mode === "http" && !payload.signingSecret) {
    setChannelTestResult("sl_test_result", "失败：http 模式需要 Signing Secret", false);
    throw new Error("Slack 测试失败：http 模式需要 Signing Secret");
  }
  const result = await api("/api/test/slack", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setChannelTestResult("sl_test_result", result.message || "-", result.ok);
  setMessage(`Slack 测试：${result.message}`, result.ok ? "ok" : "error");
}

export {
  approveTelegramPairingFlow,
  checkAllUpdates,
  checkUpdate,
  fillPanelMeta,
  fillSettings,
  loadErrorSummary,
  loadInitialData,
  loadTail,
  mutateVersion,
  renderChannelAccessOverview,
  runService,
  saveAndTestFeishu,
  saveAndTestTelegram,
  saveModelSettings,
  saveSettings,
  setChannelActionResult,
  setChannelTestResult,
  setUpdateState,
  setupTelegramBasicFlow,
  startStream,
  stopStream,
  testDiscord,
  testFeishu,
  testSlack,
  testTelegram
};

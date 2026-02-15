import { requestJson } from "./app-api.js";

let stream = null;
const THEME_KEY = "openclaw-panel-theme";

const els = {
  messages: document.querySelector("#messages"),
  serviceOutput: document.querySelector("#service_output"),
  logOutput: document.querySelector("#log_output"),
  errorSummary: document.querySelector("#error_summary"),
  runtimeState: document.querySelector("#runtime_state"),
  metaServiceName: document.querySelector("#meta_service_name"),
  metaLogSource: document.querySelector("#meta_log_source"),
  serviceState: document.querySelector("#service_state"),
  serviceHint: document.querySelector("#service_hint"),
  themeToggle: document.querySelector("#theme_toggle"),
  updateState: document.querySelector("#update_state"),
  updateHint: document.querySelector("#update_hint"),
  updateCurrentTag: document.querySelector("#update_current_tag"),
  updateLatestTag: document.querySelector("#update_latest_tag")
};

function setMessage(message, type = "info") {
  const line = `[${new Date().toLocaleTimeString()}][${type}] ${message}`;
  els.messages.textContent = `${line}\n${els.messages.textContent}`.slice(0, 12000);
}

function setInput(id, value) {
  const el = document.querySelector(`#${id}`);
  if (!el) {
    return;
  }
  if (el.type === "checkbox") {
    el.checked = Boolean(value);
    return;
  }
  el.value = value ?? "";
}

function getInputValue(id) {
  const el = document.querySelector(`#${id}`);
  if (!el) {
    return "";
  }
  if (el.type === "checkbox") {
    return el.checked;
  }
  return el.value;
}

async function api(url, options = {}) {
  return requestJson(fetch, url, options);
}

function setupTabs() {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const panels = Array.from(document.querySelectorAll(".panel"));

  const activate = (panelName) => {
    tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tabTarget === panelName);
    });
    panels.forEach((panel) => {
      panel.classList.toggle("is-visible", panel.dataset.panel === panelName);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => activate(tab.dataset.tabTarget));
  });

  activate("panel-model");
}

function applyTheme(theme) {
  const value = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = value;
  if (els.themeToggle) {
    els.themeToggle.textContent = value === "dark" ? "切换到白色模式" : "切换到深夜模式";
  }
}

function setupTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || "light");

  els.themeToggle?.addEventListener("click", () => {
    const next = document.body.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    setMessage(`界面已切换到${next === "dark" ? "深夜模式" : "白色模式"}`, "info");
  });
}

function fillPanelMeta(config) {
  const runtime = config.runtime?.mode || "systemd";
  const target =
    runtime === "docker" ? config.openclaw.container_name || config.openclaw.service_name : config.openclaw.service_name;
  els.metaServiceName.textContent = `target: ${target}`;
  els.metaLogSource.textContent = `log: ${config.log.source} (${runtime})`;
  els.serviceHint.textContent =
    runtime === "docker" ? "当前为 Docker 运行时，按钮将控制容器。" : "当前为 systemd 运行时，按钮将控制服务。";
}

function setUpdateState(text, mode = "info") {
  els.updateState.textContent = text;
  els.updateState.classList.toggle("success", mode === "success");
  els.updateState.classList.toggle("fail", mode === "fail");
}

function fillSettings(settings) {
  setInput("model_primary", settings.model.primary);
  setInput("model_provider_id", settings.model.providerId);
  setInput("model_provider_api", settings.model.providerApi);
  setInput("model_provider_base_url", settings.model.providerBaseUrl);
  setInput("model_provider_api_key", settings.model.providerApiKey);
  setInput("model_id", settings.model.modelId);
  setInput("model_name", settings.model.modelName);
  setInput("model_context_window", settings.model.contextWindow);
  setInput("model_max_tokens", settings.model.maxTokens);

  setInput("tg_enabled", settings.channels.telegram.enabled);
  setInput("tg_bot_token", settings.channels.telegram.botToken);
  setInput("tg_dm_policy", settings.channels.telegram.dmPolicy);
  setInput("tg_allow_from", settings.channels.telegram.allowFrom);
  setInput("tg_group_policy", settings.channels.telegram.groupPolicy);
  setInput("tg_group_allow_from", settings.channels.telegram.groupAllowFrom);
  setInput("tg_require_mention", settings.channels.telegram.requireMention);
  setInput("tg_stream_mode", settings.channels.telegram.streamMode);

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

function collectSettings() {
  const providerId = String(getInputValue("model_provider_id") || "").trim();
  const modelId = String(getInputValue("model_id") || "").trim();
  const primary = providerId && modelId ? `${providerId}/${modelId}` : "";

  return {
    model: {
      primary,
      providerId,
      providerApi: String(getInputValue("model_provider_api") || ""),
      providerBaseUrl: String(getInputValue("model_provider_base_url") || ""),
      providerApiKey: String(getInputValue("model_provider_api_key") || ""),
      modelId,
      modelName: String(getInputValue("model_name") || ""),
      contextWindow: Number(getInputValue("model_context_window") || 200000),
      maxTokens: Number(getInputValue("model_max_tokens") || 8192)
    },
    channels: {
      telegram: {
        enabled: Boolean(getInputValue("tg_enabled")),
        botToken: String(getInputValue("tg_bot_token") || ""),
        dmPolicy: String(getInputValue("tg_dm_policy") || "pairing"),
        allowFrom: String(getInputValue("tg_allow_from") || ""),
        groupPolicy: String(getInputValue("tg_group_policy") || "allowlist"),
        groupAllowFrom: String(getInputValue("tg_group_allow_from") || ""),
        requireMention: Boolean(getInputValue("tg_require_mention")),
        streamMode: String(getInputValue("tg_stream_mode") || "partial")
      },
      feishu: {
        enabled: Boolean(getInputValue("fs_enabled")),
        appId: String(getInputValue("fs_app_id") || ""),
        appSecret: String(getInputValue("fs_app_secret") || ""),
        domain: String(getInputValue("fs_domain") || "feishu"),
        connectionMode: String(getInputValue("fs_connection_mode") || "websocket"),
        dmPolicy: String(getInputValue("fs_dm_policy") || "pairing"),
        allowFrom: String(getInputValue("fs_allow_from") || ""),
        groupPolicy: String(getInputValue("fs_group_policy") || "allowlist"),
        groupAllowFrom: String(getInputValue("fs_group_allow_from") || ""),
        requireMention: Boolean(getInputValue("fs_require_mention"))
      },
      discord: {
        enabled: Boolean(getInputValue("dc_enabled")),
        token: String(getInputValue("dc_token") || ""),
        dmPolicy: String(getInputValue("dc_dm_policy") || "pairing"),
        allowFrom: String(getInputValue("dc_allow_from") || ""),
        groupPolicy: String(getInputValue("dc_group_policy") || "allowlist"),
        allowBots: Boolean(getInputValue("dc_allow_bots")),
        requireMention: Boolean(getInputValue("dc_require_mention"))
      },
      slack: {
        enabled: Boolean(getInputValue("sl_enabled")),
        mode: String(getInputValue("sl_mode") || "socket"),
        botToken: String(getInputValue("sl_bot_token") || ""),
        appToken: String(getInputValue("sl_app_token") || ""),
        signingSecret: String(getInputValue("sl_signing_secret") || ""),
        dmPolicy: String(getInputValue("sl_dm_policy") || "pairing"),
        allowFrom: String(getInputValue("sl_allow_from") || ""),
        groupPolicy: String(getInputValue("sl_group_policy") || "allowlist"),
        allowBots: Boolean(getInputValue("sl_allow_bots")),
        requireMention: Boolean(getInputValue("sl_require_mention"))
      }
    }
  };
}

async function loadInitialData() {
  const [panelConfig, settings] = await Promise.all([api("/api/panel-config"), api("/api/settings")]);
  fillPanelMeta(panelConfig.config);
  fillSettings(settings.settings);
}

async function checkUpdate() {
  const result = await api("/api/update/check");
  const data = result.result;
  setInput("update_current_tag", data.currentTag || "");
  setInput("update_latest_tag", data.latestTag || "");
  if (!String(getInputValue("update_target_tag") || "").trim() && data.latestTag) {
    setInput("update_target_tag", data.latestTag);
  }

  if (data.warning) {
    setUpdateState("检查异常", "fail");
    els.updateHint.textContent = `已读取当前版本，但远程版本检查失败：${data.warning}`;
    setMessage(`更新检查告警：${data.warning}`, "error");
    return;
  }

  if (data.updateAvailable) {
    setUpdateState("有可用更新", "success");
    els.updateHint.textContent = `当前 ${data.currentTag || "-"}，最新 ${data.latestTag || "-"}。`;
  } else {
    setUpdateState("已是最新", "success");
    els.updateHint.textContent = `当前 ${data.currentTag || "-"}，无需升级。`;
  }
  setMessage(`版本检查完成：current=${data.currentTag || "-"} latest=${data.latestTag || "-"}`, "ok");
}

async function mutateVersion(action) {
  const tag = String(getInputValue("update_target_tag") || "").trim();
  if (!tag) {
    throw new Error("请先输入目标版本");
  }
  const result = await api(`/api/update/${action}`, {
    method: "POST",
    body: JSON.stringify({ tag }),
    allowBusinessError: true
  });
  const payload = result.result || {};
  if (payload.ok) {
    setUpdateState(action === "upgrade" ? "升级成功" : "回滚成功", "success");
    els.updateHint.textContent = `当前镜像：${payload.targetImage}`;
    setInput("update_current_tag", payload.targetImage?.split(":").pop() || "");
    setMessage(`${action} 成功：${payload.targetImage}`, "ok");
    await runService("status");
    await loadTail();
    return;
  }

  setUpdateState(action === "upgrade" ? "升级失败" : "回滚失败", "fail");
  const rollbackNote = payload.rollbackMessage ? `；${payload.rollbackMessage}` : payload.rolledBack ? "；已自动回滚" : "";
  const detail = `${payload.message || "操作失败"}${rollbackNote}`;
  els.updateHint.textContent = detail;
  setMessage(`${action} 失败：${detail}`, "error");
}

async function saveSettings() {
  const payload = collectSettings();
  const result = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify(payload)
  });
  setInput("model_primary", payload.model.primary);
  setMessage(`配置写入成功：${result.path}`, "ok");
}

async function runService(action) {
  const result = await api(`/api/service/${action}`, {
    method: "POST",
    allowBusinessError: true
  });
  const payload = result.result || {};
  const output = payload.output || payload.message || "(empty)";
  els.serviceOutput.textContent = output;

  if (!result.ok) {
    if (action === "status") {
      els.serviceState.textContent = "状态异常";
      els.serviceState.classList.toggle("success", false);
      els.serviceState.classList.toggle("fail", true);
      els.serviceHint.textContent = payload.message || "服务状态读取失败，请检查容器或 systemd 权限。";
    }
    setMessage(`service ${action}: 失败 - ${payload.message || "未知错误"}`, "error");
    return;
  }

  if (action === "status") {
    const active = Boolean(payload.active);
    els.serviceState.textContent = active ? "运行中" : "未运行";
    els.serviceState.classList.toggle("success", active);
    els.serviceState.classList.toggle("fail", !active);
    els.serviceHint.textContent = active
      ? "服务状态正常。你可以继续联调渠道或查看日志。"
      : "服务未运行。请先启动或检查 systemd 权限。";
  }
  setMessage(`service ${action}: 成功`, "ok");
}

async function loadTail() {
  const filter = encodeURIComponent(String(getInputValue("log_filter") || ""));
  const result = await api(`/api/logs/tail?lines=200&filter=${filter}`);
  els.logOutput.textContent = result.lines.join("\n");
  setMessage(`日志加载完成，共 ${result.lines.length} 行`, "ok");
}

async function loadErrorSummary() {
  const result = await api("/api/logs/errors?count=20");
  els.errorSummary.innerHTML = "";
  result.lines.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    els.errorSummary.appendChild(li);
  });
  setMessage(`错误摘要加载完成，共 ${result.lines.length} 条`, "ok");
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

async function testTelegram() {
  const payload = {
    botToken: String(getInputValue("tg_bot_token") || "")
  };
  const result = await api("/api/test/telegram", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setMessage(`Telegram 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testFeishu() {
  const payload = {
    appId: String(getInputValue("fs_app_id") || ""),
    appSecret: String(getInputValue("fs_app_secret") || "")
  };
  const result = await api("/api/test/feishu", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setMessage(`Feishu 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testDiscord() {
  const payload = {
    token: String(getInputValue("dc_token") || "")
  };
  const result = await api("/api/test/discord", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setMessage(`Discord 测试：${result.message}`, result.ok ? "ok" : "error");
}

async function testSlack() {
  const payload = {
    mode: String(getInputValue("sl_mode") || "socket"),
    botToken: String(getInputValue("sl_bot_token") || ""),
    appToken: String(getInputValue("sl_app_token") || ""),
    signingSecret: String(getInputValue("sl_signing_secret") || "")
  };
  const result = await api("/api/test/slack", {
    method: "POST",
    body: JSON.stringify(payload),
    allowBusinessError: true
  });
  setMessage(`Slack 测试：${result.message}`, result.ok ? "ok" : "error");
}

document.querySelector("#save_settings").addEventListener("click", () => {
  saveSettings().catch((error) => setMessage(error.message, "error"));
});

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    runService(btn.dataset.action).catch((error) => setMessage(error.message, "error"));
  });
});

document.querySelector("#load_tail").addEventListener("click", () => {
  loadTail().catch((error) => setMessage(error.message, "error"));
});

document.querySelector("#load_errors").addEventListener("click", () => {
  loadErrorSummary().catch((error) => setMessage(error.message, "error"));
});

document.querySelector("#start_stream").addEventListener("click", startStream);
document.querySelector("#stop_stream").addEventListener("click", stopStream);
document.querySelector("#test_telegram").addEventListener("click", () => {
  testTelegram().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_feishu").addEventListener("click", () => {
  testFeishu().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_discord").addEventListener("click", () => {
  testDiscord().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_slack").addEventListener("click", () => {
  testSlack().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#check_update").addEventListener("click", () => {
  checkUpdate().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#upgrade_update").addEventListener("click", () => {
  mutateVersion("upgrade").catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#rollback_update").addEventListener("click", () => {
  mutateVersion("rollback").catch((error) => setMessage(error.message, "error"));
});

setupTheme();
setupTabs();

loadInitialData()
  .then(() => {
    els.runtimeState.textContent = "面板已连接";
    setMessage("初始化完成", "ok");
    runService("status").catch(() => {});
    loadTail().catch(() => {});
    loadErrorSummary().catch(() => {});
    checkUpdate().catch(() => {});
  })
  .catch((error) => {
    els.runtimeState.textContent = "面板连接失败";
    setMessage(`初始化失败：${error.message}`, "error");
  });

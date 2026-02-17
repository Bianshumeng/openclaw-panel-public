import { els, hasPanel, setMessage, setupTabs, setupTheme } from "./js/core/panel-core.js";
import { setupConfigGenerator } from "./js/pages/config-generator-page.js";
import {
  loadStatusOverview,
  setupDashboard,
  setupModelEditor,
  setSaveModelSettingsHandler
} from "./js/pages/model-dashboard-page.js";
import { loadSkillsStatus, setupSkillsPage } from "./js/pages/skills-page.js";
import { loadChatSessions, setupChatConsole } from "./js/pages/chat-page.js";
import {
  approveTelegramPairingFlow,
  checkAllUpdates,
  checkUpdate,
  loadErrorSummary,
  loadInitialData,
  loadTail,
  mutateVersion,
  runService,
  saveAndTestFeishu,
  saveAndTestTelegram,
  saveModelSettings,
  saveSettings,
  setChannelTestResult,
  setupTelegramBasicFlow,
  startStream,
  stopStream,
  testDiscord,
  testFeishu,
  testSlack,
  testTelegram
} from "./js/pages/system-page.js";

setSaveModelSettingsHandler(saveModelSettings);

setupTheme();
setupTabs();

if (hasPanel("panel-dashboard")) {
  setupDashboard();
}
if (hasPanel("panel-skills")) {
  setupSkillsPage();
}
if (hasPanel("panel-chat-console")) {
  setupChatConsole();
}
if (hasPanel("panel-model") || hasPanel("panel-model-add")) {
  setupModelEditor();
}
if (hasPanel("panel-config-generator")) {
  setupConfigGenerator();
}

document.querySelector("#save_settings")?.addEventListener("click", () => {
  saveSettings().catch((error) => setMessage(error.message, "error"));
});

document.querySelectorAll("[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    runService(btn.dataset.action).catch((error) => setMessage(error.message, "error"));
  });
});

document.querySelector("#load_tail")?.addEventListener("click", () => {
  loadTail().catch((error) => setMessage(error.message, "error"));
});

document.querySelector("#load_errors")?.addEventListener("click", () => {
  loadErrorSummary().catch((error) => setMessage(error.message, "error"));
});

document.querySelector("#start_stream")?.addEventListener("click", startStream);
document.querySelector("#stop_stream")?.addEventListener("click", stopStream);

document.querySelector("#tg_setup_basic")?.addEventListener("click", () => {
  setupTelegramBasicFlow().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#tg_pairing_approve")?.addEventListener("click", () => {
  approveTelegramPairingFlow().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#tg_save_advanced")?.addEventListener("click", () => {
  saveSettings().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#save_and_test_telegram")?.addEventListener("click", () => {
  saveAndTestTelegram().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#save_and_test_feishu")?.addEventListener("click", () => {
  saveAndTestFeishu().catch((error) => setMessage(error.message, "error"));
});

function bindChannelTestButton(buttonSelector, runTest, resultElementId, channelName) {
  document.querySelector(buttonSelector)?.addEventListener("click", () => {
    runTest().catch((error) => {
      const detail = String(error?.message || "请求失败");
      setChannelTestResult(resultElementId, detail, false);
      setMessage(`${channelName} 测试失败：${detail}`, "error");
    });
  });
}

bindChannelTestButton("#test_telegram", testTelegram, "tg_test_result", "Telegram");
bindChannelTestButton("#test_feishu", testFeishu, "fs_test_result", "Feishu");
bindChannelTestButton("#test_discord", testDiscord, "dc_test_result", "Discord");
bindChannelTestButton("#test_slack", testSlack, "sl_test_result", "Slack");
document.querySelector("#bot_check_update")?.addEventListener("click", () => {
  checkUpdate({ target: "bot" }).catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#bot_upgrade_update")?.addEventListener("click", () => {
  mutateVersion("upgrade", { target: "bot" }).catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#bot_rollback_update")?.addEventListener("click", () => {
  mutateVersion("rollback", { target: "bot" }).catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#panel_check_update")?.addEventListener("click", () => {
  checkUpdate({ target: "panel" }).catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#panel_upgrade_update")?.addEventListener("click", () => {
  mutateVersion("upgrade", { target: "panel" }).catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#panel_rollback_update")?.addEventListener("click", () => {
  mutateVersion("rollback", { target: "panel" }).catch((error) => setMessage(error.message, "error"));
});

const isUpdatePage = hasPanel("panel-update");

loadInitialData()
  .then(() => {
    if (els.runtimeState) {
      els.runtimeState.textContent = "面板已连接";
    }
    setMessage("初始化完成", "ok");

    if (els.serviceState) {
      runService("status").catch(() => {});
    }
    if (els.logOutput) {
      loadTail().catch(() => {});
    }
    if (hasPanel("panel-dashboard") || els.errorSummary) {
      loadErrorSummary({ silent: true }).catch((error) => setMessage(`错误摘要加载失败：${error.message}`, "error"));
      checkUpdate({ silent: true }).catch((error) => setMessage(`版本信息加载失败：${error.message}`, "error"));
      loadStatusOverview({ silent: true }).catch((error) => setMessage(`状态总览加载失败：${error.message}`, "error"));
    }
    if (hasPanel("panel-skills")) {
      loadSkillsStatus({ silent: true }).catch((error) => setMessage(`Skills 页面加载失败：${error.message}`, "error"));
    }
    if (hasPanel("panel-chat-console")) {
      loadChatSessions({ silent: true }).catch((error) => setMessage(`智能对话页加载失败：${error.message}`, "error"));
    }
    if (isUpdatePage) {
      checkAllUpdates({ silent: true }).catch((error) => setMessage(`版本信息加载失败：${error.message}`, "error"));
    }
  })
  .catch((error) => {
    if (els.runtimeState) {
      els.runtimeState.textContent = "面板连接失败";
    }
    setMessage(`初始化失败：${error.message}`, "error");
  });

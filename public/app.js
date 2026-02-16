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
if (hasPanel("panel-model")) {
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

document.querySelector("#test_telegram")?.addEventListener("click", () => {
  testTelegram().catch((error) => setMessage(error.message, "error"));
});
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
document.querySelector("#test_feishu")?.addEventListener("click", () => {
  testFeishu().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#save_and_test_feishu")?.addEventListener("click", () => {
  saveAndTestFeishu().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_discord")?.addEventListener("click", () => {
  testDiscord().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#test_slack")?.addEventListener("click", () => {
  testSlack().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#check_update")?.addEventListener("click", () => {
  checkUpdate().catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#upgrade_update")?.addEventListener("click", () => {
  mutateVersion("upgrade").catch((error) => setMessage(error.message, "error"));
});
document.querySelector("#rollback_update")?.addEventListener("click", () => {
  mutateVersion("rollback").catch((error) => setMessage(error.message, "error"));
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
      checkUpdate({ silent: true }).catch((error) => setMessage(`版本信息加载失败：${error.message}`, "error"));
    }
  })
  .catch((error) => {
    if (els.runtimeState) {
      els.runtimeState.textContent = "面板连接失败";
    }
    setMessage(`初始化失败：${error.message}`, "error");
  });

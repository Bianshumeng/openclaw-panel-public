import { api, getInputValue, setInput, setMessage, setText, skillsPageState } from "../core/panel-core.js";

function truncateText(value, max = 72) {
  const text = String(value || "").trim();
  if (!text) {
    return "-";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function setSkillsSaveResult(text, mode = "") {
  const result = document.querySelector("#skills_save_result");
  if (!result) {
    return;
  }
  result.textContent = text;
  result.classList.toggle("success", mode === "success");
  result.classList.toggle("fail", mode === "fail");
}

function resetSkillEditForm() {
  setInput("skills_edit_enabled", false);
  setInput("skills_edit_apikey", "");
  setInput("skills_edit_clear_apikey", false);
  setInput("skills_edit_env", "");
  setSkillsSaveResult("选择一个 Skill 后可编辑配置。", "");
}

function parseSkillEnvPatch(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("环境变量 JSON 格式不合法");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("环境变量必须是对象 JSON");
  }
  const normalized = {};
  Object.entries(parsed).forEach(([key, value]) => {
    const name = String(key || "").trim();
    if (!name) {
      return;
    }
    normalized[name] = value == null ? "" : String(value);
  });
  return normalized;
}

function collectSkillConfigPatch() {
  const enabled = Boolean(getInputValue("skills_edit_enabled"));
  const apiKey = String(getInputValue("skills_edit_apikey") || "").trim();
  const clearApiKey = Boolean(getInputValue("skills_edit_clear_apikey"));
  const env = parseSkillEnvPatch(getInputValue("skills_edit_env"));
  return {
    enabled,
    apiKey,
    clearApiKey,
    env
  };
}

async function saveSkillConfigPatch() {
  const skillKey = String(skillsPageState.selectedSkillKey || "").trim();
  if (!skillKey) {
    throw new Error("请先选择一个 Skill");
  }
  const patch = collectSkillConfigPatch();
  const response = await api(`/api/skills/${encodeURIComponent(skillKey)}/config`, {
    method: "PUT",
    body: JSON.stringify(patch)
  });
  setSkillsSaveResult(response.message || "保存完成", response.ok ? "success" : "fail");
  setMessage(response.message || "Skill 配置已更新", response.ok ? "ok" : "error");
  await loadSkillsStatus({ preserveSelection: true, selectedSkillKey: skillKey });
}

function renderSkillsList(skills = []) {
  const list = document.querySelector("#skills_list");
  if (!list) {
    return;
  }
  list.innerHTML = "";

  if (!Array.isArray(skills) || skills.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-line";
    empty.textContent = "暂无可展示的 Skills。";
    list.appendChild(empty);
    return;
  }

  skills.forEach((skill) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "skill-row";
    const isSelected = String(skill?.key || "") === skillsPageState.selectedSkillKey;
    if (isSelected) {
      item.classList.add("is-selected");
    }
    item.innerHTML = `
      <span class="skill-row-main">${truncateText(skill?.key || "-", 40)}</span>
      <span class="skill-row-meta">${skill?.enabled ? "已启用" : "未启用"} · 更新 ${skill?.updatedAtText || "-"}</span>
      <span class="skill-row-desc">${truncateText(skill?.summary || "暂无说明", 80)}</span>
    `;
    item.addEventListener("click", () => {
      loadSkillConfig(String(skill?.key || "").trim(), { silent: false }).catch((error) =>
        setMessage(error.message || "Skill 配置读取失败", "error")
      );
    });
    list.appendChild(item);
  });
}

function confirmSkillToggle(skill, nextEnabled) {
  const riskLevel = String(skill?.riskLevel || "").trim().toLowerCase();
  if (nextEnabled && riskLevel === "restricted") {
    return window.confirm(`Skill "${skill?.key}" 标记为受限能力，启用后可能影响运行态，确认继续吗？`);
  }
  if (!nextEnabled) {
    return window.confirm(`确认停用 Skill "${skill?.key}"？停用后相关能力将立即不可用。`);
  }
  return true;
}

async function loadSkillConfig(skillKey, { silent = false } = {}) {
  const normalizedSkillKey = String(skillKey || "").trim();
  if (!normalizedSkillKey) {
    skillsPageState.selectedSkillConfig = null;
    skillsPageState.selectedSkillKey = "";
    resetSkillEditForm();
    renderSkillsList(skillsPageState.skills);
    return;
  }
  const response = await api(`/api/skills/${encodeURIComponent(normalizedSkillKey)}/config`);
  skillsPageState.selectedSkillConfig = response?.result || null;
  skillsPageState.selectedSkillKey = normalizedSkillKey;

  const config = response?.result || {};
  setInput("skills_edit_enabled", Boolean(config.enabled));
  setInput("skills_edit_apikey", "");
  setInput("skills_edit_clear_apikey", false);
  setInput("skills_edit_env", JSON.stringify(config.env || {}, null, 2));
  setText("skills_selected_key", normalizedSkillKey);
  setSkillsSaveResult(
    config.apiKeyMasked ? `当前 API Key：${config.apiKeyMasked}（可留空保持不变）` : "当前未设置 API Key",
    ""
  );
  renderSkillsList(skillsPageState.skills);
  if (!silent) {
    setMessage(`已加载 Skill：${normalizedSkillKey}`, "ok");
  }
}

async function setSkillEnabled(skillKey, enabled) {
  const response = await api(`/api/skills/${encodeURIComponent(skillKey)}/enabled`, {
    method: "POST",
    body: JSON.stringify({ enabled: Boolean(enabled) })
  });
  setMessage(response.message || "Skill 状态已更新", response.ok ? "ok" : "error");
}

async function loadSkillsStatus({ silent = false, preserveSelection = true, selectedSkillKey = "" } = {}) {
  const response = await api("/api/skills/status");
  const skills = Array.isArray(response?.result?.skills) ? response.result.skills : [];
  skillsPageState.skills = skills;

  const requested = String(selectedSkillKey || "").trim();
  const targetSkillKeyFromState = String(skillsPageState.selectedSkillKey || "").trim();
  let nextSelected = "";
  if (requested && skills.some((skill) => String(skill?.key || "").trim() === requested)) {
    nextSelected = requested;
  } else if (
    preserveSelection &&
    targetSkillKeyFromState &&
    skills.some((skill) => String(skill?.key || "").trim() === targetSkillKeyFromState)
  ) {
    nextSelected = targetSkillKeyFromState;
  } else if (skills.length > 0) {
    nextSelected = String(skills[0]?.key || "").trim();
  }

  skillsPageState.selectedSkillKey = nextSelected;
  renderSkillsList(skills);

  if (nextSelected) {
    await loadSkillConfig(nextSelected, { silent: true });
  } else {
    skillsPageState.selectedSkillConfig = null;
    setText("skills_selected_key", "未选择");
    resetSkillEditForm();
  }

  if (!silent) {
    setMessage(`Skills 状态已刷新（${skills.length} 项）`, "ok");
  }
}

function setupSkillsPage() {
  if (skillsPageState.bound) {
    return;
  }
  skillsPageState.bound = true;

  document.querySelector("#skills_refresh")?.addEventListener("click", () => {
    loadSkillsStatus({ silent: false, preserveSelection: true }).catch((error) =>
      setMessage(error.message || "Skills 刷新失败", "error")
    );
  });

  document.querySelector("#skills_toggle_enabled")?.addEventListener("click", async () => {
    const skillKey = String(skillsPageState.selectedSkillKey || "").trim();
    if (!skillKey) {
      setMessage("请先选择一个 Skill", "error");
      return;
    }
    const current = skillsPageState.skills.find((item) => String(item?.key || "").trim() === skillKey);
    if (!current) {
      setMessage("当前 Skill 不存在，已刷新列表", "error");
      await loadSkillsStatus({ silent: true, preserveSelection: false });
      return;
    }
    const nextEnabled = !Boolean(current.enabled);
    if (!confirmSkillToggle(current, nextEnabled)) {
      setMessage("已取消 Skill 操作", "info");
      return;
    }
    await setSkillEnabled(skillKey, nextEnabled);
    await loadSkillsStatus({ silent: true, preserveSelection: true, selectedSkillKey: skillKey });
  });

  document.querySelector("#skills_save_config")?.addEventListener("click", () => {
    saveSkillConfigPatch().catch((error) => {
      setSkillsSaveResult(error.message || "保存失败", "fail");
      setMessage(error.message || "Skill 配置保存失败", "error");
    });
  });
}

export { loadSkillsStatus, setupSkillsPage };

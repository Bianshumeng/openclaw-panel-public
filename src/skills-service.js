import { callGatewayRpc } from "./gateway-client.js";
import { loadOpenClawConfig } from "./openclaw-config.js";
import { maskSecret } from "./utils.js";

const SKILLS_GATEWAY_TIMEOUT_MS = 1_000;
const SKILLS_GATEWAY_RETRIES = 6;
const SKILLS_GATEWAY_RETRY_DELAY_MS = 1_000;

function trimString(value) {
  return String(value || "").trim();
}

function normalizeSkillItem(skill = {}) {
  const updatedAt = trimString(
    skill?.updatedAt || skill?.updated_at || skill?.lastUpdatedAt || skill?.last_updated_at || skill?.mtime
  );
  return {
    key: trimString(skill?.skillKey || skill?.name),
    name: trimString(skill?.name),
    description: trimString(skill?.description),
    updatedAt,
    enabled: skill?.disabled !== true,
    eligible: skill?.eligible === true,
    blocked: skill?.blockedByAllowlist === true,
    source: trimString(skill?.source),
    bundled: skill?.bundled === true,
    missing: skill?.missing && typeof skill.missing === "object" ? skill.missing : {},
    requirements: skill?.requirements && typeof skill.requirements === "object" ? skill.requirements : {}
  };
}

function normalizeSkillListPayload(payload) {
  const workspaceDir = trimString(payload?.workspaceDir);
  const managedSkillsDir = trimString(payload?.managedSkillsDir);
  const skillsRaw = Array.isArray(payload?.skills) ? payload.skills : [];
  const skills = skillsRaw
    .map((item) => normalizeSkillItem(item))
    .filter((item) => item.key);
  const enabled = skills.filter((item) => item.enabled).length;
  return {
    workspaceDir,
    managedSkillsDir,
    total: skills.length,
    enabled,
    disabled: skills.length - enabled,
    skills
  };
}

function buildSkillMap(skills) {
  return new Map(skills.map((skill) => [skill.key, skill]));
}

function normalizeSkillConfigEntry(skillKey, rawConfig) {
  const config = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const rawEnv = config.env && typeof config.env === "object" ? config.env : {};
  const env = Object.fromEntries(
    Object.entries(rawEnv).map(([key, value]) => [key, maskSecret(trimString(value))])
  );
  return {
    skillKey,
    enabled: typeof config.enabled === "boolean" ? config.enabled : null,
    hasApiKey: Boolean(trimString(config.apiKey)),
    apiKeyMasked: maskSecret(trimString(config.apiKey)),
    env
  };
}

async function callSkillsRpc(panelConfig, params, deps = {}) {
  const callRpc = deps.callGatewayRpc || callGatewayRpc;
  const gatewayToken = trimString(deps.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN);
  return await callRpc({
    panelConfig,
    method: params.method,
    params: params.payload || {},
    timeoutMs: SKILLS_GATEWAY_TIMEOUT_MS,
    retries: SKILLS_GATEWAY_RETRIES,
    retryDelayMs: SKILLS_GATEWAY_RETRY_DELAY_MS,
    token: gatewayToken
  });
}

function ensureKnownSkill(skillsMap, skillKey) {
  if (skillsMap.has(skillKey)) {
    return;
  }
  throw new Error(`未知技能：${skillKey}`);
}

export async function listSkillsStatus({ panelConfig, deps = {} }) {
  const payload = await callSkillsRpc(
    panelConfig,
    {
      method: "skills.status",
      payload: {}
    },
    deps
  );
  return normalizeSkillListPayload(payload);
}

export async function getSkillConfig({ panelConfig, skillKey, deps = {} }) {
  const normalizedSkillKey = trimString(skillKey);
  if (!normalizedSkillKey) {
    throw new Error("skillKey 不能为空");
  }
  const loadConfig = deps.loadOpenClawConfig || loadOpenClawConfig;
  const config = await loadConfig(panelConfig?.openclaw?.config_path);
  const rawEntry = config?.skills?.entries?.[normalizedSkillKey];
  return normalizeSkillConfigEntry(normalizedSkillKey, rawEntry);
}

export async function setSkillEnabled({ panelConfig, skillKey, enabled, deps = {} }) {
  const normalizedSkillKey = trimString(skillKey);
  if (!normalizedSkillKey) {
    throw new Error("skillKey 不能为空");
  }

  const status = await listSkillsStatus({ panelConfig, deps });
  const skillsMap = buildSkillMap(status.skills);
  ensureKnownSkill(skillsMap, normalizedSkillKey);

  await callSkillsRpc(
    panelConfig,
    {
      method: "skills.update",
      payload: {
        skillKey: normalizedSkillKey,
        enabled: enabled === true
      }
    },
    deps
  );

  const nextConfig = await getSkillConfig({
    panelConfig,
    skillKey: normalizedSkillKey,
    deps
  });

  return {
    skillKey: normalizedSkillKey,
    enabled: enabled === true,
    config: nextConfig
  };
}

import { randomBytes } from "node:crypto";

function trimText(value) {
  return String(value || "").trim();
}

export function generateGatewayToken() {
  return randomBytes(32).toString("hex");
}

function generateDistinctGatewayToken(previousToken, tokenGenerator) {
  const previous = trimText(previousToken);
  for (let i = 0; i < 5; i += 1) {
    const candidate = trimText(tokenGenerator());
    if (candidate && candidate !== previous) {
      return candidate;
    }
  }
  throw new Error("Gateway Token 生成失败，请重试");
}

export function rotateGatewayTokenConfig(openclawConfig, tokenGenerator = generateGatewayToken) {
  const currentConfig =
    openclawConfig && typeof openclawConfig === "object" && !Array.isArray(openclawConfig) ? openclawConfig : {};
  const prevMode = trimText(currentConfig?.gateway?.auth?.mode);
  const prevToken = trimText(currentConfig?.gateway?.auth?.token);
  const token = generateDistinctGatewayToken(prevToken, tokenGenerator);

  const nextGateway =
    currentConfig?.gateway && typeof currentConfig.gateway === "object" && !Array.isArray(currentConfig.gateway)
      ? { ...currentConfig.gateway }
      : {};
  const nextAuth =
    nextGateway?.auth && typeof nextGateway.auth === "object" && !Array.isArray(nextGateway.auth)
      ? { ...nextGateway.auth }
      : {};
  nextAuth.mode = "token";
  nextAuth.token = token;
  nextGateway.auth = nextAuth;

  return {
    nextConfig: {
      ...currentConfig,
      gateway: nextGateway
    },
    token,
    source: "generated-rotate",
    changed: prevMode !== "token" || prevToken !== token
  };
}

function normalizeAutoApproveFailure(error) {
  const detail = trimText(error?.message || error);
  const message = detail ? `自动批准待处理配对失败：${detail}` : "自动批准待处理配对失败";
  return {
    ok: false,
    message,
    pendingCount: 0,
    approvedCount: 0,
    failedCount: 0,
    pending: [],
    approvals: [],
    steps: []
  };
}

export async function rotateGatewayTokenAndApprovePairings({
  openclawConfig,
  panelConfig,
  configPath,
  saveConfig,
  approvePendingPairings
}) {
  const tokenResult = rotateGatewayTokenConfig(openclawConfig);
  const saved = await saveConfig(configPath, tokenResult.nextConfig);

  let autoApprove;
  try {
    autoApprove = await approvePendingPairings({
      panelConfig
    });
  } catch (error) {
    autoApprove = normalizeAutoApproveFailure(error);
  }

  return {
    tokenResult,
    saved,
    autoApprove
  };
}

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

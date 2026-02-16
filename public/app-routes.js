export const PANEL_ROUTES = {
  "panel-dashboard": "/dashboard",
  "panel-skills": "/skills",
  "panel-chat-console": "/chat-console",
  "panel-model": "/model",
  "panel-config-generator": "/config-generator",
  "panel-channel": "/channels",
  "panel-update": "/update",
  "panel-service": "/service",
  "panel-logs": "/logs"
};

const CHANNEL_DETAIL_ROUTES = ["/channels/telegram", "/channels/feishu", "/channels/discord", "/channels/slack"];

export function panelByPath(pathname) {
  const path = String(pathname || "").trim() || "/";
  if (path === "/") {
    return "panel-model";
  }
  if (path === "/status-overview") {
    return "panel-dashboard";
  }
  if (CHANNEL_DETAIL_ROUTES.includes(path)) {
    return "panel-channel";
  }
  const matched = Object.entries(PANEL_ROUTES).find(([, route]) => route === path);
  return matched ? matched[0] : "panel-model";
}

export function isKnownPanelPath(pathname) {
  const path = String(pathname || "").trim() || "/";
  return (
    path === "/" ||
    path === "/status-overview" ||
    Object.values(PANEL_ROUTES).includes(path) ||
    CHANNEL_DETAIL_ROUTES.includes(path)
  );
}

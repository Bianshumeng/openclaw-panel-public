export const PANEL_ROUTES = {
  "panel-dashboard": "/dashboard",
  "panel-status-overview": "/status-overview",
  "panel-skills": "/skills",
  "panel-chat-console": "/chat-console",
  "panel-model": "/model",
  "panel-config-generator": "/config-generator",
  "panel-channel": "/channels",
  "panel-update": "/update",
  "panel-service": "/service",
  "panel-logs": "/logs"
};

export function panelByPath(pathname) {
  const path = String(pathname || "").trim() || "/";
  if (path === "/") {
    return "panel-model";
  }
  const matched = Object.entries(PANEL_ROUTES).find(([, route]) => route === path);
  return matched ? matched[0] : "panel-model";
}

export function isKnownPanelPath(pathname) {
  const path = String(pathname || "").trim() || "/";
  return path === "/" || Object.values(PANEL_ROUTES).includes(path);
}

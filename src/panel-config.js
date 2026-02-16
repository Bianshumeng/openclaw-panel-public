import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { expandHome, readJsonFile, writeJsonFileAtomic } from "./utils.js";

const panelConfigSchema = z.object({
  panel: z
    .object({
      listen_host: z.string().default("127.0.0.1"),
      listen_port: z.number().int().positive().default(18080)
    })
    .default({}),
  runtime: z
    .object({
      mode: z.enum(["systemd", "docker"]).default("systemd")
    })
    .default({}),
  reverse_proxy: z
    .object({
      enabled: z.boolean().default(false),
      public_scheme: z.enum(["http", "https"]).default("http"),
      public_host: z.string().default(""),
      panel_public_port: z.number().int().positive().default(18080),
      gateway_public_port: z.number().int().positive().default(18789),
      panel_public_base_url: z.string().default(""),
      webhook_public_base_url: z.string().default("")
    })
    .default({}),
  openclaw: z
    .object({
      config_path: z.string().default("~/.openclaw/openclaw.json"),
      service_name: z.string().default("openclaw-gateway"),
      container_name: z.string().default("openclaw-gateway"),
      image_repo: z.string().default("ghcr.io/openclaw/openclaw"),
      gateway_port: z.number().int().positive().default(18789),
      gateway_ws_url: z.string().default("")
    })
    .default({}),
  docker: z
    .object({
      enabled: z.boolean().default(false)
    })
    .default({}),
  log: z
    .object({
      source: z.enum(["journal", "file", "docker"]).default("journal"),
      file_path: z.string().default("~/.openclaw/logs/gateway.log")
    })
    .default({})
});

export const defaults = panelConfigSchema.parse({});

export function getPanelConfigPath() {
  if (process.env.PANEL_CONFIG_PATH) {
    return expandHome(process.env.PANEL_CONFIG_PATH);
  }
  return path.join(os.homedir(), ".openclaw-panel", "panel.config.json");
}

export async function loadPanelConfig() {
  const filePath = getPanelConfigPath();
  const raw = await readJsonFile(filePath, defaults);
  const merged = {
    ...defaults,
    ...raw,
    panel: { ...defaults.panel, ...(raw.panel || {}) },
    runtime: { ...defaults.runtime, ...(raw.runtime || {}) },
    reverse_proxy: { ...defaults.reverse_proxy, ...(raw.reverse_proxy || {}) },
    openclaw: { ...defaults.openclaw, ...(raw.openclaw || {}) },
    docker: { ...defaults.docker, ...(raw.docker || {}) },
    log: { ...defaults.log, ...(raw.log || {}) }
  };
  const parsed = panelConfigSchema.parse(merged);
  const envListenHost = String(process.env.PANEL_LISTEN_HOST || "").trim();
  const envListenPort = Number.parseInt(String(process.env.PANEL_LISTEN_PORT || ""), 10);
  const panelWithEnv = {
    ...parsed.panel,
    ...(envListenHost ? { listen_host: envListenHost } : {}),
    ...(Number.isFinite(envListenPort) && envListenPort > 0 ? { listen_port: envListenPort } : {})
  };
  return {
    filePath,
    config: {
      ...parsed,
      panel: panelWithEnv
    }
  };
}

export async function savePanelConfig(next) {
  const parsed = panelConfigSchema.parse(next);
  const filePath = getPanelConfigPath();
  await writeJsonFileAtomic(filePath, parsed, 0o600);
  return {
    filePath,
    config: parsed
  };
}

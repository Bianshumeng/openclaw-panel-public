import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { loadPanelConfig, resolveOpenClawConfigPath } from "../../src/panel-config.js";

test("resolveOpenClawConfigPath always uses direct-install default when env override is absent", () => {
  const homeDir = path.join(path.sep, "home", "panel-test");
  const directPath = path.join(homeDir, ".openclaw", "openclaw.json");
  const resolved = resolveOpenClawConfigPath(
    {
      openclaw: {
        config_path: "/data/openclaw/openclaw.json"
      }
    },
    { homeDir }
  );
  assert.equal(resolved, directPath);
});

test("loadPanelConfig enforces direct-install runtime and default paths", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "panel-config-"));
  const panelConfigPath = path.join(tmpRoot, "panel.config.json");
  const directConfigPath = path.join(tmpRoot, ".openclaw", "openclaw.json");
  await mkdir(path.dirname(directConfigPath), { recursive: true });
  await writeFile(directConfigPath, "{}\n", "utf8");
  await writeFile(
    panelConfigPath,
    `${JSON.stringify(
      {
        runtime: { mode: "docker" },
        openclaw: {
          config_path: "/data/openclaw/openclaw.json",
          gateway_media_root: "/home/node/.openclaw"
        },
        docker: { enabled: true },
        log: {
          source: "docker",
          file_path: "/data/openclaw/logs/gateway.log"
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const prevPanelConfigPath = process.env.PANEL_CONFIG_PATH;
  const prevOpenClawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  process.env.PANEL_CONFIG_PATH = panelConfigPath;
  process.env.OPENCLAW_CONFIG_PATH = directConfigPath;

  try {
    const { config } = await loadPanelConfig();
    assert.equal(config.openclaw.config_path, directConfigPath);
    assert.equal(config.runtime.mode, "systemd");
    assert.equal(config.docker.enabled, false);
    assert.equal(config.log.source, process.platform === "linux" ? "journal" : "file");
    assert.equal(config.log.file_path, "~/.openclaw/logs/gateway.log");
    assert.equal(config.openclaw.gateway_media_root, "");
  } finally {
    if (prevPanelConfigPath === undefined) {
      delete process.env.PANEL_CONFIG_PATH;
    } else {
      process.env.PANEL_CONFIG_PATH = prevPanelConfigPath;
    }
    if (prevOpenClawConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = prevOpenClawConfigPath;
    }
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

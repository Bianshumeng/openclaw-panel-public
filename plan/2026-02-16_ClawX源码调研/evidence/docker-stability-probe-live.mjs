#!/usr/bin/env node

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const OUTPUT_PATH = path.resolve(
  "plan/2026-02-16_ClawX源码调研/evidence/docker-stability-live.json"
);
const PANEL_BASE = process.env.PANEL_BASE_URL || "http://127.0.0.1:18080";
const GATEWAY_BASE = process.env.GATEWAY_BASE_URL || "http://127.0.0.1:18789";
const MAX_RECOVER_ATTEMPTS = Number.parseInt(process.env.RECOVER_ATTEMPTS || "20", 10);
const RECOVER_INTERVAL_MS = Number.parseInt(process.env.RECOVER_INTERVAL_MS || "1000", 10);

function run(command) {
  const startedAt = Date.now();
  try {
    const stdout = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return {
      ok: true,
      command,
      elapsedMs: Date.now() - startedAt,
      stdout: String(stdout || "").trim()
    };
  } catch (error) {
    return {
      ok: false,
      command,
      elapsedMs: Date.now() - startedAt,
      stdout: String(error?.stdout || "").trim(),
      stderr: String(error?.stderr || "").trim(),
      message: String(error?.message || error)
    };
  }
}

async function requestJson(url, init = {}) {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(init.headers || {})
      }
    });
    clearTimeout(timeout);
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      body
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.message || error)
    };
  }
}

async function requestText(url, init = {}) {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timeout);
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      textPreview: text.slice(0, 120)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - startedAt,
      error: String(error?.message || error)
    };
  }
}

async function probeAll() {
  const panelHealth = await requestJson(`${PANEL_BASE}/api/health`);
  const serviceStatus = await requestJson(`${PANEL_BASE}/api/service/status`, {
    method: "POST",
    body: "{}"
  });
  const updateCheck = await requestJson(`${PANEL_BASE}/api/update/check`);
  const gatewayHome = await requestText(`${GATEWAY_BASE}/`);
  const containerState = run("docker inspect -f \"{{.State.Status}}\" openclaw-gateway");
  const internalDnsProbe = run(
    "docker exec openclaw-panel node -e \"fetch('http://openclaw-gateway:18789/').then(r=>{console.log('status='+r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(String(e));process.exit(2)})\""
  );

  return {
    panelHealth,
    serviceStatus,
    updateCheck,
    gatewayHome,
    containerState,
    internalDnsProbe
  };
}

function isRecovered(snapshot) {
  return (
    snapshot?.panelHealth?.ok &&
    snapshot?.serviceStatus?.ok &&
    snapshot?.serviceStatus?.body?.ok === true &&
    snapshot?.serviceStatus?.body?.result?.active === true &&
    snapshot?.gatewayHome?.ok &&
    snapshot?.gatewayHome?.status === 200 &&
    snapshot?.containerState?.ok &&
    String(snapshot?.containerState?.stdout || "") === "running" &&
    snapshot?.internalDnsProbe?.ok
  );
}

async function waitForRecovery() {
  const attempts = [];
  for (let i = 1; i <= MAX_RECOVER_ATTEMPTS; i++) {
    const probe = await probeAll();
    attempts.push({
      attempt: i,
      recovered: isRecovered(probe),
      probe
    });
    if (isRecovered(probe)) {
      return {
        recovered: true,
        attempts
      };
    }
    await sleep(RECOVER_INTERVAL_MS);
  }
  return {
    recovered: false,
    attempts
  };
}

async function main() {
  const result = {
    startedAt: new Date().toISOString()
  };

  result.baseline = await probeAll();

  const restartStartedAt = Date.now();
  result.restart = {
    command: run("docker restart openclaw-gateway"),
    durationMs: Date.now() - restartStartedAt
  };
  result.restart.recovery = await waitForRecovery();

  const networkNameResult = run(
    "docker inspect -f \"{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}\" openclaw-gateway"
  );
  const networkName = String(networkNameResult.stdout || "").trim();
  result.networkIsolation = {
    networkNameResult,
    networkName
  };
  if (networkName) {
    result.networkIsolation.disconnect = run(`docker network disconnect -f ${networkName} openclaw-gateway`);
    result.networkIsolation.probeDuringIsolation = await probeAll();
    result.networkIsolation.reconnect = run(`docker network connect ${networkName} openclaw-gateway`);
    result.networkIsolation.recovery = await waitForRecovery();
  } else {
    result.networkIsolation.error = "无法识别 gateway 网络名称，跳过隔离测试";
  }

  const checkBeforeUpgrade = await requestJson(`${PANEL_BASE}/api/update/check`);
  const currentTag = String(checkBeforeUpgrade?.body?.result?.currentTag || "").trim();
  result.upgradeDrill = {
    checkBeforeUpgrade,
    currentTag
  };
  if (currentTag) {
    result.upgradeDrill.upgrade = await requestJson(`${PANEL_BASE}/api/update/upgrade`, {
      method: "POST",
      body: JSON.stringify({ tag: currentTag })
    });
    result.upgradeDrill.afterUpgradeProbe = await probeAll();
    result.upgradeDrill.afterUpgradeRecovery = await waitForRecovery();
  } else {
    result.upgradeDrill.error = "未读取到 currentTag，跳过升级回放";
  }

  result.finishedAt = new Date().toISOString();

  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  // Keep the script output machine-readable for quick shell checks.
  process.stdout.write(`${JSON.stringify({ ok: true, output: OUTPUT_PATH })}\n`);
}

main().catch(async (error) => {
  const payload = {
    ok: false,
    message: String(error?.message || error),
    stack: String(error?.stack || "")
  };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exitCode = 1;
});

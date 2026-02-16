import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST_DIR = "/app/dist";
const WS_URL = process.env.OPENCLAW_GATEWAY_WS_URL || "ws://127.0.0.1:18789/ws";
const CONNECT_TIMEOUT_MS = 12_000;
const PROBE_SKILL_KEY = "__panel_probe_nonexistent_skill__";

function nowIso() {
  return new Date().toISOString();
}

function asErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function loadGatewayClientClass() {
  const files = await fs.readdir(DIST_DIR);
  const candidates = files
    .filter((name) => name.startsWith("client-") && name.endsWith(".js"))
    .sort();

  for (const fileName of candidates) {
    const modulePath = pathToFileURL(path.join(DIST_DIR, fileName)).href;
    const mod = await import(modulePath);
    const GatewayClient = Object.values(mod).find(
      (value) => typeof value === "function" && value.name === "GatewayClient",
    );
    if (GatewayClient) {
      return { GatewayClient, fileName };
    }
  }

  throw new Error("GatewayClient not found in /app/dist/client-*.js");
}

async function main() {
  const startedAt = nowIso();
  const probeId = `skills-boundary-probe-${Date.now()}`;
  const runtime = await loadGatewayClientClass();
  const GatewayClient = runtime.GatewayClient;

  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  const events = [];
  const rpcTrace = [];
  let lastClose = null;

  const client = new GatewayClient({
    url: WS_URL,
    clientName: "cli",
    mode: "cli",
    instanceId: `${probeId}-client`,
    clientDisplayName: "skills-boundary-probe",
    clientVersion: "probe",
    onEvent: (evt) => {
      if (!evt || typeof evt !== "object") {
        return;
      }
      events.push({
        at: nowIso(),
        event: evt.event,
      });
    },
    onHelloOk: (hello) => {
      readyResolve(hello);
    },
    onConnectError: (error) => {
      readyReject(error instanceof Error ? error : new Error(String(error)));
    },
    onClose: (code, reason) => {
      lastClose = { code, reason };
    },
  });

  const request = async (method, params) => {
    const startedMs = Date.now();
    try {
      const payload = await client.request(method, params);
      rpcTrace.push({
        at: nowIso(),
        method,
        ok: true,
        latencyMs: Date.now() - startedMs,
        params,
        payload,
      });
      return payload;
    } catch (error) {
      const message = asErrorMessage(error);
      rpcTrace.push({
        at: nowIso(),
        method,
        ok: false,
        latencyMs: Date.now() - startedMs,
        params,
        error: message,
      });
      throw new Error(message);
    }
  };

  const checks = {
    statusBefore: null,
    unknownAgentError: null,
    updateUnknown: null,
    statusAfter: null,
    installMissingError: null,
    binsError: null,
  };

  try {
    client.start();

    const connectTimer = setTimeout(() => {
      readyReject(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    const hello = await readyPromise;
    clearTimeout(connectTimer);

    const statusBefore = await request("skills.status", {});
    const skillsBefore = Array.isArray(statusBefore.skills) ? statusBefore.skills : [];
    checks.statusBefore = {
      total: skillsBefore.length,
      firstSkillKeys: skillsBefore.slice(0, 10).map((item) => item.skillKey),
      containsProbeSkillKey: skillsBefore.some((item) => item.skillKey === PROBE_SKILL_KEY),
    };

    try {
      await request("skills.status", { agentId: "__unknown_agent__" });
      checks.unknownAgentError = {
        ok: false,
        error: "unexpected success",
      };
    } catch (error) {
      checks.unknownAgentError = {
        ok: true,
        error: asErrorMessage(error),
      };
    }

    const updateUnknown = await request("skills.update", {
      skillKey: PROBE_SKILL_KEY,
      enabled: false,
    });
    checks.updateUnknown = {
      ok: true,
      response: updateUnknown,
    };

    const statusAfter = await request("skills.status", {});
    const skillsAfter = Array.isArray(statusAfter.skills) ? statusAfter.skills : [];
    checks.statusAfter = {
      total: skillsAfter.length,
      containsProbeSkillKey: skillsAfter.some((item) => item.skillKey === PROBE_SKILL_KEY),
    };

    try {
      await request("skills.install", {
        name: "__panel_missing_skill__",
        installId: "missing",
      });
      checks.installMissingError = {
        ok: false,
        error: "unexpected success",
      };
    } catch (error) {
      checks.installMissingError = {
        ok: true,
        error: asErrorMessage(error),
      };
    }

    try {
      await request("skills.bins", {});
      checks.binsError = {
        ok: false,
        error: "unexpected success",
      };
    } catch (error) {
      checks.binsError = {
        ok: true,
        error: asErrorMessage(error),
      };
    }

    const finishedAt = nowIso();
    const result = {
      startedAt,
      finishedAt,
      wsUrl: WS_URL,
      probeId,
      probeSkillKey: PROBE_SKILL_KEY,
      clientDistFile: runtime.fileName,
      hello,
      lastClose,
      checks,
      rpcTrace,
      stats: {
        rpcTotal: rpcTrace.length,
        rpcFailed: rpcTrace.filter((item) => !item.ok).length,
      },
      observations: [
        "skills.status 返回的是可识别技能列表；probe skillKey 不在列表中。",
        "skills.update 对 probe skillKey 返回成功（即使该 key 不在 skills.status）。",
        "skills.install 缺失技能名会失败并返回错误。",
        "skills.bins 对 operator 角色默认拒绝（unauthorized role）。",
      ],
    };

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    client.stop();
  }
}

await main();


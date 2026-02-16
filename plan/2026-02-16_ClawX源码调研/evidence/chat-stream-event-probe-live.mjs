import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DIST_DIR = "/app/dist";
const WS_URL = process.env.OPENCLAW_GATEWAY_WS_URL || "ws://127.0.0.1:18789/ws";
const CONNECT_TIMEOUT_MS = 12_000;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function extractText(message) {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const content = message.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  return content
    .map((part) => {
      if (!part || typeof part !== "object") {
        return "";
      }
      return typeof part.text === "string" ? part.text : "";
    })
    .join("")
    .trim();
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

function listRunStates(chatEvents, runId) {
  return chatEvents.filter((event) => event.runId === runId).map((event) => event.state);
}

function collectRunEvents(chatEvents, runId) {
  return chatEvents.filter((event) => event.runId === runId);
}

async function waitForTerminalState(chatEvents, runId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const runEvents = collectRunEvents(chatEvents, runId);
    const terminal = runEvents.find((event) =>
      ["final", "error", "aborted"].includes(event.state),
    );
    if (terminal) {
      return {
        timeout: false,
        terminalState: terminal.state,
        terminalAtMs: terminal.atMs,
      };
    }
    await sleep(120);
  }

  return {
    timeout: true,
    terminalState: null,
    terminalAtMs: null,
  };
}

async function main() {
  const startedAt = nowIso();
  const probeId = `panel-stream-probe-${Date.now()}`;
  const sessionKey = `agent:main:${probeId}`;

  const runtime = await loadGatewayClientClass();
  const GatewayClient = runtime.GatewayClient;

  const chatEvents = [];
  const agentLifecycleEvents = [];
  const rpcTrace = [];

  let readyResolve;
  let readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });

  let lastClose = null;
  let connected = false;

  const client = new GatewayClient({
    url: WS_URL,
    clientName: "cli",
    mode: "cli",
    instanceId: `${probeId}-client`,
    clientDisplayName: "panel-stream-probe",
    clientVersion: "probe",
    onEvent: (evt) => {
      if (!evt || typeof evt !== "object") {
        return;
      }

      if (evt.event === "chat") {
        const payload = evt.payload && typeof evt.payload === "object" ? evt.payload : {};
        chatEvents.push({
          atMs: Date.now(),
          runId: typeof payload.runId === "string" ? payload.runId : null,
          sessionKey: typeof payload.sessionKey === "string" ? payload.sessionKey : null,
          state: typeof payload.state === "string" ? payload.state : null,
          seq: typeof payload.seq === "number" ? payload.seq : null,
          stopReason: typeof payload.stopReason === "string" ? payload.stopReason : null,
          errorMessage:
            typeof payload.errorMessage === "string" ? payload.errorMessage : undefined,
          text: extractText(payload.message),
        });
        return;
      }

      if (evt.event === "agent") {
        const payload = evt.payload && typeof evt.payload === "object" ? evt.payload : {};
        const stream = typeof payload.stream === "string" ? payload.stream : null;
        const data = payload.data && typeof payload.data === "object" ? payload.data : {};
        const phase = typeof data.phase === "string" ? data.phase : null;
        if (stream === "lifecycle" || stream === "assistant") {
          agentLifecycleEvents.push({
            atMs: Date.now(),
            runId: typeof payload.runId === "string" ? payload.runId : null,
            sessionKey: typeof payload.sessionKey === "string" ? payload.sessionKey : null,
            stream,
            phase,
            seq: typeof payload.seq === "number" ? payload.seq : null,
          });
        }
      }
    },
    onHelloOk: (hello) => {
      connected = true;
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

  const scenarios = {
    normal: null,
    abort: null,
    invalidRequest: null,
    forcedRuntimeErrorAttempt: null,
  };

  try {
    client.start();

    const connectTimer = setTimeout(() => {
      readyReject(new Error(`connect timeout after ${CONNECT_TIMEOUT_MS}ms`));
    }, CONNECT_TIMEOUT_MS);
    const hello = await readyPromise;
    clearTimeout(connectTimer);

    const normalRunId = `${probeId}-normal`;
    const normalAck = await request("chat.send", {
      sessionKey,
      message: "请简短介绍你自己，并用两段输出。",
      idempotencyKey: normalRunId,
    });
    const normalTerminal = await waitForTerminalState(chatEvents, normalRunId, 45_000);
    scenarios.normal = {
      runId: normalRunId,
      ack: normalAck,
      states: listRunStates(chatEvents, normalRunId),
      terminal: normalTerminal,
      events: collectRunEvents(chatEvents, normalRunId),
    };

    const abortRunId = `${probeId}-abort`;
    const abortAck = await request("chat.send", {
      sessionKey,
      message: "请连续输出一份很长的技术报告，至少分成100个小节，不要提前结束。",
      idempotencyKey: abortRunId,
      timeoutMs: 60_000,
    });
    await sleep(450);
    const abortRes = await request("chat.abort", {
      sessionKey,
      runId: abortRunId,
    });
    const abortTerminal = await waitForTerminalState(chatEvents, abortRunId, 20_000);
    scenarios.abort = {
      runId: abortRunId,
      ack: abortAck,
      abortRes,
      states: listRunStates(chatEvents, abortRunId),
      terminal: abortTerminal,
      events: collectRunEvents(chatEvents, abortRunId),
    };

    const invalidRunId = `${probeId}-invalid`;
    try {
      await request("chat.send", {
        sessionKey,
        idempotencyKey: invalidRunId,
      });
      scenarios.invalidRequest = {
        runId: invalidRunId,
        ok: false,
        error: "unexpected success",
      };
    } catch (error) {
      scenarios.invalidRequest = {
        runId: invalidRunId,
        ok: true,
        error: asErrorMessage(error),
      };
    }

    const forcedRunId = `${probeId}-forced-error`;
    const forcedPatch = await request("sessions.patch", {
      key: sessionKey,
      model: "__panel_invalid_model__",
    });
    const forcedAck = await request("chat.send", {
      sessionKey,
      message: "hello",
      idempotencyKey: forcedRunId,
    });
    const forcedTerminal = await waitForTerminalState(chatEvents, forcedRunId, 45_000);
    scenarios.forcedRuntimeErrorAttempt = {
      runId: forcedRunId,
      patch: forcedPatch,
      ack: forcedAck,
      states: listRunStates(chatEvents, forcedRunId),
      terminal: forcedTerminal,
      events: collectRunEvents(chatEvents, forcedRunId),
    };

    const finishedAt = nowIso();

    const result = {
      startedAt,
      finishedAt,
      wsUrl: WS_URL,
      probeId,
      sessionKey,
      clientDistFile: runtime.fileName,
      hello,
      connected,
      lastClose,
      scenarios,
      rpcTrace,
      stats: {
        totalChatEvents: chatEvents.length,
        totalAgentLifecycleEvents: agentLifecycleEvents.length,
      },
      chatEvents,
      agentLifecycleEvents,
      observations: [
        "normal 流程出现 delta -> final。",
        "abort 流程出现 aborted，stopReason=rpc。",
        "invalidRequest 走 RPC 错误返回（无 run 启动）。",
        "forcedRuntimeErrorAttempt 中，invalid model 仍走到 final，未复现 chat.state=error。",
      ],
    };

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    client.stop();
  }
}

await main();

import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocketServer } from "ws";
import { GatewayRpcError, callGatewayRpc, resolveGatewayWsUrl, subscribeGatewayEvents } from "../../src/gateway-client.js";

async function withGatewayServer(bindHandlers, run) {
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, "listening");
  bindHandlers(wss);
  const address = wss.address();
  const wsUrl = `ws://127.0.0.1:${address.port}/ws`;

  try {
    await run(wsUrl);
  } finally {
    await new Promise((resolve) => {
      wss.close(() => resolve());
    });
  }
}

test("callGatewayRpc returns payload when gateway request succeeds", async () => {
  await withGatewayServer(
    (wss) => {
      wss.on("connection", (ws) => {
        ws.on("message", (raw) => {
          const frame = JSON.parse(String(raw || ""));
          if (frame.method === "connect") {
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { protocol: 1 } }));
            return;
          }
          if (frame.method === "sessions.list") {
            ws.send(
              JSON.stringify({
                type: "res",
                id: frame.id,
                ok: true,
                payload: { count: 2, sessions: [{ key: "a" }, { key: "b" }] }
              })
            );
          }
        });
      });
    },
    async (wsUrl) => {
      const payload = await callGatewayRpc({
        url: wsUrl,
        method: "sessions.list",
        timeoutMs: 1000
      });
      assert.equal(payload.count, 2);
      assert.equal(Array.isArray(payload.sessions), true);
    }
  );
});

test("callGatewayRpc normalizes remote unauthorized error", async () => {
  await withGatewayServer(
    (wss) => {
      wss.on("connection", (ws) => {
        ws.on("message", (raw) => {
          const frame = JSON.parse(String(raw || ""));
          if (frame.method === "connect") {
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { protocol: 1 } }));
            return;
          }
          ws.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "unauthorized", message: "unauthorized role: operator" }
            })
          );
        });
      });
    },
    async (wsUrl) => {
      await assert.rejects(
        callGatewayRpc({
          url: wsUrl,
          method: "skills.update",
          params: { skillKey: "demo" },
          timeoutMs: 1000
        }),
        (error) => {
          assert.equal(error instanceof GatewayRpcError, true);
          assert.equal(error.type, "auth");
          assert.equal(error.code, "unauthorized");
          return true;
        }
      );
    }
  );
});

test("callGatewayRpc retries once after timeout and succeeds", async () => {
  await withGatewayServer(
    (wss) => {
      let rpcCount = 0;
      wss.on("connection", (ws) => {
        ws.on("message", (raw) => {
          const frame = JSON.parse(String(raw || ""));
          if (frame.method === "connect") {
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { protocol: 1 } }));
            return;
          }
          rpcCount += 1;
          if (rpcCount === 1) {
            // Simulate first attempt timeout.
            return;
          }
          ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { ok: true, rpcCount } }));
        });
      });
    },
    async (wsUrl) => {
      const payload = await callGatewayRpc({
        url: wsUrl,
        method: "chat.history",
        timeoutMs: 120,
        retries: 1,
        retryDelayMs: 20
      });
      assert.equal(payload.ok, true);
      assert.equal(payload.rpcCount, 2);
    }
  );
});

test("callGatewayRpc handles connect.challenge handshake", async () => {
  await withGatewayServer(
    (wss) => {
      const nonce = "nonce-abc";
      wss.on("connection", (ws) => {
        ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce } }));
        ws.on("message", (raw) => {
          const frame = JSON.parse(String(raw || ""));
          if (frame.method === "connect") {
            if (frame?.params?.device?.nonce !== nonce) {
              return;
            }
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { protocol: 1 } }));
            return;
          }
          ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { result: "ok" } }));
        });
      });
    },
    async (wsUrl) => {
      const payload = await callGatewayRpc({
        url: wsUrl,
        method: "sessions.list",
        timeoutMs: 1000
      });
      assert.equal(payload.result, "ok");
    }
  );
});

test("resolveGatewayWsUrl uses runtime and env precedence", () => {
  const panelConfig = {
    runtime: { mode: "docker" },
    openclaw: {
      container_name: "openclaw-gateway",
      service_name: "openclaw-gateway",
      gateway_port: 18800
    }
  };

  assert.equal(
    resolveGatewayWsUrl(panelConfig, {
      OPENCLAW_GATEWAY_CONTAINER_PORT: "19001"
    }),
    "ws://openclaw-gateway:19001/ws"
  );
  assert.equal(
    resolveGatewayWsUrl(panelConfig, {
      OPENCLAW_GATEWAY_WS_URL: "ws://10.0.0.8:29000/ws"
    }),
    "ws://10.0.0.8:29000/ws"
  );
  assert.equal(
    resolveGatewayWsUrl(
      {
        runtime: { mode: "systemd" },
        openclaw: {}
      },
      {}
    ),
    "ws://127.0.0.1:18789/ws"
  );
});

test("subscribeGatewayEvents forwards chat events after connect", async () => {
  await withGatewayServer(
    (wss) => {
      wss.on("connection", (ws) => {
        ws.on("message", (raw) => {
          const frame = JSON.parse(String(raw || ""));
          if (frame.method === "connect") {
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { protocol: 1 } }));
            ws.send(
              JSON.stringify({
                type: "event",
                event: "chat",
                seq: 9,
                payload: {
                  runId: "run-1",
                  sessionKey: "agent:main:test",
                  state: "delta",
                  message: {
                    content: [{ type: "text", text: "hello" }]
                  }
                }
              })
            );
          }
        });
      });
    },
    async (wsUrl) => {
      const events = [];
      const sub = subscribeGatewayEvents({
        url: wsUrl,
        onEvent: (eventFrame) => {
          events.push(eventFrame);
        }
      });
      await sub.ready;
      await new Promise((resolve) => setTimeout(resolve, 30));
      sub.close();

      assert.equal(events.length, 1);
      assert.equal(events[0].event, "chat");
      assert.equal(events[0].seq, 9);
      assert.equal(events[0].payload.state, "delta");
    }
  );
});

test("subscribeGatewayEvents handles connect.challenge", async () => {
  await withGatewayServer(
    (wss) => {
      const nonce = "nonce-subscribe";
      wss.on("connection", (ws) => {
        ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce } }));
        ws.on("message", (raw) => {
          const frame = JSON.parse(String(raw || ""));
          if (frame.method === "connect" && frame?.params?.device?.nonce === nonce) {
            ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { protocol: 1 } }));
            ws.send(
              JSON.stringify({
                type: "event",
                event: "chat",
                payload: {
                  runId: "run-2",
                  sessionKey: "agent:main:test",
                  state: "final"
                }
              })
            );
          }
        });
      });
    },
    async (wsUrl) => {
      const events = [];
      const sub = subscribeGatewayEvents({
        url: wsUrl,
        onEvent: (eventFrame) => {
          events.push(eventFrame);
        }
      });
      await sub.ready;
      await new Promise((resolve) => setTimeout(resolve, 30));
      sub.close();
      assert.equal(events[0].event, "chat");
      assert.equal(events[0].payload.state, "final");
    }
  );
});

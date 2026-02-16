import assert from "node:assert/strict";
import test from "node:test";
import {
  abortChatRun,
  createChatEventSubscription,
  getChatHistory,
  listChatSessions,
  resetChatSession,
  sendChatMessage
} from "../../src/chat-service.js";

test("listChatSessions normalizes session list payload", async () => {
  const result = await listChatSessions({
    panelConfig: { openclaw: { config_path: "/tmp/openclaw.json" } },
    deps: {
      callGatewayRpc: async ({ method }) => {
        assert.equal(method, "sessions.list");
        return {
          count: 2,
          sessions: [
            {
              key: "agent:main:a",
              displayName: "A",
              updatedAt: 123,
              modelProvider: "demo",
              model: "model-a",
              contextTokens: 400000,
              totalTokens: 3000
            },
            {
              key: "agent:main:b",
              updatedAt: 456
            }
          ]
        };
      }
    }
  });

  assert.equal(result.total, 2);
  assert.equal(result.sessions.length, 2);
  assert.equal(result.sessions[0].key, "agent:main:a");
  assert.equal(result.sessions[1].displayName, "agent:main:b");
});

test("getChatHistory validates sessionKey and returns normalized payload", async () => {
  await assert.rejects(
    getChatHistory({
      panelConfig: {},
      sessionKey: ""
    }),
    /sessionKey 不能为空/
  );

  const result = await getChatHistory({
    panelConfig: {},
    sessionKey: "agent:main:test",
    limit: 5,
    deps: {
      callGatewayRpc: async ({ method, params }) => {
        assert.equal(method, "chat.history");
        assert.equal(params.limit, 5);
        return {
          sessionId: "sid-1",
          thinkingLevel: "off",
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }]
        };
      }
    }
  });

  assert.equal(result.sessionKey, "agent:main:test");
  assert.equal(result.sessionId, "sid-1");
  assert.equal(result.messages.length, 1);
});

test("sendChatMessage sends idempotent request and returns run info", async () => {
  const calls = [];
  const result = await sendChatMessage({
    panelConfig: {},
    sessionKey: "agent:main:test",
    message: "hello",
    deps: {
      callGatewayRpc: async ({ method, params }) => {
        calls.push({ method, params });
        return { runId: "run-1", status: "started" };
      }
    }
  });

  assert.equal(calls[0].method, "chat.send");
  assert.equal(calls[0].params.sessionKey, "agent:main:test");
  assert.equal(calls[0].params.message, "hello");
  assert.match(result.idempotencyKey, /^[0-9a-f-]{36}$/i);
  assert.equal(result.runId, "run-1");
  assert.equal(result.status, "started");
});

test("abortChatRun and resetChatSession forward payloads", async () => {
  const trace = [];
  const deps = {
    callGatewayRpc: async ({ method, params }) => {
      trace.push({ method, params });
      if (method === "chat.abort") {
        return { aborted: true, runIds: ["run-1"] };
      }
      if (method === "sessions.reset") {
        return { key: params.key, entry: { sessionId: "sid-new" } };
      }
      throw new Error(`unexpected method: ${method}`);
    }
  };

  const abortResult = await abortChatRun({
    panelConfig: {},
    sessionKey: "agent:main:test",
    runId: "run-1",
    deps
  });
  const resetResult = await resetChatSession({
    panelConfig: {},
    sessionKey: "agent:main:test",
    reason: "new",
    deps
  });

  assert.deepEqual(
    trace.map((item) => item.method),
    ["chat.abort", "sessions.reset"]
  );
  assert.equal(abortResult.aborted, true);
  assert.equal(abortResult.runIds[0], "run-1");
  assert.equal(resetResult.key, "agent:main:test");
  assert.equal(resetResult.entry.sessionId, "sid-new");
});

test("createChatEventSubscription filters by session and emits terminal", async () => {
  const forwarded = [];
  let closed = false;

  const sub = createChatEventSubscription({
    panelConfig: {},
    sessionKey: "agent:main:test",
    includeAgent: true,
    deps: {
      subscribeGatewayEvents: ({ onEvent }) => {
        setTimeout(() => {
          onEvent({
            event: "chat",
            seq: 1,
            payload: {
              runId: "run-a",
              sessionKey: "agent:main:test",
              state: "delta",
              message: { content: [{ type: "text", text: "hello" }] }
            }
          });
          onEvent({
            event: "chat",
            seq: 2,
            payload: {
              runId: "run-a",
              sessionKey: "agent:main:test",
              state: "final"
            }
          });
          onEvent({
            event: "chat",
            seq: 3,
            payload: {
              runId: "run-b",
              sessionKey: "agent:main:other",
              state: "delta"
            }
          });
          onEvent({
            event: "agent",
            seq: 4,
            payload: {
              runId: "run-a",
              sessionKey: "agent:main:test",
              stream: "assistant",
              data: {
                phase: "start"
              }
            }
          });
        }, 0);
        return {
          ready: Promise.resolve({ url: "ws://example" }),
          close: () => {
            closed = true;
          }
        };
      }
    },
    onEvent: (payload) => {
      forwarded.push(payload);
    }
  });

  await sub.ready;
  await new Promise((resolve) => setTimeout(resolve, 30));
  sub.close();

  assert.equal(closed, true);
  assert.equal(forwarded.length, 4);
  assert.equal(forwarded[0].type, "chat");
  assert.equal(forwarded[0].state, "delta");
  assert.equal(forwarded[1].type, "chat");
  assert.equal(forwarded[1].state, "final");
  assert.equal(forwarded[2].type, "terminal");
  assert.equal(forwarded[2].state, "final");
  assert.equal(forwarded[3].type, "agent");
  assert.equal(forwarded[3].phase, "start");
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  abortChatRun,
  createChatSession,
  createChatEventSubscription,
  getChatHistory,
  listChatSessions,
  resetChatSession,
  sendChatMessage,
  stageChatAttachment
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

test("sendChatMessage builds media references and image attachments for staged files", async () => {
  const calls = [];
  const imageBytes = Buffer.from("fake-image-content");
  const stagedPath = "/tmp/openclaw/media/outbound/test-image.png";
  const result = await sendChatMessage({
    panelConfig: { openclaw: { config_path: "/tmp/openclaw/openclaw.json" } },
    sessionKey: "agent:main:test",
    message: "请看附件",
    attachments: [
      {
        fileName: "test-image.png",
        mimeType: "image/png",
        stagedPath
      }
    ],
    deps: {
      existsSync: () => true,
      readFileSync: () => imageBytes,
      callGatewayRpc: async (payload) => {
        calls.push(payload);
        return { runId: "run-2", status: "started" };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "chat.send");
  assert.match(calls[0].params.message, /\[media attached: .*test-image\.png \(image\/png\) \| .*test-image\.png\]/);
  assert.equal(calls[0].params.attachments.length, 1);
  assert.equal(calls[0].params.attachments[0].mimeType, "image/png");
  assert.equal(calls[0].params.attachments[0].content, imageBytes.toString("base64"));
  assert.equal(calls[0].timeoutMs, 120000);
  assert.equal(result.runId, "run-2");
});

test("sendChatMessage maps local staged path to gateway media root in docker mode", async () => {
  const calls = [];
  await sendChatMessage({
    panelConfig: {
      runtime: { mode: "docker" },
      openclaw: {
        config_path: "/data/openclaw/openclaw.json",
        gateway_media_root: "/home/node/.openclaw"
      }
    },
    sessionKey: "agent:main:test",
    message: "请读取附件",
    attachments: [
      {
        fileName: "doc.txt",
        mimeType: "text/plain",
        stagedPath: "/data/openclaw/media/outbound/doc.txt"
      }
    ],
    deps: {
      existsSync: () => true,
      readFileSync: () => Buffer.from("text"),
      callGatewayRpc: async (payload) => {
        calls.push(payload);
        return { runId: "run-map", status: "started" };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.match(
    calls[0].params.message,
    /\[media attached: \/home\/node\/\.openclaw\/media\/outbound\/doc\.txt \(text\/plain\) \| \/home\/node\/\.openclaw\/media\/outbound\/doc\.txt\]/
  );
});

test("stageChatAttachment writes staged file under media outbound", async () => {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "panel-chat-stage-"));
  try {
    const panelConfig = {
      openclaw: {
        config_path: path.join(tmpRoot, "openclaw.json")
      }
    };

    const staged = await stageChatAttachment({
      panelConfig,
      fileName: "note.txt",
      mimeType: "text/plain",
      base64: Buffer.from("hello staged file").toString("base64")
    });

    assert.match(staged.stagedPath, /media[\\/]outbound[\\/]/);
    assert.equal(staged.fileName, "note.txt");
    assert.equal(staged.mimeType, "text/plain");
    const saved = await readFile(staged.stagedPath, "utf8");
    assert.equal(saved, "hello staged file");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("sendChatMessage rejects attachments outside outbound dir", async () => {
  await assert.rejects(
    sendChatMessage({
      panelConfig: { openclaw: { config_path: "/tmp/openclaw/openclaw.json" } },
      sessionKey: "agent:main:test",
      message: "x",
      attachments: [
        {
          fileName: "secrets.txt",
          mimeType: "text/plain",
          stagedPath: "/etc/passwd"
        }
      ],
      deps: {
        existsSync: () => true,
        readFileSync: () => Buffer.from("mock"),
        callGatewayRpc: async () => ({ runId: "run-bad", status: "started" })
      }
    }),
    /附件路径非法/
  );
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

test("createChatSession derives canonical prefix and creates new session", async () => {
  const trace = [];
  const result = await createChatSession({
    panelConfig: {},
    deps: {
      callGatewayRpc: async ({ method, params }) => {
        trace.push({ method, params });
        if (method === "sessions.list") {
          return {
            sessions: [
              { key: "agent:prod:abc" },
              { key: "agent:prod:def" }
            ]
          };
        }
        if (method === "sessions.reset") {
          return {
            key: params.key,
            entry: { sessionId: "sid-new" }
          };
        }
        throw new Error(`unexpected method: ${method}`);
      }
    }
  });

  assert.equal(trace[0].method, "sessions.list");
  assert.equal(trace[1].method, "sessions.reset");
  assert.equal(trace[1].params.reason, "new");
  assert.match(String(trace[1].params.key || ""), /^agent:prod:session-\d+-[0-9a-f]{8}$/i);
  assert.match(result.key, /^agent:prod:session-\d+-[0-9a-f]{8}$/i);
  assert.equal(result.entry.sessionId, "sid-new");
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

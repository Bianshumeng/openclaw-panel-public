import test from "node:test";
import assert from "node:assert/strict";
import { approvePendingGatewayPairings, approveTelegramPairing, setupTelegramBasic } from "../../src/channel-onboarding.js";

test("setupTelegramBasic executes enable + config steps in order", async () => {
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args });
    return {
      ok: true,
      code: 0,
      stdout: "ok",
      stderr: "",
      message: ""
    };
  };

  const result = await setupTelegramBasic({
    panelConfig: {
      runtime: {
        mode: "docker"
      },
      openclaw: {
        container_name: "openclaw-gateway"
      }
    },
    botToken: "123456:abcdef",
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 3);
  assert.deepEqual(
    calls.map((item) => item.args.join(" ")),
    [
      "exec openclaw-gateway openclaw plugins enable telegram",
      "exec openclaw-gateway openclaw config set channels.telegram.enabled true",
      "exec openclaw-gateway openclaw config set channels.telegram.botToken 123456:abcdef"
    ]
  );
  assert.match(result.steps[2].command, /\*\*\*/);
  assert.doesNotMatch(result.steps[2].output, /123456:abcdef/);
});

test("setupTelegramBasic falls back to node openclaw.mjs when openclaw executable is missing", async () => {
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args });
    const line = args.join(" ");
    if (line.startsWith("exec openclaw-gateway openclaw")) {
      return {
        ok: false,
        code: 127,
        stdout: 'OCI runtime exec failed: exec failed: unable to start container process: exec: "openclaw": executable file not found in $PATH: unknown',
        stderr: "",
        message: `Command failed: docker ${line}`
      };
    }
    return {
      ok: true,
      code: 0,
      stdout: "ok",
      stderr: "",
      message: ""
    };
  };

  const result = await setupTelegramBasic({
    panelConfig: {
      runtime: {
        mode: "docker"
      },
      openclaw: {
        container_name: "openclaw-gateway"
      }
    },
    botToken: "123456:abcdef",
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 3);
  assert.deepEqual(
    calls.map((item) => item.args.join(" ")),
    [
      "exec openclaw-gateway openclaw plugins enable telegram",
      "exec openclaw-gateway node /app/openclaw.mjs plugins enable telegram",
      "exec openclaw-gateway node /app/openclaw.mjs config set channels.telegram.enabled true",
      "exec openclaw-gateway node /app/openclaw.mjs config set channels.telegram.botToken 123456:abcdef"
    ]
  );
  assert.match(result.steps[0].output, /自动改用/);
});

test("setupTelegramBasic treats already-enabled plugin output as success", async () => {
  let callIndex = 0;
  const runCommand = async () => {
    callIndex += 1;
    if (callIndex === 1) {
      return {
        ok: false,
        code: 1,
        stdout: "",
        stderr: "telegram plugin already enabled",
        message: "command failed"
      };
    }
    return {
      ok: true,
      code: 0,
      stdout: "ok",
      stderr: "",
      message: ""
    };
  };

  const result = await setupTelegramBasic({
    panelConfig: {
      runtime: {
        mode: "systemd"
      }
    },
    botToken: "token-value",
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0].ok, true);
});

test("setupTelegramBasic retries failed step and succeeds without repeated clicking", async () => {
  const waits = [];
  let telegramEnableAttempt = 0;
  const runCommand = async (_command, args) => {
    const line = args.join(" ");
    if (line === "config set channels.telegram.enabled true") {
      telegramEnableAttempt += 1;
      if (telegramEnableAttempt === 1) {
        return {
          ok: false,
          code: 1,
          stdout: "",
          stderr: "transient error",
          message: "command failed"
        };
      }
    }
    return {
      ok: true,
      code: 0,
      stdout: "ok",
      stderr: "",
      message: ""
    };
  };

  const result = await setupTelegramBasic({
    panelConfig: {
      runtime: {
        mode: "systemd"
      }
    },
    botToken: "token-value",
    deps: {
      runCommand,
      setupStepRetryAttempts: 3,
      setupStepRetryDelayMs: 10,
      sleep: async (ms) => {
        waits.push(ms);
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 4);
  assert.equal(result.steps[1].ok, false);
  assert.match(result.steps[1].label, /尝试 1\/3/);
  assert.match(result.steps[2].label, /尝试 2\/3/);
  assert.deepEqual(waits, [10]);
});

test("approveTelegramPairing falls back to node openclaw.mjs when openclaw executable is missing", async () => {
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args });
    const line = args.join(" ");
    if (line.startsWith("exec openclaw-gateway openclaw")) {
      return {
        ok: false,
        code: 127,
        stdout: 'OCI runtime exec failed: exec failed: unable to start container process: exec: "openclaw": executable file not found in $PATH: unknown',
        stderr: "",
        message: `Command failed: docker ${line}`
      };
    }
    return {
      ok: true,
      code: 0,
      stdout: "approved",
      stderr: "",
      message: ""
    };
  };

  const result = await approveTelegramPairing({
    panelConfig: {
      runtime: {
        mode: "docker"
      },
      openclaw: {
        container_name: "openclaw-gateway"
      }
    },
    code: "ABC-123",
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((item) => item.args.join(" ")),
    [
      "exec openclaw-gateway openclaw pairing approve telegram ABC-123",
      "exec openclaw-gateway node /app/openclaw.mjs pairing approve telegram ABC-123"
    ]
  );
  assert.match(result.step.output, /自动改用/);
});

test("approveTelegramPairing validates code and executes command", async () => {
  const calls = [];
  const runCommand = async (command, args) => {
    calls.push({ command, args });
    return {
      ok: true,
      code: 0,
      stdout: "approved",
      stderr: "",
      message: ""
    };
  };

  const result = await approveTelegramPairing({
    panelConfig: {
      runtime: {
        mode: "docker"
      },
      openclaw: {
        container_name: "openclaw-gateway"
      }
    },
    code: "ABC-123",
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["exec", "openclaw-gateway", "openclaw", "pairing", "approve", "telegram", "ABC-123"]);
  assert.match(result.step.command, /\*\*\*/);
});

test("approvePendingGatewayPairings approves all pending requests", async () => {
  const calls = [];
  const runCommand = async (_command, args) => {
    calls.push(args);
    const line = args.join(" ");
    if (line === "devices list --json") {
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify({
          pending: [{ requestId: "req-1", deviceId: "device-1", role: "operator" }]
        }),
        stderr: "",
        message: ""
      };
    }
    if (line === "devices approve req-1") {
      return {
        ok: true,
        code: 0,
        stdout: "approved",
        stderr: "",
        message: ""
      };
    }
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: "unexpected call",
      message: ""
    };
  };

  const result = await approvePendingGatewayPairings({
    panelConfig: {
      runtime: {
        mode: "systemd"
      }
    },
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.approvedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(result.pending[0].requestId, "req-1");
  assert.equal(result.steps.length, 2);
  assert.equal(calls.length, 2);
});

test("approvePendingGatewayPairings returns ok when no pending request exists", async () => {
  const runCommand = async () => {
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify({
        pending: []
      }),
      stderr: "",
      message: ""
    };
  };

  const result = await approvePendingGatewayPairings({
    panelConfig: {
      runtime: {
        mode: "systemd"
      }
    },
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.pendingCount, 0);
  assert.equal(result.approvedCount, 0);
  assert.equal(result.failedCount, 0);
  assert.match(result.message, /没有待批准/);
});

test("approvePendingGatewayPairings reports partial failure details", async () => {
  const runCommand = async (_command, args) => {
    const line = args.join(" ");
    if (line === "devices list --json") {
      return {
        ok: true,
        code: 0,
        stdout: JSON.stringify({
          pending: [
            { requestId: "req-ok", deviceId: "device-ok", role: "operator" },
            { requestId: "req-fail", deviceId: "device-fail", role: "operator" }
          ]
        }),
        stderr: "",
        message: ""
      };
    }
    if (line === "devices approve req-ok") {
      return {
        ok: true,
        code: 0,
        stdout: "approved",
        stderr: "",
        message: ""
      };
    }
    if (line === "devices approve req-fail") {
      return {
        ok: false,
        code: 1,
        stdout: "",
        stderr: "approve failed",
        message: "approve failed"
      };
    }
    return {
      ok: false,
      code: 1,
      stdout: "",
      stderr: "unexpected call",
      message: ""
    };
  };

  const result = await approvePendingGatewayPairings({
    panelConfig: {
      runtime: {
        mode: "systemd"
      }
    },
    deps: {
      runCommand
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.approvedCount, 1);
  assert.equal(result.failedCount, 1);
  assert.match(result.message, /失败 1 个/);
});

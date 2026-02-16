import test from "node:test";
import assert from "node:assert/strict";
import { approveTelegramPairing, setupTelegramBasic } from "../../src/channel-onboarding.js";

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


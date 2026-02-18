import test from "node:test";
import assert from "node:assert/strict";
import { applyPulledTag } from "../../src/docker-update.js";

function buildInspectSnapshot() {
  return [
    {
      Name: "/openclaw-panel",
      Config: {
        Image: "ghcr.io/bianshumeng/openclaw-panel:0.1.0",
        Env: ["NODE_ENV=production"],
        Labels: {
          "com.example.test": "1"
        },
        Cmd: ["node", "src/server.js"]
      },
      HostConfig: {
        RestartPolicy: {
          Name: "unless-stopped"
        },
        Binds: ["/data/openclaw:/data/openclaw"],
        PortBindings: {
          "18080/tcp": [{ HostIp: "0.0.0.0", HostPort: "18080" }]
        },
        NetworkMode: "bridge"
      },
      NetworkSettings: {
        Networks: {
          "openclaw-internal": {}
        }
      }
    }
  ];
}

test("applyPulledTag schedules helper container and returns reconnect metadata", async () => {
  const seen = {
    helperArgs: null
  };

  const runCmd = async (command, args) => {
    assert.equal(command, "docker");
    if (args[0] === "inspect" && args.length === 2) {
      return {
        ok: true,
        stdout: JSON.stringify(buildInspectSnapshot()),
        stderr: "",
        message: ""
      };
    }
    if (args[0] === "pull") {
      return {
        ok: true,
        stdout: "pulled",
        stderr: "",
        message: ""
      };
    }
    if (args[0] === "run" && args[1] === "-d") {
      seen.helperArgs = args;
      return {
        ok: true,
        stdout: "helper-container-id",
        stderr: "",
        message: ""
      };
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };

  const result = await applyPulledTag({
    containerName: "openclaw-panel",
    targetTag: "0.1.1",
    imageRepo: "ghcr.io/bianshumeng/openclaw-panel",
    runCmd
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, "apply");
  assert.equal(result.targetImage, "ghcr.io/bianshumeng/openclaw-panel:0.1.1");
  assert.equal(result.requiresReconnect, true);
  assert.equal(result.helperContainerId, "helper-container-id");
  assert.ok(Array.isArray(seen.helperArgs));
  assert.ok(seen.helperArgs.includes("ghcr.io/bianshumeng/openclaw-panel:0.1.0"));
  assert.ok(!seen.helperArgs.includes("ghcr.io/bianshumeng/openclaw-panel:0.1.1"));

  const envIndex = seen.helperArgs.indexOf("-e");
  assert.notEqual(envIndex, -1);
  const encodedPlanArg = seen.helperArgs[envIndex + 1];
  assert.ok(encodedPlanArg.startsWith("OPENCLAW_RECREATE_PLAN_B64="));
  const encodedPlan = encodedPlanArg.slice("OPENCLAW_RECREATE_PLAN_B64=".length);
  const decodedPlan = JSON.parse(Buffer.from(encodedPlan, "base64").toString("utf8"));
  assert.equal(decodedPlan.containerName, "openclaw-panel");
  assert.ok(Array.isArray(decodedPlan.args));
  assert.ok(Array.isArray(decodedPlan.rollbackArgs));
  assert.ok(decodedPlan.args.includes("ghcr.io/bianshumeng/openclaw-panel:0.1.1"));
  assert.ok(decodedPlan.rollbackArgs.includes("ghcr.io/bianshumeng/openclaw-panel:0.1.0"));
});

test("applyPulledTag returns error when helper scheduling fails", async () => {
  const runCmd = async (command, args) => {
    assert.equal(command, "docker");
    if (args[0] === "inspect" && args.length === 2) {
      return {
        ok: true,
        stdout: JSON.stringify(buildInspectSnapshot()),
        stderr: "",
        message: ""
      };
    }
    if (args[0] === "pull") {
      return {
        ok: true,
        stdout: "pulled",
        stderr: "",
        message: ""
      };
    }
    if (args[0] === "run" && args[1] === "-d") {
      return {
        ok: false,
        stdout: "",
        stderr: "helper failed",
        message: ""
      };
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };

  const result = await applyPulledTag({
    containerName: "openclaw-panel",
    targetTag: "0.1.1",
    imageRepo: "ghcr.io/bianshumeng/openclaw-panel",
    runCmd
  });

  assert.equal(result.ok, false);
  assert.equal(result.requiresReconnect, false);
  assert.match(result.message, /helper failed|无法启动更新重建任务/);
});

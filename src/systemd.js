import { execFile } from "node:child_process";

function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 15000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: (stdout || "").trim(),
        stderr: (stderr || "").trim(),
        message: error?.message || ""
      });
    });
  });
}

async function runSystemdAction(action, serviceName) {
  if (process.platform !== "linux") {
    return {
      ok: false,
      action,
      runtimeMode: "systemd",
      serviceName,
      output: "仅 Linux + systemd 环境支持服务控制。"
    };
  }

  if (action === "status") {
    const active = await run("systemctl", ["is-active", serviceName]);
    const details = await run("systemctl", ["status", serviceName, "--no-pager", "-n", "30"]);
    return {
      ok: active.ok,
      action,
      runtimeMode: "systemd",
      serviceName,
      active: active.stdout === "active",
      output: [active.stdout, details.stdout, details.stderr].filter(Boolean).join("\n")
    };
  }

  const result = await run("systemctl", [action, serviceName]);
  return {
    ok: result.ok,
    action,
    runtimeMode: "systemd",
    serviceName,
    output: [result.stdout, result.stderr, result.message].filter(Boolean).join("\n")
  };
}

function composeContainerName(panelConfig) {
  return panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway";
}

async function runDockerStatus(containerName) {
  const status = await run("docker", ["inspect", "--format", "{{.State.Status}}", containerName]);
  const detail = await run("docker", ["ps", "-a", "--filter", `name=^/${containerName}$`]);
  const inspect = await run("docker", ["inspect", containerName]);

  const state = status.ok ? status.stdout.trim() : "not-found";
  const active = state === "running";
  const outputParts = [];
  if (status.stdout) {
    outputParts.push(`state: ${status.stdout}`);
  }
  if (detail.stdout) {
    outputParts.push(detail.stdout);
  }
  if (status.stderr) {
    outputParts.push(status.stderr);
  }
  if (inspect.stderr) {
    outputParts.push(inspect.stderr);
  }

  return {
    ok: status.ok,
    action: "status",
    runtimeMode: "docker",
    containerName,
    active,
    output: outputParts.join("\n").trim() || "容器不存在或不可访问。"
  };
}

async function runDockerAction(action, containerName) {
  if (action === "status") {
    return runDockerStatus(containerName);
  }

  const result = await run("docker", [action, containerName]);
  return {
    ok: result.ok,
    action,
    runtimeMode: "docker",
    containerName,
    output: [result.stdout, result.stderr, result.message].filter(Boolean).join("\n")
  };
}

export async function runServiceAction(action, panelConfig) {
  const runtimeMode = panelConfig?.runtime?.mode || "systemd";
  if (runtimeMode === "docker") {
    const containerName = composeContainerName(panelConfig);
    return runDockerAction(action, containerName);
  }
  return runSystemdAction(action, panelConfig?.openclaw?.service_name || "openclaw-gateway");
}

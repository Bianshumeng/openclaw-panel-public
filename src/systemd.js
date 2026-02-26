import { execFile } from "node:child_process";

const DOCKER_STATUS_PROBE_DELAY_MS = 1100;
const DOCKER_ACTION_VERIFY_DELAY_MS = 1800;
const DOCKER_STOP_VERIFY_DELAY_MS = 500;

function run(command, args, exec = execFile) {
  return new Promise((resolve) => {
    exec(command, args, { timeout: 15000 }, (error, stdout, stderr) => {
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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isMissingExecutableResult(result, executableName) {
  const executable = String(executableName || "").trim().toLowerCase();
  if (!executable) {
    return false;
  }
  if (result?.code === "ENOENT") {
    return true;
  }
  const text = [result?.stdout, result?.stderr, result?.message].filter(Boolean).join("\n").toLowerCase();
  if (!text) {
    return false;
  }
  const hasExecName = text.includes(`exec: "${executable}"`) || text.includes(`exec: ${executable}`);
  if (!hasExecName) {
    return false;
  }
  return text.includes("not found") || text.includes("no such file") || text.includes("executable file not found");
}

function buildMissingCliHint(platform) {
  if (platform === "win32") {
    return "未找到 openclaw CLI。请在 Windows 安装 OpenClaw CLI，或在 WSL2/网关主机运行面板后再重试。";
  }
  if (platform === "darwin") {
    return "未找到 openclaw CLI。请先安装 OpenClaw CLI 后再重试。";
  }
  return "未找到 openclaw CLI。请先安装 OpenClaw CLI 后再重试。";
}

async function runGatewayCliAction(action, { execFile: execOverride, platform, serviceName } = {}) {
  const exec = execOverride || execFile;
  const resolvedPlatform = platform || process.platform;
  const resolvedServiceName = serviceName || "openclaw-gateway";
  const runWith = async (binary) => {
    const result = await run(binary, ["gateway", action], exec);
    const output = [result.stdout, result.stderr, result.message].filter(Boolean).join("\n").trim();
    return { binary, result, output };
  };

  const primary = await runWith("openclaw");
  const missingPrimary = !primary.result.ok && isMissingExecutableResult(primary.result, "openclaw");
  if (missingPrimary && resolvedPlatform === "win32") {
    const fallback = await runWith("openclaw.cmd");
    const missingFallback = !fallback.result.ok && isMissingExecutableResult(fallback.result, "openclaw.cmd");
    if (!missingFallback) {
      return {
        ok: fallback.result.ok,
        action,
        runtimeMode: "cli",
        serviceName: resolvedServiceName,
        active: action === "status" ? fallback.result.ok : undefined,
        output: fallback.output,
        message: fallback.output
      };
    }
  }
  if (missingPrimary) {
    const hint = buildMissingCliHint(resolvedPlatform);
    return {
      ok: false,
      action,
      runtimeMode: "cli",
      serviceName: resolvedServiceName,
      active: false,
      missingExecutable: true,
      output: [hint, primary.output].filter(Boolean).join("\n"),
      message: hint
    };
  }
  return {
    ok: primary.result.ok,
    action,
    runtimeMode: "cli",
    serviceName: resolvedServiceName,
    active: action === "status" ? primary.result.ok : undefined,
    output: primary.output,
    message: primary.output
  };
}

async function runSystemdAction(action, serviceName, deps = {}) {
  const platform = deps.platform || process.platform;
  const exec = deps.execFile || execFile;
  if (platform !== "linux") {
    return {
      ok: false,
      action,
      runtimeMode: "systemd",
      serviceName,
      output: "仅 Linux + systemd 环境支持服务控制。",
      message: "仅 Linux + systemd 环境支持服务控制。"
    };
  }

  if (action === "status") {
    const active = await run("systemctl", ["is-active", serviceName], exec);
    const details = await run("systemctl", ["status", serviceName, "--no-pager", "-n", "30"], exec);
    const output = [active.stdout, details.stdout, details.stderr].filter(Boolean).join("\n");
    return {
      ok: active.ok,
      action,
      runtimeMode: "systemd",
      serviceName,
      active: active.stdout === "active",
      output,
      message: output
    };
  }

  const result = await run("systemctl", [action, serviceName], exec);
  const output = [result.stdout, result.stderr, result.message].filter(Boolean).join("\n");
  return {
    ok: result.ok,
    action,
    runtimeMode: "systemd",
    serviceName,
    output,
    message: output
  };
}

function composeContainerName(panelConfig) {
  return panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway";
}

function parseDockerInspectResult(stdout) {
  try {
    const parsed = JSON.parse(stdout || "[]");
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    return parsed[0];
  } catch {
    return null;
  }
}

async function inspectDockerState(containerName, deps = {}) {
  const exec = deps.execFile || execFile;
  const inspect = await run("docker", ["inspect", containerName], exec);
  if (!inspect.ok) {
    return {
      ok: false,
      message: [inspect.stdout, inspect.stderr, inspect.message].filter(Boolean).join("\n").trim() || "容器不存在或不可访问。"
    };
  }

  const firstEntry = parseDockerInspectResult(inspect.stdout);
  if (!firstEntry) {
    return {
      ok: false,
      message: "docker inspect 返回内容无法解析。"
    };
  }

  const state = firstEntry?.State && typeof firstEntry.State === "object" ? firstEntry.State : {};
  const status = String(state.Status || "unknown").trim() || "unknown";
  const restartCount = Number(firstEntry?.RestartCount ?? 0);
  const numericRestartCount = Number.isFinite(restartCount) ? restartCount : 0;
  const exitCode = Number(state?.ExitCode);

  return {
    ok: true,
    status,
    active: status === "running",
    restarting: Boolean(state?.Restarting),
    running: Boolean(state?.Running),
    restartCount: numericRestartCount,
    exitCode: Number.isFinite(exitCode) ? exitCode : null,
    error: String(state?.Error || "").trim(),
    startedAt: String(state?.StartedAt || ""),
    finishedAt: String(state?.FinishedAt || "")
  };
}

function buildDockerStateLines(snapshot) {
  const lines = [
    `state: ${snapshot.status}`,
    `running: ${snapshot.running ? "true" : "false"}`,
    `restarting: ${snapshot.restarting ? "true" : "false"}`,
    `restartCount: ${snapshot.restartCount}`
  ];
  if (snapshot.exitCode !== null) {
    lines.push(`exitCode: ${snapshot.exitCode}`);
  }
  if (snapshot.error) {
    lines.push(`error: ${snapshot.error}`);
  }
  if (snapshot.startedAt) {
    lines.push(`startedAt: ${snapshot.startedAt}`);
  }
  if (snapshot.finishedAt) {
    lines.push(`finishedAt: ${snapshot.finishedAt}`);
  }
  return lines;
}

async function runDockerStatus(
  containerName,
  { includeFailureLogs = true, probeRestartLoop = true } = {},
  deps = {}
) {
  const exec = deps.execFile || execFile;
  const detail = await run("docker", ["ps", "-a", "--filter", `name=^/${containerName}$`], exec);
  const firstSnapshot = await inspectDockerState(containerName, { execFile: exec });
  if (!firstSnapshot.ok) {
    const outputParts = [firstSnapshot.message];
    if (detail.stdout) {
      outputParts.push(detail.stdout);
    }
    return {
      ok: false,
      action: "status",
      runtimeMode: "docker",
      containerName,
      active: false,
      state: "not-found",
      output: outputParts.filter(Boolean).join("\n").trim() || "容器不存在或不可访问。"
    };
  }

  let snapshot = firstSnapshot;
  let instabilityReason = "";
  if (probeRestartLoop && firstSnapshot.status === "running") {
    await sleep(DOCKER_STATUS_PROBE_DELAY_MS);
    const secondSnapshot = await inspectDockerState(containerName, { execFile: exec });
    if (secondSnapshot.ok) {
      snapshot = secondSnapshot;
      if (secondSnapshot.status === "restarting") {
        instabilityReason = "容器处于重启中状态。";
      } else if (secondSnapshot.restartCount > firstSnapshot.restartCount) {
        instabilityReason = `检测到容器在短时间内重启次数增长（${firstSnapshot.restartCount} -> ${secondSnapshot.restartCount}）。`;
      }
    }
  }

  const active = snapshot.status === "running" && !instabilityReason;
  const outputParts = [];
  outputParts.push(...buildDockerStateLines(snapshot));
  if (instabilityReason) {
    outputParts.push(`statusHint: ${instabilityReason}`);
  }
  if (detail.stdout) {
    outputParts.push(detail.stdout);
  }

  if (!active && includeFailureLogs) {
    const logs = await run("docker", ["logs", "--tail", "60", containerName], exec);
    const combinedLogs = [logs.stdout, logs.stderr].filter(Boolean).join("\n").trim();
    if (combinedLogs) {
      outputParts.push("---- recent logs ----");
      outputParts.push(combinedLogs);
    } else if (!logs.ok && logs.message) {
      outputParts.push(`logs error: ${logs.message}`);
    }
  }

  return {
    ok: true,
    action: "status",
    runtimeMode: "docker",
    containerName,
    active,
    state: snapshot.status,
    restartCount: snapshot.restartCount,
    exitCode: snapshot.exitCode,
    instabilityReason,
    output: outputParts.join("\n").trim() || "容器不存在或不可访问。"
  };
}

async function runDockerAction(action, containerName, deps = {}) {
  const exec = deps.execFile || execFile;
  if (action === "status") {
    return runDockerStatus(containerName, {}, { execFile: exec });
  }

  const result = await run("docker", [action, containerName], exec);
  if (!result.ok) {
    return {
      ok: false,
      action,
      runtimeMode: "docker",
      containerName,
      output: [result.stdout, result.stderr, result.message].filter(Boolean).join("\n")
    };
  }

  if (action === "start" || action === "restart" || action === "stop") {
    await sleep(action === "stop" ? DOCKER_STOP_VERIFY_DELAY_MS : DOCKER_ACTION_VERIFY_DELAY_MS);
    const statusResult = await runDockerStatus(
      containerName,
      {
      includeFailureLogs: action !== "stop",
      probeRestartLoop: action !== "stop"
      },
      { execFile: exec }
    );
    const shouldBeActive = action !== "stop";
    const stateMatchesExpectation = shouldBeActive ? statusResult.active : !statusResult.active;
    if (!stateMatchesExpectation) {
      const actionText = action === "stop" ? "停止" : "启动";
      return {
        ok: false,
        action,
        runtimeMode: "docker",
        containerName,
        active: statusResult.active,
        state: statusResult.state,
        output: [
          [result.stdout, result.stderr, result.message].filter(Boolean).join("\n").trim(),
          `${actionText}后状态校验失败：当前状态 ${statusResult.state || "unknown"}。`,
          statusResult.output
        ]
          .filter(Boolean)
          .join("\n")
      };
    }

    return {
      ok: true,
      action,
      runtimeMode: "docker",
      containerName,
      active: statusResult.active,
      state: statusResult.state,
      output: [
        [result.stdout, result.stderr, result.message].filter(Boolean).join("\n").trim(),
        `状态校验通过：${statusResult.state || "unknown"}。`,
        statusResult.output
      ]
        .filter(Boolean)
        .join("\n")
    };
  }

  return {
    ok: true,
    action,
    runtimeMode: "docker",
    containerName,
    output: [result.stdout, result.stderr, result.message].filter(Boolean).join("\n")
  };
}

export async function runServiceAction(action, panelConfig, deps = {}) {
  const runtimeMode = panelConfig?.runtime?.mode || "systemd";
  if (runtimeMode === "docker") {
    const containerName = composeContainerName(panelConfig);
    return runDockerAction(action, containerName, deps);
  }
  const serviceName = panelConfig?.openclaw?.service_name || "openclaw-gateway";
  const platform = deps.platform || process.platform;

  if (platform === "linux") {
    const systemdResult = await runSystemdAction(action, serviceName, deps);
    if (systemdResult.ok) {
      return systemdResult;
    }
  }

  const cliResult = await runGatewayCliAction(action, {
    execFile: deps.execFile,
    platform,
    serviceName
  });
  if (!cliResult.missingExecutable) {
    return cliResult;
  }
  if (platform === "linux") {
    return runSystemdAction(action, serviceName, deps);
  }
  return cliResult;
}

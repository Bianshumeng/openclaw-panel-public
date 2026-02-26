import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DOCKER_CLI_PREFIXES = [
  ["openclaw"],
  ["node", "/app/openclaw.mjs"]
];
const DEFAULT_SETUP_STEP_RETRY_ATTEMPTS = 3;
const DEFAULT_SETUP_STEP_RETRY_DELAY_MS = 400;

function trimText(value) {
  return String(value || "").trim();
}

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function composeContainerName(panelConfig) {
  return trimText(panelConfig?.openclaw?.container_name || panelConfig?.openclaw?.service_name || "openclaw-gateway");
}

function shellEscape(value) {
  const text = String(value ?? "");
  if (!text) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:=-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function normalizeDockerCliPrefix(prefix) {
  if (!Array.isArray(prefix)) {
    return [];
  }
  return prefix.map((part) => trimText(part)).filter(Boolean);
}

function buildInvocation(panelConfig, openclawArgs, dockerCliPrefix = []) {
  const runtimeMode = trimText(panelConfig?.runtime?.mode) || "systemd";
  if (runtimeMode === "docker") {
    const containerName = composeContainerName(panelConfig);
    const cliPrefix = normalizeDockerCliPrefix(dockerCliPrefix);
    const normalizedCliPrefix = cliPrefix.length > 0 ? cliPrefix : [...DEFAULT_DOCKER_CLI_PREFIXES[0]];
    return {
      runtimeMode,
      containerName,
      dockerCliPrefix: normalizedCliPrefix,
      command: "docker",
      args: ["exec", containerName, ...normalizedCliPrefix, ...openclawArgs],
      openclawArgStartIndex: 2 + normalizedCliPrefix.length
    };
  }
  return {
    runtimeMode,
    containerName: "",
    dockerCliPrefix: [],
    command: "openclaw",
    args: [...openclawArgs],
    openclawArgStartIndex: 0
  };
}

function maskSecrets(text, secrets = []) {
  const raw = String(text || "");
  if (!raw) {
    return "";
  }
  return secrets
    .map((item) => trimText(item))
    .filter(Boolean)
    .reduce((current, secret) => current.split(secret).join("***"), raw);
}

function formatCommand(invocation, redactOpenclawArgIndices = []) {
  const redactSet = new Set(
    (Array.isArray(redactOpenclawArgIndices) ? redactOpenclawArgIndices : [])
      .map((index) => Number(index))
      .filter((index) => Number.isInteger(index) && index >= 0)
  );
  const renderedArgs = invocation.args.map((arg, index) => {
    const openclawIndex = index - invocation.openclawArgStartIndex;
    if (openclawIndex >= 0 && redactSet.has(openclawIndex)) {
      return "***";
    }
    return shellEscape(arg);
  });
  return [invocation.command, ...renderedArgs].join(" ");
}

async function runCommand(command, args, timeoutMs, exec = execFile) {
  return await new Promise((resolve) => {
    exec(command, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        message: String(error?.message || "")
      });
    });
  });
}

function normalizeCommandResult(result, invocation, { secrets = [], redactOpenclawArgIndices = [] } = {}) {
  const stdout = maskSecrets(trimText(result?.stdout), secrets);
  const stderr = maskSecrets(trimText(result?.stderr), secrets);
  const message = maskSecrets(trimText(result?.message), secrets);
  const output = [stdout, stderr, message].filter(Boolean).join("\n").trim();
  return {
    ok: Boolean(result?.ok),
    code: Number.isFinite(Number(result?.code)) ? Number(result.code) : 0,
    runtimeMode: invocation.runtimeMode,
    containerName: invocation.containerName,
    command: formatCommand(invocation, redactOpenclawArgIndices),
    stdout,
    stderr,
    message,
    output
  };
}

function isAlreadyEnabledOutput(output) {
  const text = String(output || "").toLowerCase();
  return text.includes("already enabled") || text.includes("已经启用") || text.includes("已启用");
}

function isMissingExecutableResult(rawResult, executableName) {
  const executable = trimText(executableName).toLowerCase();
  if (!executable) {
    return false;
  }
  const text = [trimText(rawResult?.stdout), trimText(rawResult?.stderr), trimText(rawResult?.message)]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (!text) {
    return false;
  }
  const hasExecName = text.includes(`exec: "${executable}"`) || text.includes(`exec: ${executable}`);
  if (!hasExecName) {
    return false;
  }
  return (
    text.includes("executable file not found") ||
    text.includes("not found in $path") ||
    text.includes("no such file or directory")
  );
}

function prependFallbackHint(output, fromPrefix, toPrefix) {
  const hint = `检测到容器内未找到 '${fromPrefix.join(" ")}'，已自动改用 '${toPrefix.join(" ")}'。`;
  const normalizedOutput = trimText(output);
  return [hint, normalizedOutput].filter(Boolean).join("\n");
}

function parseJsonOutput(text, label = "命令") {
  const raw = trimText(text);
  if (!raw) {
    throw new Error(`${label} 返回为空，无法解析 JSON`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} 返回非 JSON：${error.message || String(error)}`);
  }
}

function pickRequestId(pendingItem = {}) {
  const candidates = [pendingItem.requestId, pendingItem.request, pendingItem.id, pendingItem.request_id];
  for (const item of candidates) {
    const value = trimText(item);
    if (value) {
      return value;
    }
  }
  return "";
}

function normalizePendingEntry(pendingItem = {}) {
  return {
    requestId: pickRequestId(pendingItem),
    deviceId: trimText(pendingItem.deviceId || pendingItem.device),
    role: trimText(pendingItem.role || (Array.isArray(pendingItem.roles) ? pendingItem.roles[0] : "")),
    clientId: trimText(pendingItem.clientId),
    clientMode: trimText(pendingItem.clientMode)
  };
}

export async function runOpenClawCli({
  panelConfig,
  openclawArgs,
  dockerCliPrefix = [],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redactOpenclawArgIndices = [],
  secrets = [],
  deps = {}
}) {
  const normalizedArgs = Array.isArray(openclawArgs) ? openclawArgs.map((arg) => String(arg)) : [];
  if (normalizedArgs.length === 0) {
    throw new Error("openclawArgs 不能为空");
  }

  const runFn = deps.runCommand || runCommand;
  const runtimeMode = trimText(panelConfig?.runtime?.mode) || "systemd";
  if (runtimeMode !== "docker") {
    const invocation = buildInvocation(panelConfig, normalizedArgs, dockerCliPrefix);
    const raw = await runFn(invocation.command, invocation.args, timeoutMs);
    const normalized = normalizeCommandResult(raw, invocation, {
      secrets,
      redactOpenclawArgIndices
    });
    return {
      ...normalized,
      dockerCliPrefix: []
    };
  }

  const requestedDockerCliPrefix = normalizeDockerCliPrefix(dockerCliPrefix);
  const dockerCliCandidates = requestedDockerCliPrefix.length > 0 ? [requestedDockerCliPrefix] : DEFAULT_DOCKER_CLI_PREFIXES;
  let previousMissingPrefix = [];

  for (let index = 0; index < dockerCliCandidates.length; index += 1) {
    const currentPrefix = dockerCliCandidates[index];
    const invocation = buildInvocation(panelConfig, normalizedArgs, currentPrefix);
    const raw = await runFn(invocation.command, invocation.args, timeoutMs);
    const normalized = normalizeCommandResult(raw, invocation, {
      secrets,
      redactOpenclawArgIndices
    });
    const canFallback = index < dockerCliCandidates.length - 1;
    const missingExecutable = !normalized.ok && isMissingExecutableResult(raw, currentPrefix[0]);

    if (missingExecutable && canFallback) {
      previousMissingPrefix = currentPrefix;
      continue;
    }

    if (previousMissingPrefix.length > 0) {
      normalized.output = prependFallbackHint(normalized.output, previousMissingPrefix, currentPrefix);
    }

    return {
      ...normalized,
      dockerCliPrefix: [...currentPrefix]
    };
  }

  const fallbackPrefix = normalizeDockerCliPrefix(dockerCliPrefix);
  return {
    ok: false,
    code: 1,
    runtimeMode: "docker",
    containerName: composeContainerName(panelConfig),
    command: formatCommand(buildInvocation(panelConfig, normalizedArgs, fallbackPrefix.length > 0 ? fallbackPrefix : ["openclaw"])),
    output: "未找到可用的 OpenClaw CLI 入口。请检查容器内 openclaw 可执行文件或 /app/openclaw.mjs 是否存在。",
    dockerCliPrefix: fallbackPrefix
  };
}

export async function setupTelegramBasic({ panelConfig, botToken, deps = {} }) {
  const token = trimText(botToken);
  if (!token) {
    throw new Error("Bot Token 不能为空");
  }
  const setupRetryAttempts = toPositiveInt(deps.setupStepRetryAttempts, DEFAULT_SETUP_STEP_RETRY_ATTEMPTS);
  const setupRetryDelayMs = toPositiveInt(deps.setupStepRetryDelayMs, DEFAULT_SETUP_STEP_RETRY_DELAY_MS);
  const wait =
    typeof deps.sleep === "function"
      ? deps.sleep
      : async (ms) =>
          await new Promise((resolve) => {
            setTimeout(resolve, ms);
          });

  let activeDockerCliPrefix = [];

  const stepDefs = [
    {
      label: "启用 Telegram 插件",
      openclawArgs: ["plugins", "enable", "telegram"],
      allowAlreadyEnabled: true
    },
    {
      label: "启用 Telegram 渠道",
      openclawArgs: ["config", "set", "channels.telegram.enabled", "true"]
    },
    {
      label: "写入 Telegram Bot Token",
      openclawArgs: ["config", "set", "channels.telegram.botToken", token],
      redactOpenclawArgIndices: [3],
      secrets: [token]
    }
  ];

  const steps = [];
  for (const definition of stepDefs) {
    let accepted = false;
    for (let attempt = 1; attempt <= setupRetryAttempts; attempt += 1) {
      const { dockerCliPrefix: resolvedDockerCliPrefix, ...result } = await runOpenClawCli({
        panelConfig,
        openclawArgs: definition.openclawArgs,
        dockerCliPrefix: activeDockerCliPrefix,
        redactOpenclawArgIndices: definition.redactOpenclawArgIndices || [],
        secrets: definition.secrets || [],
        deps
      });
      if (Array.isArray(resolvedDockerCliPrefix) && resolvedDockerCliPrefix.length > 0) {
        activeDockerCliPrefix = [...resolvedDockerCliPrefix];
      }
      accepted =
        Boolean(result.ok) || (definition.allowAlreadyEnabled === true && isAlreadyEnabledOutput(result.output));
      const retryWaitMs = setupRetryDelayMs * attempt;
      const needsRetryHint = !accepted && attempt < setupRetryAttempts;
      const output = needsRetryHint
        ? [result.output, `步骤失败，${retryWaitMs}ms 后自动重试`].filter(Boolean).join("\n")
        : result.output;
      const step = {
        ...result,
        ok: accepted,
        label: setupRetryAttempts > 1 ? `${definition.label}（尝试 ${attempt}/${setupRetryAttempts}）` : definition.label,
        output
      };
      steps.push(step);

      if (accepted) {
        break;
      }
      if (needsRetryHint) {
        await wait(retryWaitMs);
      }
    }

    if (!accepted) {
      return {
        ok: false,
        failedStep: definition.label,
        message: `${definition.label}失败（已重试 ${setupRetryAttempts} 次）`,
        steps
      };
    }
  }

  return {
    ok: true,
    message: "Telegram 已保存并启用，可继续验证码配对",
    steps
  };
}

export async function approveTelegramPairing({ panelConfig, code, deps = {} }) {
  const pairingCode = trimText(code);
  if (!pairingCode) {
    throw new Error("验证码不能为空");
  }

  const { dockerCliPrefix: _ignoredDockerCliPrefix, ...result } = await runOpenClawCli({
    panelConfig,
    openclawArgs: ["pairing", "approve", "telegram", pairingCode],
    redactOpenclawArgIndices: [3],
    secrets: [pairingCode],
    deps
  });
  if (!result.ok) {
    return {
      ok: false,
      message: "验证码验证失败",
      step: {
        ...result,
        label: "验证码验证"
      }
    };
  }
  return {
    ok: true,
    message: "验证码验证成功，Telegram 已完成配对",
    step: {
      ...result,
      label: "验证码验证"
    }
  };
}

export async function approvePendingGatewayPairings({ panelConfig, deps = {} }) {
  const steps = [];

  const { dockerCliPrefix: resolvedDockerCliPrefix, ...listResult } = await runOpenClawCli({
    panelConfig,
    openclawArgs: ["devices", "list", "--json"],
    deps
  });
  const activeDockerCliPrefix =
    Array.isArray(resolvedDockerCliPrefix) && resolvedDockerCliPrefix.length > 0 ? [...resolvedDockerCliPrefix] : [];
  steps.push({
    ...listResult,
    label: "读取待处理设备配对列表"
  });

  if (!listResult.ok) {
    return {
      ok: false,
      message: "读取待处理设备配对列表失败",
      pendingCount: 0,
      approvedCount: 0,
      failedCount: 0,
      pending: [],
      approvals: [],
      steps
    };
  }

  let pendingList;
  try {
    const payload = parseJsonOutput(listResult.stdout, "openclaw devices list --json");
    const pendingRaw = Array.isArray(payload?.pending) ? payload.pending : [];
    pendingList = pendingRaw.map((item) => normalizePendingEntry(item));
  } catch (error) {
    const detail = error.message || String(error);
    steps.push({
      ok: false,
      code: 1,
      runtimeMode: listResult.runtimeMode,
      containerName: listResult.containerName,
      command: listResult.command,
      stdout: "",
      stderr: "",
      message: detail,
      output: detail,
      label: "解析待处理设备配对列表"
    });
    return {
      ok: false,
      message: detail,
      pendingCount: 0,
      approvedCount: 0,
      failedCount: 0,
      pending: [],
      approvals: [],
      steps
    };
  }

  if (pendingList.length === 0) {
    return {
      ok: true,
      message: "当前没有待批准的设备配对请求",
      pendingCount: 0,
      approvedCount: 0,
      failedCount: 0,
      pending: [],
      approvals: [],
      steps
    };
  }

  const approvals = [];
  let dockerCliPrefixForApprove = activeDockerCliPrefix;
  for (const pending of pendingList) {
    const requestId = trimText(pending.requestId);
    if (!requestId) {
      const detail = "待处理项缺少 requestId，无法批准";
      const failedStep = {
        ok: false,
        code: 1,
        runtimeMode: listResult.runtimeMode,
        containerName: listResult.containerName,
        command: "openclaw devices approve <missing-requestId>",
        stdout: "",
        stderr: "",
        message: detail,
        output: detail,
        label: "批准待处理设备配对"
      };
      approvals.push({
        requestId: "",
        deviceId: pending.deviceId,
        role: pending.role,
        ok: false,
        output: detail
      });
      steps.push(failedStep);
      continue;
    }

    const { dockerCliPrefix: nextDockerCliPrefix, ...approveResult } = await runOpenClawCli({
      panelConfig,
      openclawArgs: ["devices", "approve", requestId],
      dockerCliPrefix: dockerCliPrefixForApprove,
      deps
    });
    if (Array.isArray(nextDockerCliPrefix) && nextDockerCliPrefix.length > 0) {
      dockerCliPrefixForApprove = [...nextDockerCliPrefix];
    }

    approvals.push({
      requestId,
      deviceId: pending.deviceId,
      role: pending.role,
      ok: approveResult.ok,
      output: approveResult.output
    });
    steps.push({
      ...approveResult,
      label: `批准待处理设备配对 ${requestId}`
    });
  }

  const approvedCount = approvals.filter((item) => item.ok).length;
  const failedCount = approvals.length - approvedCount;
  const allSucceeded = failedCount === 0;

  return {
    ok: allSucceeded,
    message: allSucceeded
      ? `已批准 ${approvedCount} 个待处理设备配对请求`
      : `待处理设备配对共 ${pendingList.length} 个，成功 ${approvedCount} 个，失败 ${failedCount} 个`,
    pendingCount: pendingList.length,
    approvedCount,
    failedCount,
    pending: pendingList,
    approvals,
    steps
  };
}

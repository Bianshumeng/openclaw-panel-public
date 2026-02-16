import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;

function trimText(value) {
  return String(value || "").trim();
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

function buildInvocation(panelConfig, openclawArgs) {
  const runtimeMode = trimText(panelConfig?.runtime?.mode) || "systemd";
  if (runtimeMode === "docker") {
    const containerName = composeContainerName(panelConfig);
    return {
      runtimeMode,
      containerName,
      command: "docker",
      args: ["exec", containerName, "openclaw", ...openclawArgs],
      openclawArgStartIndex: 3
    };
  }
  return {
    runtimeMode,
    containerName: "",
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

function toOutputText(result) {
  return [trimText(result?.stdout), trimText(result?.stderr), trimText(result?.message)].filter(Boolean).join("\n").trim();
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
  const output = maskSecrets(toOutputText(result), secrets);
  return {
    ok: Boolean(result?.ok),
    code: Number.isFinite(Number(result?.code)) ? Number(result.code) : 0,
    runtimeMode: invocation.runtimeMode,
    containerName: invocation.containerName,
    command: formatCommand(invocation, redactOpenclawArgIndices),
    output
  };
}

function isAlreadyEnabledOutput(output) {
  const text = String(output || "").toLowerCase();
  return text.includes("already enabled") || text.includes("已经启用") || text.includes("已启用");
}

export async function runOpenClawCli({
  panelConfig,
  openclawArgs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redactOpenclawArgIndices = [],
  secrets = [],
  deps = {}
}) {
  const normalizedArgs = Array.isArray(openclawArgs) ? openclawArgs.map((arg) => String(arg)) : [];
  if (normalizedArgs.length === 0) {
    throw new Error("openclawArgs 不能为空");
  }

  const invocation = buildInvocation(panelConfig, normalizedArgs);
  const runFn = deps.runCommand || runCommand;
  const raw = await runFn(invocation.command, invocation.args, timeoutMs);
  return normalizeCommandResult(raw, invocation, {
    secrets,
    redactOpenclawArgIndices
  });
}

export async function setupTelegramBasic({ panelConfig, botToken, deps = {} }) {
  const token = trimText(botToken);
  if (!token) {
    throw new Error("Bot Token 不能为空");
  }

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
    const result = await runOpenClawCli({
      panelConfig,
      openclawArgs: definition.openclawArgs,
      redactOpenclawArgIndices: definition.redactOpenclawArgIndices || [],
      secrets: definition.secrets || [],
      deps
    });
    const accepted = result.ok || (definition.allowAlreadyEnabled && isAlreadyEnabledOutput(result.output));
    const step = {
      ...result,
      ok: accepted,
      label: definition.label
    };
    steps.push(step);

    if (!accepted) {
      return {
        ok: false,
        failedStep: definition.label,
        message: `${definition.label}失败`,
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

  const result = await runOpenClawCli({
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


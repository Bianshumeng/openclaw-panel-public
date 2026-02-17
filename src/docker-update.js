import { execFile } from "node:child_process";

const DEFAULT_IMAGE_REPO = "ghcr.io/openclaw/openclaw";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
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

function ensureString(value) {
  return typeof value === "string" ? value : "";
}

function stripLeadingV(value) {
  const raw = ensureString(value).trim();
  return raw.startsWith("v") ? raw.slice(1) : raw;
}

export function normalizeTag(value) {
  const normalized = stripLeadingV(value);
  if (!normalized) {
    throw new Error("版本号不能为空");
  }
  if (!/^[0-9][0-9A-Za-z._-]*$/.test(normalized)) {
    throw new Error("版本号格式不合法");
  }
  return normalized;
}

export function imageTagFromImage(image) {
  const raw = ensureString(image).trim();
  if (!raw.includes(":")) {
    return "";
  }
  return raw.slice(raw.lastIndexOf(":") + 1);
}

function parseVersionParts(tag) {
  return normalizeTag(tag)
    .split(".")
    .map((item) => {
      const num = Number.parseInt(item, 10);
      return Number.isNaN(num) ? 0 : num;
    });
}

export function compareVersionTags(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  const length = Math.max(pa.length, pb.length);
  for (let i = 0; i < length; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) {
      return 1;
    }
    if (av < bv) {
      return -1;
    }
  }
  return 0;
}

export function makeImageRef(tag, imageRepo = DEFAULT_IMAGE_REPO) {
  return `${imageRepo}:${normalizeTag(tag)}`;
}

function resolveGithubRepoFromImageRepo(imageRepo) {
  const raw = ensureString(imageRepo).trim().replace(/^https?:\/\//, "");
  if (!raw) {
    return null;
  }

  const parts = raw
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);

  // owner/repo (implicit GitHub repo)
  if (parts.length === 2 && !/[.:]/.test(parts[0])) {
    return { owner: parts[0], repo: parts[1] };
  }

  // ghcr.io/owner/repo
  if (parts.length >= 3 && parts[0].toLowerCase() === "ghcr.io") {
    return { owner: parts[1], repo: parts[2] };
  }

  return null;
}

export async function fetchLatestRelease({ imageRepo = DEFAULT_IMAGE_REPO, fetchImpl = fetch } = {}) {
  const githubRepo = resolveGithubRepoFromImageRepo(imageRepo);
  if (!githubRepo) {
    throw new Error(`无法从镜像仓库推导 GitHub 仓库: ${imageRepo}`);
  }
  const response = await fetchImpl(`https://api.github.com/repos/${githubRepo.owner}/${githubRepo.repo}/releases/latest`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "openclaw-panel"
    }
  });
  if (!response.ok) {
    throw new Error(`GitHub API 请求失败: ${response.status}`);
  }
  const payload = await response.json();
  const tag = normalizeTag(payload.tag_name || "");
  return {
    releaseRepo: `${githubRepo.owner}/${githubRepo.repo}`,
    tag,
    publishedAt: payload.published_at || null
  };
}

async function inspectContainer(containerName, runCmd = runCommand) {
  const result = await runCmd("docker", ["inspect", containerName]);
  if (!result.ok) {
    throw new Error(`读取容器信息失败: ${result.stderr || result.message || "unknown"}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("解析容器 inspect 结果失败");
  }
  if (!Array.isArray(parsed) || !parsed[0]) {
    throw new Error("容器 inspect 结果为空");
  }
  return parsed[0];
}

function formatPortBinding(containerPort, binding) {
  const hostIp = ensureString(binding?.HostIp || "");
  const hostPort = ensureString(binding?.HostPort || "");
  if (!hostPort) {
    return containerPort;
  }
  if (!hostIp || hostIp === "0.0.0.0") {
    return `${hostPort}:${containerPort}`;
  }
  return `${hostIp}:${hostPort}:${containerPort}`;
}

export function buildDockerRunArgs(inspect, image) {
  const containerName = ensureString(inspect?.Name || "").replace(/^\//, "");
  if (!containerName) {
    throw new Error("无法解析容器名");
  }

  const args = ["run", "-d", "--name", containerName];
  const hostConfig = inspect?.HostConfig || {};
  const restart = hostConfig?.RestartPolicy || {};
  const restartName = ensureString(restart?.Name || "");
  if (restartName && restartName !== "no") {
    if (restartName === "on-failure" && Number(restart?.MaximumRetryCount) > 0) {
      args.push("--restart", `${restartName}:${restart.MaximumRetryCount}`);
    } else {
      args.push("--restart", restartName);
    }
  }

  const binds = Array.isArray(hostConfig?.Binds) ? hostConfig.Binds : [];
  binds.forEach((bind) => {
    if (bind) {
      args.push("-v", bind);
    }
  });

  const portBindings = hostConfig?.PortBindings || {};
  Object.entries(portBindings).forEach(([containerPort, bindings]) => {
    const list = Array.isArray(bindings) ? bindings : [];
    list.forEach((binding) => {
      args.push("-p", formatPortBinding(containerPort, binding));
    });
  });

  const envList = Array.isArray(inspect?.Config?.Env) ? inspect.Config.Env : [];
  envList.forEach((item) => {
    args.push("-e", item);
  });

  const labels = inspect?.Config?.Labels || {};
  Object.entries(labels).forEach(([key, value]) => {
    if (key) {
      args.push("--label", `${key}=${value ?? ""}`);
    }
  });

  if (inspect?.Config?.WorkingDir) {
    args.push("-w", inspect.Config.WorkingDir);
  }
  if (inspect?.Config?.User) {
    args.push("-u", inspect.Config.User);
  }

  const networks = Object.keys(inspect?.NetworkSettings?.Networks || {});
  const networkMode = ensureString(hostConfig?.NetworkMode || "");
  const primaryNetwork =
    networkMode && !["bridge", "default", "none"].includes(networkMode) ? networkMode : networks[0] || "";
  if (primaryNetwork) {
    args.push("--network", primaryNetwork);
  }

  args.push(image);
  const cmd = inspect?.Config?.Cmd;
  if (Array.isArray(cmd)) {
    args.push(...cmd);
  } else if (typeof cmd === "string" && cmd.trim()) {
    args.push(cmd.trim());
  }

  const extraNetworks = networks.filter((name) => name && name !== primaryNetwork);
  return {
    containerName,
    args,
    extraNetworks
  };
}

function parseStateStatusLine(value) {
  const text = ensureString(value).trim();
  if (!text) {
    return {
      status: "",
      restartCount: null
    };
  }
  const [statusRaw, restartCountRaw] = text.split("|", 2);
  const status = ensureString(statusRaw).trim().toLowerCase();
  const parsedRestart = Number.parseInt(ensureString(restartCountRaw).trim(), 10);
  return {
    status,
    restartCount: Number.isNaN(parsedRestart) ? null : parsedRestart
  };
}

async function waitContainerRunning(containerName, runCmd = runCommand) {
  let stableRunningCount = 0;
  let lastRestartCount = null;
  for (let i = 0; i < 10; i += 1) {
    const result = await runCmd("docker", ["inspect", "--format", "{{.State.Status}}|{{.RestartCount}}", containerName]);
    if (result.ok) {
      const snapshot = parseStateStatusLine(result.stdout);
      const hasRestartCount = Number.isInteger(snapshot.restartCount);
      if (snapshot.status === "running") {
        if (!hasRestartCount) {
          stableRunningCount += 1;
        } else if (lastRestartCount !== null && snapshot.restartCount === lastRestartCount) {
          stableRunningCount += 1;
        } else {
          stableRunningCount = 1;
        }
        lastRestartCount = hasRestartCount ? snapshot.restartCount : null;
        if (stableRunningCount >= 2) {
          return true;
        }
      } else {
        stableRunningCount = 0;
        lastRestartCount = hasRestartCount ? snapshot.restartCount : null;
      }
    } else {
      stableRunningCount = 0;
      lastRestartCount = null;
    }
    await sleep(1000);
  }
  return false;
}

async function pullImageWithRetry(image, runCmd = runCommand, attempts = 3) {
  let last = null;
  for (let i = 1; i <= attempts; i += 1) {
    const result = await runCmd("docker", ["pull", image], 120000);
    last = result;
    if (result.ok) {
      return result;
    }
    if (i < attempts) {
      await sleep(i * 1000);
    }
  }
  return last || { ok: false, stderr: "镜像拉取失败", message: "镜像拉取失败" };
}

async function recreateContainer(inspect, image, runCmd = runCommand) {
  const plan = buildDockerRunArgs(inspect, image);
  await runCmd("docker", ["rm", "-f", plan.containerName]);
  const runResult = await runCmd("docker", plan.args, 60000);
  if (!runResult.ok) {
    throw new Error(runResult.stderr || runResult.message || "容器重建失败");
  }
  for (const network of plan.extraNetworks) {
    const connectResult = await runCmd("docker", ["network", "connect", network, plan.containerName]);
    if (!connectResult.ok && !/already exists/i.test(connectResult.stderr)) {
      throw new Error(connectResult.stderr || connectResult.message || `连接网络失败: ${network}`);
    }
  }
  const running = await waitContainerRunning(plan.containerName, runCmd);
  if (!running) {
    throw new Error("容器启动超时，未进入 running 状态");
  }
}

export async function checkForUpdates({
  containerName = "openclaw-gateway",
  imageRepo = DEFAULT_IMAGE_REPO,
  fetchImpl = fetch,
  runCmd = runCommand
} = {}) {
  const inspect = await inspectContainer(containerName, runCmd);
  const currentImage = ensureString(inspect?.Config?.Image || "");
  const currentTag = imageTagFromImage(currentImage);
  let latestTag = "";
  let latestPublishedAt = null;
  let updateAvailable = false;
  let warning = "";
  let releaseRepo = "";

  try {
    const latest = await fetchLatestRelease({ imageRepo, fetchImpl });
    releaseRepo = latest.releaseRepo || "";
    latestTag = latest.tag;
    latestPublishedAt = latest.publishedAt;
    if (currentTag) {
      updateAvailable = compareVersionTags(latestTag, currentTag) > 0;
    }
  } catch (error) {
    warning = error.message;
  }

  return {
    ok: true,
    containerName,
    imageRepo,
    releaseRepo,
    currentImage,
    currentTag,
    latestTag,
    latestPublishedAt,
    updateAvailable,
    warning
  };
}

async function mutateVersion({
  action,
  containerName,
  targetTag,
  imageRepo = DEFAULT_IMAGE_REPO,
  runCmd = runCommand
}) {
  const normalizedTag = normalizeTag(targetTag);
  const targetImage = makeImageRef(normalizedTag, imageRepo);
  const snapshot = await inspectContainer(containerName, runCmd);
  const oldImage = ensureString(snapshot?.Config?.Image || "");

  const pullResult = await pullImageWithRetry(targetImage, runCmd, 3);
  if (!pullResult.ok) {
    return {
      ok: false,
      action,
      containerName,
      targetImage,
      oldImage,
      rolledBack: false,
      message: pullResult.stderr || pullResult.message || "目标镜像拉取失败"
    };
  }

  try {
    await recreateContainer(snapshot, targetImage, runCmd);
    return {
      ok: true,
      action,
      containerName,
      targetImage,
      oldImage,
      rolledBack: false,
      message: `${action} 成功`
    };
  } catch (error) {
    let rollbackOk = false;
    let rollbackMessage = "";
    if (oldImage) {
      try {
        await pullImageWithRetry(oldImage, runCmd, 3);
        await recreateContainer(snapshot, oldImage, runCmd);
        rollbackOk = true;
        rollbackMessage = "已自动回滚到旧版本";
      } catch (rollbackError) {
        rollbackMessage = rollbackError.message;
      }
    }
    return {
      ok: false,
      action,
      containerName,
      targetImage,
      oldImage,
      rolledBack: rollbackOk,
      message: error.message,
      rollbackMessage
    };
  }
}

export async function upgradeToTag(options) {
  return mutateVersion({ ...options, action: "upgrade" });
}

export async function rollbackToTag(options) {
  return mutateVersion({ ...options, action: "rollback" });
}

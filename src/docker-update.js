import { execFile } from "node:child_process";

const DEFAULT_IMAGE_REPO = "ghcr.io/openclaw/openclaw";
const SELF_RECREATE_PLAN_ENV = "OPENCLAW_RECREATE_PLAN_B64";
const SELF_RECREATE_HELPER_SCRIPT = `
const { spawnSync } = require("node:child_process");
const PLAN_ENV_KEY = "${SELF_RECREATE_PLAN_ENV}";
const SLEEP_SEC = 1;

function run(args) {
  return spawnSync("docker", args, { encoding: "utf8" });
}

function runSleep(seconds) {
  return spawnSync("sh", ["-lc", "sleep " + String(seconds)], { encoding: "utf8" });
}

function outputOf(result) {
  return [result?.stdout, result?.stderr, result?.error?.message].filter(Boolean).join("\\n").trim();
}

function fail(message, result) {
  const detail = result ? outputOf(result) : "";
  console.error(detail ? \`\${message}: \${detail}\` : message);
  process.exit(1);
}

const encodedPlan = String(process.env[PLAN_ENV_KEY] || "").trim();
if (!encodedPlan) {
  fail("missing recreate plan");
}

let plan;
try {
  plan = JSON.parse(Buffer.from(encodedPlan, "base64").toString("utf8"));
} catch (error) {
  fail(\`invalid recreate plan: \${error.message}\`);
}

if (!plan || !plan.containerName || !Array.isArray(plan.args)) {
  fail("recreate plan is malformed");
}

function waitRunning(containerName) {
  for (let i = 0; i < 20; i += 1) {
    const statusResult = run(["inspect", "--format", "{{.State.Status}}", String(containerName)]);
    const status = String(statusResult.stdout || "").trim().toLowerCase();
    if (statusResult.status === 0 && status === "running") {
      return true;
    }
    runSleep(SLEEP_SEC);
  }
  return false;
}

function connectExtraNetworks(containerName, extraNetworks) {
  const networks = Array.isArray(extraNetworks) ? extraNetworks : [];
  for (const network of networks) {
    if (!network) {
      continue;
    }
    const connectResult = run(["network", "connect", String(network), String(containerName)]);
    const connectOutput = outputOf(connectResult).toLowerCase();
    if (connectResult.status !== 0 && !connectOutput.includes("already exists")) {
      return {
        ok: false,
        result: connectResult,
        message: \`failed to connect extra network \${network}\`
      };
    }
  }
  return {
    ok: true,
    result: null,
    message: ""
  };
}

function recreateAndVerify(containerName, args, extraNetworks, reasonLabel) {
  const recreateResult = run(args);
  if (recreateResult.status !== 0) {
    return {
      ok: false,
      result: recreateResult,
      message: \`failed to recreate container (\${reasonLabel})\`
    };
  }

  const connectResult = connectExtraNetworks(containerName, extraNetworks);
  if (!connectResult.ok) {
    return connectResult;
  }

  if (!waitRunning(containerName)) {
    return {
      ok: false,
      result: null,
      message: \`container did not reach running state (\${reasonLabel})\`
    };
  }

  return {
    ok: true,
    result: null,
    message: ""
  };
}

const containerName = String(plan.containerName);
const extraNetworks = Array.isArray(plan.extraNetworks) ? plan.extraNetworks : [];
const rollbackArgs = Array.isArray(plan.rollbackArgs) ? plan.rollbackArgs : [];
const rollbackExtraNetworks = Array.isArray(plan.rollbackExtraNetworks) ? plan.rollbackExtraNetworks : extraNetworks;

// ignore errors if container does not exist
run(["rm", "-f", containerName]);

const applyResult = recreateAndVerify(containerName, plan.args, extraNetworks, "apply");
if (applyResult.ok) {
  console.log("running");
  process.exit(0);
}

if (rollbackArgs.length > 0) {
  // apply failed: best-effort restore the previous image to keep panel available.
  run(["rm", "-f", containerName]);
  const rollbackResult = recreateAndVerify(containerName, rollbackArgs, rollbackExtraNetworks, "rollback");
  if (rollbackResult.ok) {
    fail("failed to apply target image; rolled back to previous image", applyResult.result);
  }
  fail(
    \`failed to apply target image, and rollback also failed: \${rollbackResult.message}\`,
    rollbackResult.result || applyResult.result
  );
}

fail(applyResult.message || "container did not reach running state", applyResult.result);
`;

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

  return null;
}

function resolveGhcrPackageFromImageRepo(imageRepo) {
  const raw = ensureString(imageRepo).trim().replace(/^https?:\/\//, "");
  if (!raw) {
    return null;
  }

  const parts = raw
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length >= 3 && parts[0].toLowerCase() === "ghcr.io") {
    return { owner: parts[1], packageName: parts[2] };
  }

  return null;
}

function buildGithubApiHeaders(githubToken = "") {
  const headers = {
    accept: "application/vnd.github+json",
    "user-agent": "openclaw-panel"
  };
  const token = ensureString(githubToken).trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function buildGhcrHeaders(token = "") {
  const headers = {
    accept: "application/json",
    "user-agent": "openclaw-panel"
  };
  const normalizedToken = ensureString(token).trim();
  if (normalizedToken) {
    headers.authorization = `Bearer ${normalizedToken}`;
  }
  return headers;
}

async function fetchGhcrPackageVersions({ owner, packageName, fetchImpl = fetch, githubToken = "" }) {
  const encodedOwner = encodeURIComponent(owner);
  const encodedPackage = encodeURIComponent(packageName);
  const headers = buildGithubApiHeaders(githubToken);
  const endpoints = [
    `https://api.github.com/users/${encodedOwner}/packages/container/${encodedPackage}/versions?per_page=100`,
    `https://api.github.com/orgs/${encodedOwner}/packages/container/${encodedPackage}/versions?per_page=100`
  ];

  let lastStatus = 0;
  for (const url of endpoints) {
    const response = await fetchImpl(url, { headers });
    if (response.ok) {
      const payload = await response.json();
      return Array.isArray(payload) ? payload : [];
    }
    lastStatus = response.status;
    if (response.status === 404) {
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      const authError = new Error(`GitHub API 请求失败: ${response.status}（请确认 token 具备 read:packages 权限）`);
      authError.status = response.status;
      throw authError;
    }
    const responseError = new Error(`GitHub API 请求失败: ${response.status}`);
    responseError.status = response.status;
    throw responseError;
  }

  if (lastStatus === 404) {
    const notFoundError = new Error("GitHub API 请求失败: 404（请确认镜像地址正确，且私有包已提供 read:packages token）");
    notFoundError.status = 404;
    throw notFoundError;
  }

  const unknownError = new Error(`GitHub API 请求失败: ${lastStatus || "unknown"}`);
  unknownError.status = lastStatus || 0;
  throw unknownError;
}

function buildGhcrTokenUrl(owner, packageName) {
  const scope = encodeURIComponent(`repository:${owner}/${packageName}:pull`);
  return `https://ghcr.io/token?scope=${scope}&service=ghcr.io`;
}

async function fetchGhcrRegistryTags({ owner, packageName, fetchImpl = fetch }) {
  const tokenUrl = buildGhcrTokenUrl(owner, packageName);
  const tokenResponse = await fetchImpl(tokenUrl, { headers: buildGhcrHeaders() });
  if (!tokenResponse.ok) {
    throw new Error(`GHCR token 请求失败: ${tokenResponse.status}`);
  }

  const tokenPayload = await tokenResponse.json();
  const pullToken = ensureString(tokenPayload?.token).trim();
  if (!pullToken) {
    throw new Error("GHCR token 请求成功但未返回 token");
  }

  const tagsUrl = `https://ghcr.io/v2/${owner}/${packageName}/tags/list`;
  const tagsResponse = await fetchImpl(tagsUrl, { headers: buildGhcrHeaders(pullToken) });
  if (!tagsResponse.ok) {
    throw new Error(`GHCR tags 请求失败: ${tagsResponse.status}`);
  }

  const tagsPayload = await tagsResponse.json();
  return Array.isArray(tagsPayload?.tags) ? tagsPayload.tags : [];
}

function extractLatestTagFromRegistryTags(tags = []) {
  const candidates = [];
  for (const rawTag of tags) {
    const text = ensureString(rawTag).trim();
    if (!text) {
      continue;
    }
    const lower = text.toLowerCase();
    if (lower === "latest" || lower.startsWith("sha-")) {
      continue;
    }
    try {
      candidates.push({
        tag: normalizeTag(text),
        publishedAt: null
      });
    } catch {
      // Ignore non-semver-like tags.
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => compareVersionTags(b.tag, a.tag));
  return candidates[0];
}

function extractLatestTagFromPackageVersions(versions = []) {
  const candidates = [];
  for (const item of versions) {
    const tags = Array.isArray(item?.metadata?.container?.tags) ? item.metadata.container.tags : [];
    const publishedAt = ensureString(item?.updated_at || item?.created_at || "");
    for (const rawTag of tags) {
      const text = ensureString(rawTag).trim();
      if (!text) {
        continue;
      }
      const lower = text.toLowerCase();
      if (lower === "latest" || lower.startsWith("sha-")) {
        continue;
      }
      try {
        const normalizedTag = normalizeTag(text);
        candidates.push({
          tag: normalizedTag,
          publishedAt: publishedAt || null
        });
      } catch {
        // Ignore non-semver-like tags.
      }
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => compareVersionTags(b.tag, a.tag));
  return candidates[0];
}

async function fetchLatestGithubReleaseTag({ owner, repo, fetchImpl = fetch, githubToken = "" }) {
  const headers = buildGithubApiHeaders(githubToken);
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/releases/latest`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API 请求失败: ${response.status}`);
  }
  const payload = await response.json();
  const tag = normalizeTag(payload.tag_name || "");
  return {
    releaseRepo: `${owner}/${repo}`,
    tag,
    publishedAt: payload.published_at || null
  };
}

function resolveGithubToken(githubToken = "") {
  const direct = ensureString(githubToken).trim();
  if (direct) {
    return direct;
  }

  const envValue = ensureString(
    process.env.OPENCLAW_UPDATE_GITHUB_TOKEN ||
      process.env.GITHUB_PACKAGES_TOKEN ||
      process.env.GHCR_READ_TOKEN ||
      process.env.GHCR_TOKEN ||
      process.env.GITHUB_TOKEN
  ).trim();
  return envValue;
}

export async function fetchLatestRelease({ imageRepo = DEFAULT_IMAGE_REPO, fetchImpl = fetch, githubToken = "" } = {}) {
  const token = resolveGithubToken(githubToken);
  const ghcrPackage = resolveGhcrPackageFromImageRepo(imageRepo);
  if (ghcrPackage) {
    let latest = null;

    try {
      const versions = await fetchGhcrPackageVersions({
        owner: ghcrPackage.owner,
        packageName: ghcrPackage.packageName,
        fetchImpl,
        githubToken: token
      });
      latest = extractLatestTagFromPackageVersions(versions);
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        // Public GHCR packages can be read without PAT via anonymous pull token.
        try {
          const tags = await fetchGhcrRegistryTags({
            owner: ghcrPackage.owner,
            packageName: ghcrPackage.packageName,
            fetchImpl
          });
          latest = extractLatestTagFromRegistryTags(tags);
        } catch {
          // Keep original auth error to preserve guidance for private package troubleshooting.
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (!latest) {
      throw new Error("未找到可用版本标签（请确保镜像已发布非 latest 的版本 tag）");
    }
    return {
      releaseRepo: `${ghcrPackage.owner}/${ghcrPackage.packageName}`,
      tag: latest.tag,
      publishedAt: latest.publishedAt
    };
  }

  const githubRepo = resolveGithubRepoFromImageRepo(imageRepo);
  if (!githubRepo) {
    throw new Error(`无法从镜像仓库推导 GitHub 仓库或 GHCR 包: ${imageRepo}`);
  }

  return {
    ...(await fetchLatestGithubReleaseTag({
      owner: githubRepo.owner,
      repo: githubRepo.repo,
      fetchImpl,
      githubToken: token
    }))
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
  githubToken = "",
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
    const latest = await fetchLatestRelease({ imageRepo, fetchImpl, githubToken });
    releaseRepo = latest.releaseRepo || "";
    latestTag = latest.tag;
    latestPublishedAt = latest.publishedAt;
    if (currentTag) {
      try {
        updateAvailable = compareVersionTags(latestTag, currentTag) > 0;
      } catch {
        // Non-semver-like current tags (e.g. "local") should not break update checks.
        updateAvailable = stripLeadingV(currentTag) !== latestTag;
      }
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

export async function pullTag({
  containerName = "openclaw-gateway",
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
      action: "pull",
      containerName,
      targetImage,
      oldImage,
      rolledBack: false,
      requiresRestart: false,
      message: pullResult.stderr || pullResult.message || "目标镜像拉取失败"
    };
  }

  return {
    ok: true,
    action: "pull",
    containerName,
    targetImage,
    oldImage,
    rolledBack: false,
    requiresRestart: true,
    message: "镜像拉取成功；重启容器后生效"
  };
}

async function scheduleSelfRecreateByHelper({ plan, helperImage, runCmd = runCommand }) {
  const payload = {
    containerName: String(plan?.containerName || "").trim(),
    args: Array.isArray(plan?.args) ? plan.args : [],
    extraNetworks: Array.isArray(plan?.extraNetworks) ? plan.extraNetworks : [],
    rollbackArgs: Array.isArray(plan?.rollbackArgs) ? plan.rollbackArgs : [],
    rollbackExtraNetworks: Array.isArray(plan?.rollbackExtraNetworks) ? plan.rollbackExtraNetworks : []
  };
  if (!payload.containerName || payload.args.length === 0) {
    throw new Error("无法生成重建计划，缺少必要容器参数");
  }

  const encodedPlan = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const helperResult = await runCmd(
    "docker",
    [
      "run",
      "-d",
      "--rm",
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-e",
      `${SELF_RECREATE_PLAN_ENV}=${encodedPlan}`,
      "--pull",
      "never",
      helperImage,
      "node",
      "-e",
      SELF_RECREATE_HELPER_SCRIPT
    ],
    30000
  );

  if (!helperResult.ok) {
    throw new Error(helperResult.stderr || helperResult.message || "无法启动更新重建任务");
  }

  const helperContainerId = ensureString(helperResult.stdout)
    .split(/\s+/)
    .filter(Boolean)
    .pop();

  return {
    helperContainerId: helperContainerId || ""
  };
}

export async function applyPulledTag({
  containerName = "openclaw-panel",
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
      action: "apply",
      containerName,
      targetImage,
      oldImage,
      rolledBack: false,
      requiresRestart: false,
      requiresReconnect: false,
      message: pullResult.stderr || pullResult.message || "目标镜像拉取失败"
    };
  }

  try {
    const plan = buildDockerRunArgs(snapshot, targetImage);
    const rollbackPlan = oldImage ? buildDockerRunArgs(snapshot, oldImage) : null;
    const helper = await scheduleSelfRecreateByHelper({
      plan: {
        ...plan,
        rollbackArgs: rollbackPlan?.args || [],
        rollbackExtraNetworks: rollbackPlan?.extraNetworks || []
      },
      helperImage: oldImage || targetImage,
      runCmd
    });
    return {
      ok: true,
      action: "apply",
      containerName,
      targetImage,
      oldImage,
      rolledBack: false,
      requiresRestart: false,
      requiresReconnect: true,
      reconnectAfterMs: 6000,
      helperContainerId: helper.helperContainerId,
      message: "已开始重启并应用更新，页面会短暂断开并自动恢复"
    };
  } catch (error) {
    return {
      ok: false,
      action: "apply",
      containerName,
      targetImage,
      oldImage,
      rolledBack: false,
      requiresRestart: false,
      requiresReconnect: false,
      message: error.message || "无法启动重启并应用更新任务"
    };
  }
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

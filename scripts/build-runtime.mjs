import { build, transform } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify as terserMinify } from "terser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const runtimeRoot = path.join(rootDir, ".runtime");
const runtimePublicDir = path.join(runtimeRoot, "public");
const runtimeSrcDir = path.join(runtimeRoot, "src");
const obfuscationMode = String(process.env.RUNTIME_OBFUSCATION || "light")
  .trim()
  .toLowerCase();
const shouldObfuscate = obfuscationMode !== "off" && obfuscationMode !== "none" && obfuscationMode !== "0";

function shouldMinifyJs(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  if (!normalized.endsWith(".js")) {
    return false;
  }
  // Keep vendor bundles untouched to avoid breaking third-party behavior.
  return !normalized.includes("/shoelace/");
}

async function minifyJsFile(sourcePath, targetPath) {
  const source = await fs.readFile(sourcePath, "utf8");
  const result = await transform(source, {
    loader: "js",
    minify: true,
    legalComments: "none",
    target: "es2020",
    charset: "utf8",
    drop: ["debugger"]
  });
  const moduleSyntax = /\bimport\s.+from\b|\bexport\s+(?:default|const|let|var|function|class|\{)/.test(source);
  const finalCode = await lightlyObfuscate(result.code, { module: moduleSyntax });
  await fs.writeFile(targetPath, finalCode, "utf8");
}

async function lightlyObfuscate(code, { module = false } = {}) {
  if (!shouldObfuscate) {
    return code;
  }
  const result = await terserMinify(code, {
    ecma: 2020,
    module,
    compress: {
      passes: 2,
      drop_debugger: true,
      pure_getters: true
    },
    mangle: {
      toplevel: true,
      keep_classnames: false,
      keep_fnames: false
    },
    format: {
      comments: false
    }
  });
  if (!result.code) {
    throw new Error("runtime obfuscation failed: empty output");
  }
  return result.code;
}

async function copyPublicTree(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await copyPublicTree(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile() && shouldMinifyJs(sourcePath)) {
      await minifyJsFile(sourcePath, targetPath);
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

async function bundleServer() {
  await fs.mkdir(runtimeSrcDir, { recursive: true });
  const outfile = path.join(runtimeSrcDir, "server.js");
  await build({
    entryPoints: [path.join(rootDir, "src", "server.js")],
    outfile,
    bundle: true,
    minify: true,
    legalComments: "none",
    platform: "node",
    format: "esm",
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';const require=__createRequire(import.meta.url);"
    },
    target: "node22",
    sourcemap: false,
    logLevel: "info"
  });
  const bundledCode = await fs.readFile(outfile, "utf8");
  const obfuscatedCode = await lightlyObfuscate(bundledCode, { module: true });
  await fs.writeFile(outfile, obfuscatedCode, "utf8");
}

async function main() {
  await fs.rm(runtimeRoot, { recursive: true, force: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  await Promise.all([bundleServer(), copyPublicTree(publicDir, runtimePublicDir)]);
  if (shouldObfuscate) {
    console.log("runtime obfuscation: light");
  } else {
    console.log("runtime obfuscation: disabled");
  }
  console.log(`runtime build complete: ${runtimeRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

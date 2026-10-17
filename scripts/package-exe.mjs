// 打包单文件 exe：停服务 → 构建面板 → release 构建（内嵌资源 + 静态 CRT）→ 输出到 dist/。
//
// 与 run-rust-tool.mjs 共用 cargo / llvm-mingw 的解析逻辑，避免出现第二套工具链约定。
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  binaryName,
  childEnvironment,
  manifestPath,
  projectRoot,
  resolveCargoExe,
  rustProjectRoot,
} from "./run-rust-tool.mjs";

const FEATURE = "embedded-assets";
// 开发机是 gnullvm 目标：不静态链接 CRT 时会依赖 libunwind.dll，单文件分发必须带上这个开关。
const RELEASE_RUSTFLAGS = "-C target-feature=+crt-static";
const RUN_RUST_TOOL = path.join(projectRoot, "scripts", "run-rust-tool.mjs");
const outputDir = path.join(projectRoot, "dist");
const outputPath = path.join(outputDir, "codex-for-wps-word.exe");

function step(title) {
  console.log(`\n== ${title} ==`);
}

function run(commandLine, args = [], { env = {}, shell = false } = {}) {
  const result = spawnSync(commandLine, args, {
    cwd: projectRoot,
    env: { ...childEnvironment(resolveCargoExe()), ...env },
    stdio: "inherit",
    windowsHide: true,
    shell,
  });
  if (result.error) throw new Error(`${commandLine} 执行失败：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${commandLine} 退出码 ${result.status}`);
}

function runNpm(args) {
  // Windows 上 npm 是 npm.cmd，Node 20 起不允许直接 spawn 批处理，必须走 shell。
  // 传整条命令字符串（参数固定、无外部输入）可以避开 Node 22 对 shell+args 的弃用告警。
  run(["npm", ...args].join(" "), [], { shell: true });
}

function releaseBinaryPath() {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const targetDir = process.env.CARGO_TARGET_DIR
    ? path.resolve(projectRoot, process.env.CARGO_TARGET_DIR)
    : path.join(rustProjectRoot, "target");
  const triple = process.env.CARGO_BUILD_TARGET || "";
  return path.join(targetDir, triple, "release", `${binaryName}${suffix}`);
}

function main() {
  if (!resolveCargoExe()) {
    throw new Error("找不到 Cargo。请安装 Rust 或设置 CARGO_EXE 后再打包。");
  }

  step("停止本地服务（避免与面板构建、打包产物互相占用）");
  run(process.execPath, [RUN_RUST_TOOL, "services", "stop"]);

  step("构建面板静态产物");
  runNpm(["run", "panel:build"]);

  step(`release 构建（--features ${FEATURE}，RUSTFLAGS=${RELEASE_RUSTFLAGS}）`);
  run(
    resolveCargoExe(),
    ["build", "--release", "--features", FEATURE, "--manifest-path", manifestPath],
    { env: { RUSTFLAGS: RELEASE_RUSTFLAGS } }
  );

  const builtPath = releaseBinaryPath();
  if (!existsSync(builtPath)) {
    throw new Error(`构建产物不存在：${builtPath}`);
  }

  mkdirSync(outputDir, { recursive: true });
  copyFileSync(builtPath, outputPath);
  const sizeInMb = (statSync(outputPath).size / (1024 * 1024)).toFixed(2);

  console.log(`\n打包完成：${outputPath}（${sizeInMb} MB）`);
  console.log("这是单文件产物：加载项与面板资源都已内嵌，旁边不需要 addin/ 与 panel/ 目录。");
  console.log("本地服务当前处于停止状态，继续开发请运行：npm run services:start");
}

try {
  main();
} catch (error) {
  console.error(`\n打包失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

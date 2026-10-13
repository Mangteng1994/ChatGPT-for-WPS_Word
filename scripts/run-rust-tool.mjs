import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rustProjectRoot = path.resolve(projectRoot, "..", "codex-for-wps-word-rust");
const manifestPath = path.join(rustProjectRoot, "Cargo.toml");
const artifactRecord = path.join(projectRoot, "logs", "rust-tool-artifact.json");
const binaryName = "codex-for-wps-word-rust";

function splitPathList(value) {
  return String(value || "").split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

function resolveCargoExe() {
  const fileName = process.platform === "win32" ? "cargo.exe" : "cargo";
  return firstExisting([
    process.env.CARGO_EXE,
    process.env.CARGO,
    ...splitPathList(process.env.PATH).map((entry) => path.join(entry, fileName)),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".cargo", "bin", fileName) : null,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Rust stable LLVM 1.96", "bin", fileName) : null,
  ]);
}

function childEnvironment(cargoExe) {
  const llvmBin = firstExisting([process.env.LLVM_MINGW_BIN, "C:\\Tools\\llvm-mingw-ucrt\\bin"]);
  const entries = [cargoExe ? path.dirname(cargoExe) : null, llvmBin, ...splitPathList(process.env.PATH)].filter(Boolean);
  return { ...process.env, PATH: [...new Set(entries)].join(path.delimiter), RUST_LOG: process.env.RUST_LOG?.trim() || "warn" };
}

function resolveBinary() {
  if (process.env.CODEX_RUST_BIN?.trim()) return path.resolve(projectRoot, process.env.CODEX_RUST_BIN.trim());
  // 显式构建记录 Cargo 实际输出，兼容 .cargo 配置、自定义 target 和 profile。
  if (existsSync(artifactRecord)) {
    const record = JSON.parse(readFileSync(artifactRecord, "utf8"));
    if (typeof record.executable !== "string" || !path.isAbsolute(record.executable)) {
      throw new Error(`Rust 构建记录无效：${artifactRecord}。请重新运行 node scripts/run-rust-tool.mjs --build。`);
    }
    return record.executable;
  }
  const targetDir = process.env.CARGO_TARGET_DIR ? path.resolve(projectRoot, process.env.CARGO_TARGET_DIR) : path.join(rustProjectRoot, "target");
  return path.join(targetDir, process.env.CARGO_BUILD_TARGET || "", "debug", binaryName + (process.platform === "win32" ? ".exe" : ""));
}

function launch() {
  const args = process.argv.slice(2);
  const building = args[0] === "--build";
  const cargoExe = resolveCargoExe();
  if (building && !cargoExe) throw new Error("找不到 Cargo。请安装 Rust 或设置 CARGO_EXE 后重新构建。");
  const executable = building ? cargoExe : resolveBinary();
  if (!building && !existsSync(executable)) {
    throw new Error(`找不到 Rust 程序：${executable}\n请先运行 node scripts/run-rust-tool.mjs --build，或通过 CODEX_RUST_BIN 指定已编译的程序。`);
  }
  const child = spawn(executable, building
    ? ["build", "--manifest-path", manifestPath, "--message-format=json-render-diagnostics", ...args.slice(1)]
    : args, {
    cwd: projectRoot,
    env: childEnvironment(cargoExe),
    stdio: building ? ["inherit", "pipe", "inherit"] : "inherit",
    windowsHide: true,
  });
  let executableFromBuild;
  let pending = "";
  function consumeLine(line) {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { process.stdout.write(`${line}\n`); return; }
    if (message.reason === "compiler-artifact" && message.target?.name === binaryName && message.target.kind?.includes("bin") && message.profile?.test !== true && message.executable) {
      executableFromBuild = message.executable;
    }
    if (message.reason === "compiler-message" && message.message?.rendered) process.stderr.write(message.message.rendered);
  }
  if (building) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) consumeLine(line);
    });
  }
  child.on("close", (code, signal) => {
    if (signal) { process.kill(process.pid, signal); return; }
    if (building && code === 0) {
      consumeLine(pending);
      if (!executableFromBuild || !existsSync(executableFromBuild)) {
        console.error("Cargo 未输出可运行程序，构建记录未更新。请构建默认二进制目标。");
        process.exitCode = 1;
        return;
      }
      mkdirSync(path.dirname(artifactRecord), { recursive: true });
      writeFileSync(artifactRecord, JSON.stringify({ executable: executableFromBuild }, null, 2) + "\n");
      console.log(`Rust 程序已构建：${executableFromBuild}`);
    }
    process.exitCode = code ?? 1;
  });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
}

try { launch(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = mkdtempSync(path.join(os.tmpdir(), "codex-rust-launcher-"));
try {
  const fixtureProject = path.join(fixture, "project");
  mkdirSync(path.join(fixtureProject, "scripts"), { recursive: true });
  const launcher = path.join(fixtureProject, "scripts", "run-rust-tool.mjs");
  copyFileSync(path.join(projectRoot, "scripts", "run-rust-tool.mjs"), launcher);
  // 如果回归成 cargo run，则 Node 会尝试加载不存在的 run 脚本并失败。
  const env = { ...process.env, CARGO_EXE: process.execPath, CODEX_RUST_BIN: process.execPath, CARGO_TARGET_DIR: "", CARGO_BUILD_TARGET: "" };
  const run = spawnSync(process.execPath, [launcher, "-e", "console.log('direct-binary:' + process.env.RUST_LOG)"], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /direct-binary:/);

  const missing = spawnSync(process.execPath, [launcher, "addon-host"], { env: { ...env, CODEX_RUST_BIN: path.join(fixture, "missing.exe") }, encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /找不到 Rust 程序/);
  assert.match(missing.stderr, /--build/);
  assert.doesNotMatch(missing.stderr, /Cannot find module/);

  // 用 Node 作为 Cargo 替身，验证显式构建与产物记录，无需真的启动编译器。
  writeFileSync(path.join(fixtureProject, "build"), `
    if (!process.argv.includes('--message-format=json-render-diagnostics')) process.exit(2);
    console.log(JSON.stringify({reason: 'compiler-artifact', target: {name: 'codex-for-wps-word-rust', kind: ['bin']}, profile: {test: false}, executable: process.execPath}));
  `);
  const built = spawnSync(process.execPath, [launcher, "--build"], { env: { ...env, CODEX_RUST_BIN: "" }, encoding: "utf8" });
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /Rust 程序已构建/);
  writeFileSync(path.join(fixtureProject, "build"), `
    console.log(JSON.stringify({reason: 'compiler-artifact', target: {name: 'codex-for-wps-word-rust', kind: ['bin']}, profile: {test: true}, executable: process.execPath}));
  `);
  const testsOnly = spawnSync(process.execPath, [launcher, "--build", "--tests"], { env, encoding: "utf8" });
  assert.equal(testsOnly.status, 1);
  assert.match(testsOnly.stderr, /Cargo 未输出可运行程序/);
  writeFileSync(path.join(fixtureProject, "build"), "process.exit(7);");
  const failed = spawnSync(process.execPath, [launcher, "--build"], { env, encoding: "utf8" });
  assert.equal(failed.status, 7);
  // 失败构建及测试 harness 都不能覆盖上次成功记录。
  const recorded = spawnSync(process.execPath, [launcher, "-e", "console.log('recorded-binary')"], { env: { ...env, CODEX_RUST_BIN: "" }, encoding: "utf8" });
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.match(recorded.stdout, /recorded-binary/);
  console.log("通过：直接运行程序、缺失产物报错、显式构建并使用 Cargo 构建记录。");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

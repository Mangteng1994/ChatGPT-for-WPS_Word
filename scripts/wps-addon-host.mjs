import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRootDir = path.resolve(__dirname, "..");
const addinRootDir = path.resolve(projectRootDir, "apps", "wps-local-addin");
const scriptPaths = {
  start: path.resolve(projectRootDir, "scripts", "start-local-services.ps1"),
  stop: path.resolve(projectRootDir, "scripts", "stop-local-services.ps1"),
  check: path.resolve(projectRootDir, "scripts", "check-local-services.ps1"),
};
const serviceLogDir = path.resolve(projectRootDir, "logs");
const host = "127.0.0.1";
const port = Number(process.env.WPS_ADDON_PORT || 3889);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
};

function safePathFromUrl(urlPath) {
  const pathname = decodeURIComponent((urlPath || "/").split("?")[0]).replace(/^\/+/, "");
  const normalized = path.normalize(pathname || "index.html");
  const resolved = path.resolve(addinRootDir, normalized);
  if (!resolved.startsWith(addinRootDir)) return null;
  return resolved;
}

function resolveFilePath(urlPath) {
  const primary = safePathFromUrl(urlPath);
  if (!primary) return null;
  if (existsSync(primary) && statSync(primary).isFile()) return primary;
  const fallback = path.resolve(addinRootDir, "index.html");
  return existsSync(fallback) ? fallback : null;
}

function writeJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.end(JSON.stringify(payload));
}

function runPowerShellScript(action, callback) {
  const scriptPath = scriptPaths[action];
  if (!scriptPath || !existsSync(scriptPath)) {
    callback(new Error(`Script not found for action: ${action}`), "");
    return;
  }

  execFile(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    {
      cwd: projectRootDir,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
    (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim();
      callback(error, output);
    }
  );
}

const server = createServer((req, res) => {
  try {
    const requestUrl = new URL(req.url || "/", `http://${host}:${port}`);
    if (requestUrl.pathname.startsWith("/__codex/service/")) {
      if ((req.method || "").toUpperCase() !== "POST") {
        writeJson(res, 405, { ok: false, error: "Method Not Allowed" });
        return;
      }

      const action = requestUrl.pathname.replace("/__codex/service/", "").trim();
      runPowerShellScript(action, (error, output) => {
        if (error) {
          writeJson(res, 500, {
            ok: false,
            action,
            logDir: serviceLogDir,
            output,
            error: error.message || String(error),
          });
          return;
        }

        writeJson(res, 200, {
          ok: true,
          action,
          logDir: serviceLogDir,
          output,
        });
      });
      return;
    }

    const filePath = resolveFilePath(req.url || "/");
    if (!filePath) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const fileData = readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.end(fileData);
  } catch (error) {
    res.statusCode = 500;
    res.end((error && error.message) || "Internal Server Error");
  }
});

server.listen(port, host, () => {
  console.log(`wps-addon-host listening on http://${host}:${port} (root=${addinRootDir})`);
});

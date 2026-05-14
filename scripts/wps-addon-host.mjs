import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "apps", "wps-local-addin");
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
  const resolved = path.resolve(rootDir, normalized);
  if (!resolved.startsWith(rootDir)) return null;
  return resolved;
}

function resolveFilePath(urlPath) {
  const primary = safePathFromUrl(urlPath);
  if (!primary) return null;
  if (existsSync(primary) && statSync(primary).isFile()) return primary;
  const fallback = path.resolve(rootDir, "index.html");
  return existsSync(fallback) ? fallback : null;
}

const server = createServer((req, res) => {
  try {
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
  console.log(`wps-addon-host listening on http://${host}:${port} (root=${rootDir})`);
});

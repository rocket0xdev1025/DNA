import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://genomedna.xyz";
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

function localFile(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.includes("..") || rel.startsWith("/_local")) return null;
  rel = rel.replace(/^\/+/, "");
  if (!rel) rel = "index.html";
  else if (!path.extname(rel)) rel = path.join(rel, "index.html");
  const full = path.resolve(ROOT, rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function forwardHeaders(req) {
  const headers = { "user-agent": req.headers["user-agent"] || "local-mirror" };
  for (const key of [
    "rsc",
    "next-url",
    "next-router-prefetch",
    "next-router-segment-prefetch",
    "next-router-state-tree",
    "accept",
  ]) {
    const value = req.headers[key];
    if (value) headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

async function proxy(req, res) {
  const upstream = await fetch(ORIGIN + req.url, {
    method: req.method,
    headers: forwardHeaders(req),
    redirect: "manual",
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  const headers = { "cache-control": "no-store" };
  const type = upstream.headers.get("content-type");
  if (type) headers["content-type"] = type;
  const location = upstream.headers.get("location");
  if (location) {
    headers.location = location.startsWith(ORIGIN) ? location.slice(ORIGIN.length) : location;
  }
  res.writeHead(upstream.status, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    const live =
      url.pathname.startsWith("/api") ||
      req.headers.rsc === "1" ||
      url.searchParams.has("_rsc");
    if (live) {
      await proxy(req, res);
      return;
    }
    const file = localFile(url.pathname);
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        "content-type": TYPES[ext] || "application/octet-stream",
        "cache-control": ext === ".html" ? "no-store" : "public, max-age=86400",
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    await proxy(req, res);
  } catch (err) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(err instanceof Error ? err.message : String(err));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`http://127.0.0.1:${PORT}`);
});

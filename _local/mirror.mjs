import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://genomedna.xyz";

const seeds = [
  "/",
  "/live",
  "/announcements",
  "/play",
  "/trade",
  "/how-it-works",
  "/sequencer",
  "/docs",
  "/proposals",
  "/bounties",
  "/lab",
  "/mind",
  "/memory",
  "/modules",
  "/evolution",
  "/autonomy",
  "/treasury",
  "/constitution",
  "/journal",
  "/security",
  "/xp",
  "/proof",
  "/models",
  "/rules",
  "/token.png",
  "/icon.png",
  "/apple-icon.png",
  "/favicon.ico",
];

const seen = new Set();
const queue = [];
const saved = [];
const failed = [];

function enqueue(urlPath) {
  if (!urlPath || typeof urlPath !== "string") return;
  const clean = urlPath.split("#")[0].split("?")[0];
  if (!clean.startsWith("/") || clean.startsWith("//")) return;
  if (clean.includes("..") || clean.length > 300) return;
  if (clean.startsWith("/_local")) return;
  if (seen.has(clean)) return;
  seen.add(clean);
  queue.push(clean);
}

function isPage(urlPath) {
  const base = path.posix.basename(urlPath);
  return !base.includes(".") && !urlPath.startsWith("/_next") && !urlPath.startsWith("/api");
}

function destFor(urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (isPage(rel)) rel = rel === "/" ? "/index.html" : `${rel}/index.html`;
  return path.join(ROOT, rel);
}

function extract(text, pagePath) {
  const assets = new Set();
  for (const m of text.matchAll(/\/_next\/static\/[A-Za-z0-9._~/-]+/g)) assets.add(m[0]);
  for (const m of text.matchAll(/static\/(?:chunks|media|css)\/[A-Za-z0-9._~/-]+/g)) {
    assets.add("/_next/" + m[0]);
  }
  for (const m of text.matchAll(
    /\/[A-Za-z0-9][A-Za-z0-9._~/-]*\.(?:png|jpe?g|webp|gif|svg|ico|woff2|woff|webmanifest)/g
  )) {
    assets.add(m[0]);
  }
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const ref = m[1];
    if (ref.startsWith("data:") || ref.startsWith("http")) continue;
    if (ref.startsWith("/")) assets.add(ref.split("?")[0].split("#")[0]);
    else {
      const base = pagePath.substring(0, pagePath.lastIndexOf("/") + 1);
      try {
        assets.add(new URL(ref, ORIGIN + base).pathname);
      } catch {
        /* ignore bad relative urls */
      }
    }
  }
  const pages = new Set();
  for (const m of text.matchAll(/href(?:=|:)"(\/[a-zA-Z0-9][^"'?#\s]*)"/g)) {
    const p = m[1];
    if (!p.startsWith("/_next") && !p.startsWith("/api") && !path.posix.basename(p).includes(".")) {
      pages.add(p);
    }
  }
  return { assets, pages };
}

async function fetchPath(urlPath, headers = {}) {
  const res = await fetch(ORIGIN + urlPath, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; local-mirror/1.0)",
      accept: "*/*",
      ...headers,
    },
    redirect: "follow",
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get("content-type") || "", buf };
}

async function saveFile(file, buf) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, buf);
}

for (const s of seeds) enqueue(s);

while (queue.length) {
  const batch = queue.splice(0, 4);
  await Promise.all(
    batch.map(async (urlPath) => {
      try {
        const { status, type, buf } = await fetchPath(urlPath);
        if (status !== 200) {
          failed.push(`${status} ${urlPath}`);
          return;
        }
        const file = destFor(urlPath);
        await saveFile(file, buf);
        saved.push(urlPath);
        const textual =
          type.includes("text") ||
          type.includes("javascript") ||
          type.includes("json") ||
          urlPath.endsWith(".js") ||
          urlPath.endsWith(".css") ||
          isPage(urlPath);
        if (textual) {
          const text = buf.toString("utf8");
          const { assets, pages } = extract(text, urlPath);
          for (const a of assets) enqueue(a);
          for (const p of pages) enqueue(p);
        }
        if (isPage(urlPath)) {
          const rsc = await fetchPath(urlPath, { RSC: "1", "Next-Url": "/" });
          if (rsc.status === 200 && rsc.type.includes("text/x-component")) {
            const rscFile = destFor(urlPath).replace(/index\.html$/, "index.rsc");
            await saveFile(rscFile, rsc.buf);
            const { assets, pages } = extract(rsc.buf.toString("utf8"), urlPath);
            for (const a of assets) enqueue(a);
            for (const p of pages) enqueue(p);
          }
        }
        process.stdout.write(`ok ${urlPath}\n`);
      } catch (err) {
        failed.push(`ERR ${urlPath} ${err.message}`);
        process.stdout.write(`fail ${urlPath} ${err.message}\n`);
      }
    })
  );
}

const manifest = { origin: ORIGIN, saved, failed, at: new Date().toISOString() };
await fs.promises.mkdir(path.join(ROOT, "_local"), { recursive: true });
await fs.promises.writeFile(path.join(ROOT, "_local", "manifest.json"), JSON.stringify(manifest, null, 2));
process.stdout.write(`\nSaved ${saved.length}, failed ${failed.length}\n`);
if (failed.length) process.stdout.write(failed.join("\n") + "\n");

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import handler from "./dist/server/server.js";

const port = Number(process.env.PORT || 4173);
const clientDir = join(process.cwd(), "dist", "client");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function assetPath(pathname) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^\.\.(\/|\\|$)/, "");
  const filePath = join(clientDir, safePath);
  if (!filePath.startsWith(clientDir) || !existsSync(filePath) || !statSync(filePath).isFile()) return null;
  return filePath;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const filePath = assetPath(url.pathname);

    if (filePath) {
      res.setHeader("Content-Type", contentTypes[extname(filePath)] || "application/octet-stream");
      createReadStream(filePath).pipe(res);
      return;
    }

    const body = ["GET", "HEAD"].includes(req.method || "GET") ? undefined : req;
    const request = new Request(url, { method: req.method, headers: req.headers, body, duplex: "half" });
    const response = await handler.fetch(request);

    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
    }

    res.end();
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Server listening on port ${port}`);
});
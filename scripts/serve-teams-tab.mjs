import http from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const port = Number.parseInt(process.env.TAB_PORT ?? "53000", 10);
const root = path.resolve("apps/teams-tab");

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"]
]);

const server = http.createServer(async (request, response) => {
  const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
  const resolvedPath = requestPath === "/"
    ? path.join(root, "index.html")
    : path.join(root, requestPath);

  if (!resolvedPath.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  if (!existsSync(resolvedPath)) {
    response.writeHead(404).end("Not found");
    return;
  }

  const fileStat = await stat(resolvedPath);
  if (fileStat.isDirectory()) {
    response.writeHead(403).end("Directory listing disabled");
    return;
  }

  const extension = path.extname(resolvedPath);
  response.writeHead(200, {
    "content-type": contentTypes.get(extension) ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(resolvedPath).pipe(response);
});

server.listen(port, () => {
  console.log(`teams-tab host listening on http://localhost:${port}`);
});

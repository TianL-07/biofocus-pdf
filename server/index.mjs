import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { translateYoudao, validateConfig } from "./youdao.mjs";
import { askModel, listModels, validateModelConfig } from "./model.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.argv.includes("--production"),
  port = Number(process.env.PORT || 5173);
let credentials =
  process.env.YOUDAO_APP_KEY && process.env.YOUDAO_APP_SECRET
    ? validateConfig({
        appKey: process.env.YOUDAO_APP_KEY,
        appSecret: process.env.YOUDAO_APP_SECRET,
        domain: process.env.YOUDAO_DOMAIN || "medicine",
        vocabId: process.env.YOUDAO_VOCAB_ID,
      })
    : null;
let inflight = 0;
let modelCredentials =
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
    ? validateModelConfig({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
      })
    : null;
let modelActive = false;
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({ root, server: { middlewareMode: true }, appType: "spa" });
const mime = {
  ".html": "text/html;charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};
const send = (res, status, data) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      // Do not permit a remote website to configure or consume this loopback service.
      const host = req.headers.host || "";
      if (!/^((127\.0\.0\.1|localhost)(:\d+)?)$/.test(host)) {
        send(res, 403, { error: "只允许本机访问。" });
        return;
      }
      const origin = req.headers.origin;
      if (origin && !["http://" + host].includes(origin)) {
        send(res, 403, { error: "来源验证失败。" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/youdao/status") {
        send(res, 200, {
          configured: !!credentials,
          verifiedAt: credentials?.verifiedAt,
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/model/status") {
        send(res, 200, {
          configured: !!modelCredentials,
          model: modelCredentials?.model,
          verifiedAt: modelCredentials?.verifiedAt,
        });
        return;
      }
      if (
        req.method !== "POST" ||
        !String(req.headers["content-type"]).startsWith("application/json")
      ) {
        send(res, 405, { error: "请求格式不正确。" });
        return;
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 160000) {
          send(res, 413, { error: "请求过大。" });
          return;
        }
      }
      const input = JSON.parse(body);
      if (url.pathname === "/api/model/config") {
        if (production) {
          send(res, 403, { error: "部署版请通过服务器环境变量配置凭据。" });
          return;
        }
        modelCredentials = input.clear
          ? null
          : validateModelConfig(input, modelCredentials);
        send(res, 200, {
          configured: !!modelCredentials,
          model: modelCredentials?.model,
        });
        return;
      }
      if (url.pathname === "/api/model/models") {
        send(
          res,
          200,
          await listModels(input.apiKey?.trim() || modelCredentials?.apiKey),
        );
        return;
      }
      if (
        url.pathname === "/api/model/chat" ||
        url.pathname === "/api/model/test"
      ) {
        if (modelActive) {
          send(res, 429, { error: "模型正在回答，请等待当前请求完成。" });
          return;
        }
        modelActive = true;
        try {
          const config = modelCredentials,
            test = url.pathname.endsWith("/test");
          const answer = await askModel(
            test
              ? {
                  messages: [{ role: "user", content: "Reply with OK only." }],
                  test: true,
                }
              : input,
            config,
          );
          if (test && modelCredentials === config)
            config.verifiedAt = new Date().toISOString();
          send(res, 200, {
            ...answer,
            verifiedAt: test ? config.verifiedAt : undefined,
          });
        } finally {
          modelActive = false;
        }
        return;
      }
      if (url.pathname === "/api/youdao/config") {
        if (production) {
          send(res, 403, { error: "部署版请通过服务器环境变量配置凭据。" });
          return;
        }
        credentials = input.clear ? null : validateConfig(input);
        send(res, 200, { configured: !!credentials });
        return;
      }
      if (url.pathname === "/api/youdao/translate") {
        if (inflight >= 2) {
          send(res, 429, { error: "已有翻译正在进行，请稍后重试。" });
          return;
        }
        inflight++;
        try {
          send(res, 200, await translateYoudao(input.q, credentials));
        } finally {
          inflight--;
        }
        return;
      }
      if (url.pathname === "/api/youdao/test") {
        const result = await translateYoudao("cell", credentials);
        credentials.verifiedAt = new Date().toISOString();
        send(res, 200, {
          translation: result.translation,
          verifiedAt: credentials.verifiedAt,
        });
        return;
      }
      send(res, 404, { error: "接口不存在。" });
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const dist = path.join(root, "dist"),
      target = path.resolve(
        dist,
        "." +
          decodeURIComponent(
            url.pathname === "/" ? "/index.html" : url.pathname,
          ),
      );
    if (!target.startsWith(dist + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const data = await fs.readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] || "application/octet-stream",
    });
    res.end(data);
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : "请求失败" });
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`BioFocus ready at http://127.0.0.1:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    void vite?.close().finally(() => process.exit(0));
    if (!vite) process.exit(0);
  });

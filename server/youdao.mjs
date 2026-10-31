import { createHash, randomUUID } from "node:crypto";
export function signInput(q) {
  const chars = Array.from(q);
  return chars.length <= 20
    ? q
    : chars.slice(0, 10).join("") + chars.length + chars.slice(-10).join("");
}
export function validateConfig(c) {
  if (
    !c ||
    typeof c.appKey !== "string" ||
    typeof c.appSecret !== "string" ||
    !c.appKey.trim() ||
    !c.appSecret.trim() ||
    c.appKey.length > 300 ||
    c.appSecret.length > 500
  )
    throw new Error("请填写有效的有道应用 ID 和应用密钥。");
  if (c.domain && !["medicine", "general"].includes(c.domain))
    throw new Error("翻译领域无效");
  return {
    appKey: c.appKey.trim(),
    appSecret: c.appSecret.trim(),
    domain: c.domain || "medicine",
    vocabId: typeof c.vocabId === "string" ? c.vocabId.slice(0, 200) : "",
  };
}
export function makeParams(
  q,
  config,
  { salt = randomUUID(), curtime = String(Math.floor(Date.now() / 1000)) } = {},
) {
  const sign = createHash("sha256")
    .update(
      config.appKey + signInput(q) + salt + curtime + config.appSecret,
      "utf8",
    )
    .digest("hex");
  const body = new URLSearchParams({
    q,
    from: "auto",
    to: "zh-CHS",
    appKey: config.appKey,
    salt,
    signType: "v3",
    curtime,
    sign,
  });
  if (config.domain === "medicine") {
    body.set("domain", "medicine");
    body.set("rejectFallback", "true");
  }
  if (config.vocabId) body.set("vocabId", config.vocabId);
  return body;
}
const codes = {
  101: "缺少必要参数。",
  102: "有道暂不支持这一语种。",
  103: "文本过长，请缩短选中的内容。",
  108: "应用 ID 无效，请检查配置。",
  202: "签名验证失败，请检查应用密钥与电脑时间。",
  206: "当前账号或应用未开通对应服务。",
  401: "有道账户余额不足或已达到限额。",
  411: "请求过于频繁，请稍后手动重试。",
};
export async function translateYoudao(q, config, fetcher = fetch) {
  if (typeof q !== "string" || !q.trim() || Array.from(q).length > 5000)
    throw new Error("请选择 1–5000 个字符进行翻译。");
  if (!config)
    throw new Error("尚未配置有道 API，请在设置中填写应用 ID 和密钥。");
  const response = await fetcher("https://openapi.youdao.com/api", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: makeParams(q.trim(), config),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      `有道服务暂不可用（HTTP ${response.status}），请稍后手动重试。`,
    );
  const data = await response.json();
  if (String(data.errorCode) !== "0")
    throw new Error(
      `有道错误 ${String(data.errorCode)}：${codes[String(data.errorCode)] || "请核对账户权限、领域服务和接口配置。"}`,
    );
  if (!Array.isArray(data.translation) || !data.translation.length)
    throw new Error("有道未返回译文。");
  return {
    translation: data.translation.join("\n"),
    explains: Array.isArray(data.basic?.explains) ? data.basic.explains : [],
    provider:
      config.domain === "medicine" ? "有道智云 · 医学领域" : "有道智云 · 通用",
  };
}

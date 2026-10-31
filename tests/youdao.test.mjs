import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  signInput,
  makeParams,
  translateYoudao,
  validateConfig,
} from "../server/youdao.mjs";
const config = {
  appKey: "test-app",
  appSecret: "test-secret",
  domain: "medicine",
  vocabId: "bio-terms",
};
test("v3 signature uses full text for short queries and truncation for long queries", () => {
  assert.equal(signInput("transcriptome"), "transcriptome");
  assert.equal(
    signInput("abcdefghijklmnopqrstuvwxyz"),
    "abcdefghij26qrstuvwxyz",
  );
  assert.equal(
    signInput("😀".repeat(21)),
    "😀".repeat(10) + "21" + "😀".repeat(10),
  );
  const body = makeParams("transcriptome", config, {
    salt: "salt",
    curtime: "123",
  });
  assert.equal(
    body.get("sign"),
    createHash("sha256")
      .update("test-apptranscriptomesalt123test-secret")
      .digest("hex"),
  );
  assert.equal(body.get("domain"), "medicine");
  assert.equal(body.get("rejectFallback"), "true");
  assert.equal(body.get("vocabId"), "bio-terms");
  assert.equal(body.get("appSecret"), null);
});
test("translation normalizes a genuine provider response", async () => {
  const fetcher = async (url, options) => {
    assert.equal(url, "https://openapi.youdao.com/api");
    assert.equal(options.method, "POST");
    assert.equal(options.body.get("q"), "transcriptome");
    return {
      ok: true,
      json: async () => ({
        errorCode: "0",
        translation: ["转录组"],
        basic: { explains: ["n. 转录组"] },
      }),
    };
  };
  const result = await translateYoudao("transcriptome", config, fetcher);
  assert.equal(result.translation, "转录组");
  assert.match(result.provider, /医学/);
});
test("missing credentials never send any network request", async () => {
  let called = false;
  await assert.rejects(
    translateYoudao("cell", null, () => {
      called = true;
    }),
    /尚未配置/,
  );
  assert.equal(called, false);
});
test("provider errors are surfaced without automatic retries", async () => {
  let calls = 0;
  await assert.rejects(
    translateYoudao("cell", config, async () => {
      calls++;
      return { ok: true, json: async () => ({ errorCode: "202" }) };
    }),
    /签名验证失败/,
  );
  assert.equal(calls, 1);
});
test("domain configuration is constrained to documented values", () => {
  assert.throws(
    () => validateConfig({ ...config, domain: "invented" }),
    /领域无效/,
  );
  assert.equal(validateConfig(config).domain, "medicine");
});

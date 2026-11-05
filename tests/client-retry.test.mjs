import test from "node:test";
import assert from "node:assert/strict";
test("uncertain payment retries keep command identity through a page reload", async () => {
  const originalFetch = globalThis.fetch,
    originalStorage = globalThis.sessionStorage;
  const memory = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => memory.get(k) || null,
    setItem: (k, v) => memory.set(k, v),
  };
  const keys = [];
  let fail = true;
  globalThis.fetch = async (url, options) => {
    keys.push(options.headers["Idempotency-Key"]);
    if (fail) throw new Error("lost response");
    return { ok: true, status: 200, json: async () => ({ id: "payment" }) };
  };
  try {
    const first = await import("../web/src/api.js?retry-test-first");
    first.setCsrf("session");
    const options = {
      method: "POST",
      body: { amount_cents: 10000, order_id: "order" },
    };
    await assert.rejects(first.api("/payments", options), /Нет связи/);
    const reloaded = await import("../web/src/api.js?retry-test-reload");
    reloaded.setCsrf("session");
    fail = false;
    await reloaded.api("/payments", options);
    assert.equal(keys[0], keys[1]);
    await reloaded.api("/payments", options);
    assert.notEqual(keys[1], keys[2], "new confirmed action receives new key");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = originalStorage;
  }
});

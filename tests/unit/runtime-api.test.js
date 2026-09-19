import assert from "node:assert/strict";
import test from "node:test";
import { appFetch } from "../../src/runtime-api.js";

test("appFetch converts Electron IPC replies into a Response", async () => {
  const previous = globalThis.webRevisionDesktop;
  globalThis.webRevisionDesktop = {
    request: async (request) => {
      assert.equal(request.url, "/api/example");
      assert.equal(JSON.parse(Buffer.from(request.bodyBase64, "base64").toString("utf8")).hello, "world");
      return {
        status: 201,
        headers: { "Content-Type": "application/json", "X-Test": "yes" },
        bodyBase64: Buffer.from(JSON.stringify({ ok: true })).toString("base64"),
      };
    },
  };
  try {
    const response = await appFetch("/api/example", { method: "POST", body: JSON.stringify({ hello: "world" }) });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-test"), "yes");
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    globalThis.webRevisionDesktop = previous;
  }
});


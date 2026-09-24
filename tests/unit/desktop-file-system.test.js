import test from "node:test";
import assert from "node:assert/strict";
import { chooseDesktopOutput, writeDesktopOutput } from "../../src/desktop-file-system.js";

test("desktop output is selected before bytes are sent to its one-time token", async () => {
  const calls = [];
  globalThis.webRevisionDesktop = {
    fileSystem: {
      chooseOutput: async (options) => {
        calls.push({ operation: "choose", options });
        return { ok: true, value: { token: "one-time-save-token" } };
      },
      writeOutput: async (payload) => {
        calls.push({ operation: "write", payload });
        return { ok: true, value: { path: "/chosen/package.zip" } };
      },
    },
  };

  const target = await chooseDesktopOutput({ suggestedName: "package.zip", filters: [{ name: "ZIP", extensions: ["zip"] }] });
  assert.deepEqual(calls.map((call) => call.operation), ["choose"]);
  const saved = await writeDesktopOutput(target.token, new Blob(["zip bytes"]));
  assert.deepEqual(calls.map((call) => call.operation), ["choose", "write"]);
  assert.equal(calls[1].payload.token, "one-time-save-token");
  assert.equal(Buffer.from(calls[1].payload.contentBase64, "base64").toString(), "zip bytes");
  assert.equal(saved.path, "/chosen/package.zip");
  delete globalThis.webRevisionDesktop;
});

test("desktop save dialog cancellation returns no target for callers to stop early", async () => {
  globalThis.webRevisionDesktop = { fileSystem: { chooseOutput: async () => ({ ok: true, value: null }) } };
  assert.equal(await chooseDesktopOutput({ suggestedName: "package.zip" }), null);
  delete globalThis.webRevisionDesktop;
});

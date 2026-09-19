import test from "node:test";
import assert from "node:assert/strict";

import { BrowserTaskQueue } from "../../src/browser-task-queue.js";

test("interactive browser tasks run before queued normal tasks", async () => {
  const queue = new BrowserTaskQueue();
  const order = [];
  let releaseFirst;
  const first = queue.enqueue(async () => {
    order.push("normal-1-start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    order.push("normal-1-end");
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = queue.enqueue(async () => { order.push("normal-2"); });
  const interactive = queue.enqueue(async () => { order.push("interactive"); }, { priority: "interactive" });

  releaseFirst();
  await Promise.all([first, second, interactive]);
  assert.deepEqual(order, ["normal-1-start", "normal-1-end", "interactive", "normal-2"]);
});

test("a failed browser task does not stop the queue", async () => {
  const queue = new BrowserTaskQueue();
  const failed = queue.enqueue(async () => { throw new Error("fixture failure"); });
  const next = queue.enqueue(async () => "continued");
  await assert.rejects(failed, /fixture failure/);
  assert.equal(await next, "continued");
});

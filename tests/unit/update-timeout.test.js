import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_UPDATE_DOWNLOAD_TIMEOUT_SECONDS,
  MAX_UPDATE_DOWNLOAD_TIMEOUT_SECONDS,
  MIN_UPDATE_DOWNLOAD_TIMEOUT_SECONDS,
  normalizeUpdateDownloadTimeoutSeconds,
} from "../../src/update-timeout.js";

test("update download timeout defaults to two minutes and accepts numeric settings", () => {
  assert.equal(DEFAULT_UPDATE_DOWNLOAD_TIMEOUT_SECONDS, 120);
  assert.equal(normalizeUpdateDownloadTimeoutSeconds(undefined), 120);
  assert.equal(normalizeUpdateDownloadTimeoutSeconds("300"), 300);
  assert.equal(normalizeUpdateDownloadTimeoutSeconds("invalid"), 120);
});

test("update download timeout stays within the supported range", () => {
  assert.equal(normalizeUpdateDownloadTimeoutSeconds(1), MIN_UPDATE_DOWNLOAD_TIMEOUT_SECONDS);
  assert.equal(normalizeUpdateDownloadTimeoutSeconds(9999), MAX_UPDATE_DOWNLOAD_TIMEOUT_SECONDS);
  assert.equal(normalizeUpdateDownloadTimeoutSeconds(300.4), 300);
});

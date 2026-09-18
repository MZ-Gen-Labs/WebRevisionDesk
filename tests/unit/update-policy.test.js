import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldCheckForUpdatesOnStartup,
  STARTUP_UPDATE_CHECK_INTERVAL_MS,
} from "../../src/update-policy.js";

test("startup update checks are skipped until the interval has elapsed", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");
  const settings = {
    githubRepository: "https://github.com/MZ-Gen-Labs/WebRevisionDesk",
    checkUpdatesOnStartup: true,
    lastCheckAttemptAt: new Date(now - 5 * 60 * 1000).toISOString(),
  };
  assert.equal(shouldCheckForUpdatesOnStartup(settings, now), false);
  settings.lastCheckAttemptAt = new Date(now - STARTUP_UPDATE_CHECK_INTERVAL_MS).toISOString();
  assert.equal(shouldCheckForUpdatesOnStartup(settings, now), true);
});

test("startup update checks honor disabled and never-checked settings", () => {
  const repository = "https://github.com/MZ-Gen-Labs/WebRevisionDesk";
  assert.equal(shouldCheckForUpdatesOnStartup({ githubRepository: repository, checkUpdatesOnStartup: false }), false);
  assert.equal(shouldCheckForUpdatesOnStartup({ githubRepository: repository, checkUpdatesOnStartup: true }), true);
  assert.equal(shouldCheckForUpdatesOnStartup({ checkUpdatesOnStartup: true }), false);
});

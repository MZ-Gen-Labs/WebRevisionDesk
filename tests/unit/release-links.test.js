import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedReleaseUrl, LATEST_RELEASE_URL } from "../../src/release-links.js";

test("only the canonical latest Web Revision Desk release URL is allowed externally", () => {
  assert.equal(isAllowedReleaseUrl(LATEST_RELEASE_URL), true);
  assert.equal(isAllowedReleaseUrl("https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/tag/v0.7.11"), false);
  assert.equal(isAllowedReleaseUrl("https://github.com.evil.example/MZ-Gen-Labs/WebRevisionDesk/releases/latest"), false);
  assert.equal(isAllowedReleaseUrl("file:///etc/passwd"), false);
});

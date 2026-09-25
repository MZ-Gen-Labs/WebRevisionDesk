import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedReleaseUrl, LATEST_RELEASE_URL } from "../../src/release-links.js";

test("allows canonical latest release URL and official release asset download URLs", () => {
  assert.equal(isAllowedReleaseUrl(LATEST_RELEASE_URL), true);
  assert.equal(isAllowedReleaseUrl("https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v0.7.29/WebRevisionDesk-0.7.29-Setup.exe"), true);
  assert.equal(isAllowedReleaseUrl("https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v0.7.29/WebRevisionDesk-0.7.29-Patch-from-0.7.10%2B-Setup.exe"), true);
  assert.equal(isAllowedReleaseUrl("https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v0.7.29/WebRevisionDesk-0.7.29-Patch-from-0.7.10+-Setup.exe"), true);
  assert.equal(isAllowedReleaseUrl("https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v0.7.29/WebRevisionDesk-0.7.29-mac-arm64.dmg"), true);
  assert.equal(isAllowedReleaseUrl("https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v0.7.29/WebRevisionDesk-0.7.29-electron-win-x64.zip"), true);

  // 不正・許可されていないURLは拒絶すること
  assert.equal(isAllowedReleaseUrl("https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/tag/v0.7.29"), false);
  assert.equal(isAllowedReleaseUrl("https://github.com/OtherOrg/WebRevisionDesk/releases/download/v0.7.29/Setup.exe"), false);
  assert.equal(isAllowedReleaseUrl("https://github.com.evil.example/MZ-Gen-Labs/WebRevisionDesk/releases/latest"), false);
  assert.equal(isAllowedReleaseUrl("file:///etc/passwd"), false);
  assert.equal(isAllowedReleaseUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedReleaseUrl(null), false);
  assert.equal(isAllowedReleaseUrl(""), false);
});

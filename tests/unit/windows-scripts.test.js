import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const file of ["windows/launcher.ps1", "windows/updater.ps1"]) {
  test(`${file} remains ASCII-safe for Windows PowerShell 5.1`, async () => {
    const content = await readFile(new URL(`../../${file}`, import.meta.url));
    assert.equal(content.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)), true);
  });
}

test("launcher resolves PSScriptRoot after parameter binding", async () => {
  const content = await readFile(new URL("../../windows/launcher.ps1", import.meta.url), "utf8");
  assert.match(content, /if \(\[string\]::IsNullOrWhiteSpace\(\$InstallRoot\)\) \{ \$InstallRoot = \$PSScriptRoot \}/);
  assert.doesNotMatch(content, /\$InstallRoot\s*=\s*\$PSScriptRoot,/);
});

test("launcher verifies ownership before controlling the port listener", async () => {
  const content = await readFile(new URL("../../windows/launcher.ps1", import.meta.url), "utf8");
  assert.match(content, /Get-NetTCPConnection -LocalAddress "127\.0\.0\.1" -LocalPort 5173/);
  assert.match(content, /Get-CimInstance Win32_Process/);
  assert.match(content, /StartsWith\(\$VersionsPrefix, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(content, /EndsWith\(\$ExpectedSuffix, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(content, /Restart Web Revision Desk\? \(Y\/N\)/);
  assert.match(content, /Stop Web Revision Desk\? \(Y\/N\)/);
});

test("updater hashes archives without relying on an auto-loaded Get-FileHash command", async () => {
  const content = await readFile(new URL("../../windows/updater.ps1", import.meta.url), "utf8");
  assert.match(content, /\[Security\.Cryptography\.SHA256\]::Create\(\)/);
  assert.match(content, /\.ComputeHash\(\$ZipStream\)/);
  assert.doesNotMatch(content, /Get-FileHash/);
});

for (const file of ["windows/Start-WebRevisionDesk.cmd", "windows/Start-WebRevisionEditor.cmd"]) {
  test(`${file} lets launcher.ps1 resolve its own installation directory`, async () => {
    const content = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.match(content, /-File "%~dp0launcher\.ps1"/);
    assert.doesNotMatch(content, /-InstallRoot/);
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

for (const file of ["windows/launcher.ps1", "windows/updater.ps1"]) {
  test(`${file} remains ASCII-safe for Windows PowerShell 5.1`, async () => {
    const content = await readFile(new URL(`../../${file}`, import.meta.url));
    assert.equal(content.every((byte) => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)), true);
  });
}

for (const file of ["windows/Start-WebRevisionDesk.cmd", "windows/Start-WebRevisionEditor.cmd"]) {
  test(`${file} lets launcher.ps1 resolve its own installation directory`, async () => {
    const content = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    assert.match(content, /-File "%~dp0launcher\.ps1"/);
    assert.doesNotMatch(content, /-InstallRoot/);
  });
}

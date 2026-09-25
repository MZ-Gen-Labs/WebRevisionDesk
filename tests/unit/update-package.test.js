import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersionNumbers,
  extractPatchMinimumVersion,
  selectMacUpdatePackage,
  selectPlatformInstallerAsset,
  selectWindowsUpdatePackage,
} from "../../src/update-package.js";

const version = "0.8.0";
const electronVersion = "44.4.3";
const fullName = `WebRevisionDesk-${version}-electron-win-x64.zip`;
const macArm64Name = `WebRevisionDesk-${version}-mac-arm64.zip`;
const macX64Name = `WebRevisionDesk-${version}-mac-x64.zip`;
const patchName = `WebRevisionDesk-${version}-patch.zip`;
const fullSha = "a".repeat(64);
const macArm64Sha = "c".repeat(64);
const macX64Sha = "d".repeat(64);
const patchSha = "b".repeat(64);
const assets = [
  { name: fullName, size: 80_000_000, browser_download_url: `https://example.test/${fullName}` },
  { name: macArm64Name, size: 90_000_000, browser_download_url: `https://example.test/${macArm64Name}` },
  { name: macX64Name, size: 92_000_000, browser_download_url: `https://example.test/${macX64Name}` },
  { name: patchName, size: 2_000_000, browser_download_url: `https://example.test/${patchName}` },
];
const metadata = {
  version,
  electronVersion,
  assets: {
    full: { name: fullName, sha256: fullSha, size: 80_000_000 },
    patch: { name: patchName, sha256: patchSha, size: 2_000_000, targetElectronVersion: electronVersion },
  },
};
const checksums = `${fullSha}  ${fullName}\n${macArm64Sha}  ${macArm64Name}\n${macX64Sha}  ${macX64Name}\n${patchSha}  ${patchName}\n`;

test("selects the app-only patch when metadata, checksum, and Electron version match", () => {
  const selected = selectWindowsUpdatePackage({ version, assets, metadata, electronVersion, checksums });
  assert.equal(selected.packageType, "patch");
  assert.equal(selected.asset.name, patchName);
  assert.equal(selected.expectedSha256, patchSha);
});

test("falls back to the full ZIP when Electron changes", () => {
  const selected = selectWindowsUpdatePackage({ version, assets, metadata, electronVersion: "45.0.0", checksums });
  assert.equal(selected.packageType, "full");
  assert.equal(selected.asset.name, fullName);
  assert.equal(selected.expectedSha256, fullSha);
});

test("falls back to the full ZIP when patch metadata or its checksum is missing", () => {
  const noPatch = selectWindowsUpdatePackage({ version, assets: assets.slice(0, 1), metadata, electronVersion, checksums });
  const noChecksum = selectWindowsUpdatePackage({ version, assets, metadata, electronVersion, checksums: `${fullSha}  ${fullName}\n` });
  const wrongTarget = selectWindowsUpdatePackage({
    version,
    assets,
    metadata: { ...metadata, assets: { ...metadata.assets, patch: { ...metadata.assets.patch, targetElectronVersion: "45.0.0" } } },
    electronVersion,
    checksums,
  });
  for (const selected of [noPatch, noChecksum, wrongTarget]) assert.equal(selected.packageType, "full");
});

test("keeps older releases on the full ZIP when release metadata is absent or stale", () => {
  const noMetadata = selectWindowsUpdatePackage({ version, assets: assets.slice(0, 1), electronVersion, checksums });
  const staleMetadata = selectWindowsUpdatePackage({ version, assets, metadata: { ...metadata, version: "0.7.15" }, electronVersion, checksums });
  assert.equal(noMetadata.packageType, "full");
  assert.equal(staleMetadata.packageType, "full");
});

test("macOS selects the app-only patch for both arm64 and x64 when compatible", () => {
  const armSelected = selectMacUpdatePackage({ version, assets, metadata, electronVersion, checksums, arch: "arm64" });
  assert.equal(armSelected.packageType, "patch");
  assert.equal(armSelected.asset.name, patchName);
  assert.equal(armSelected.expectedSha256, patchSha);

  const x64Selected = selectMacUpdatePackage({ version, assets, metadata, electronVersion, checksums, arch: "x64" });
  assert.equal(x64Selected.packageType, "patch");
  assert.equal(x64Selected.asset.name, patchName);
  assert.equal(x64Selected.expectedSha256, patchSha);
});

test("macOS falls back to the architecture-specific full ZIP when Electron changes or patch is missing", () => {
  const electronMismatch = selectMacUpdatePackage({ version, assets, metadata, electronVersion: "45.0.0", checksums, arch: "arm64" });
  assert.equal(electronMismatch.packageType, "full");
  assert.equal(electronMismatch.asset.name, macArm64Name);
  assert.equal(electronMismatch.expectedSha256, macArm64Sha);

  const noPatch = selectMacUpdatePackage({
    version,
    assets: assets.filter((asset) => asset.name !== patchName),
    metadata,
    electronVersion,
    checksums,
    arch: "x64",
  });
  assert.equal(noPatch.packageType, "full");
  assert.equal(noPatch.asset.name, macX64Name);
  assert.equal(noPatch.expectedSha256, macX64Sha);
});

test("identifies Setup.exe installer asset for Windows and DMG for macOS", () => {
  const setupName = `WebRevisionDesk-${version}-Setup.exe`;
  const patchSetupName = `WebRevisionDesk-${version}-Patch-from-0.7.10+-Setup.exe`;
  const dmgName = `WebRevisionDesk-${version}-mac-arm64.dmg`;
  const allAssets = [
    ...assets,
    { name: setupName, browser_download_url: `https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v${version}/${setupName}` },
    { name: patchSetupName, browser_download_url: `https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v${version}/${patchSetupName}` },
    { name: dmgName, browser_download_url: `https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/download/v${version}/${dmgName}` },
  ];

  // extractPatchMinimumVersion
  assert.equal(extractPatchMinimumVersion(patchSetupName), "0.7.10");
  assert.equal(extractPatchMinimumVersion(`WebRevisionDesk-${version}-Patch-from-0.7.20+-Setup.exe`), "0.7.20");
  assert.equal(extractPatchMinimumVersion(setupName), null);

  // compareVersionNumbers
  assert.equal(compareVersionNumbers("0.7.30", "0.7.10"), 1);
  assert.equal(compareVersionNumbers("0.7.10", "0.7.30"), -1);
  assert.equal(compareVersionNumbers("0.7.10", "0.7.10"), 0);

  // Windows: packageType が "patch" のときは当然差分インストーラーを選択
  const patchResult = selectPlatformInstallerAsset({
    platform: "win32",
    currentVersion: "0.7.30",
    releaseVersion: version,
    assets: allAssets,
    packageType: "patch",
  });
  assert.equal(patchResult.asset?.name, patchSetupName);
  assert.equal(patchResult.installerType, "patch");

  // Windows: セキュリティや通信失敗等で packageType が "full" にフォールバックした場合でも、
  // 現在のバージョン (0.7.30) が差分対象 (>= 0.7.10) であれば差分インストーラーを優先選択すること！
  const securityFallbackResult = selectPlatformInstallerAsset({
    platform: "win32",
    currentVersion: "0.7.30",
    releaseVersion: version,
    assets: allAssets,
    packageType: "full",
  });
  assert.equal(securityFallbackResult.asset?.name, patchSetupName);
  assert.equal(securityFallbackResult.installerType, "patch");

  // Windows: 現在のバージョンが古い (0.7.9 < 0.7.10) かつ packageType が "full" のときはフル版を選択
  const oldVersionResult = selectPlatformInstallerAsset({
    platform: "win32",
    currentVersion: "0.7.9",
    releaseVersion: version,
    assets: allAssets,
    packageType: "full",
  });
  assert.equal(oldVersionResult.asset?.name, setupName);
  assert.equal(oldVersionResult.installerType, "full");

  // Windows: 差分インストーラーが存在しないときはフル版を選択
  const noPatchResult = selectPlatformInstallerAsset({
    platform: "win32",
    currentVersion: "0.7.30",
    releaseVersion: version,
    assets: allAssets.filter((asset) => asset.name !== patchSetupName),
    packageType: "full",
  });
  assert.equal(noPatchResult.asset?.name, setupName);
  assert.equal(noPatchResult.installerType, "full");

  // macOS: DMG を選択
  const macResult = selectPlatformInstallerAsset({
    platform: "darwin",
    currentVersion: "0.7.30",
    releaseVersion: version,
    assets: allAssets,
    packageType: "patch",
  });
  assert.equal(macResult.asset?.name, dmgName);
  assert.equal(macResult.installerType, "full");
});




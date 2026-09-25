const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

function digestForAsset(checksums, assetName) {
  for (const line of String(checksums || "").split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match?.[2] === assetName) return match[1].toLowerCase();
  }
  return "";
}

function matchesMetadataAsset(metadataAsset, releaseAsset, checksums) {
  if (!metadataAsset || !releaseAsset || metadataAsset.name !== releaseAsset.name) return false;
  if (!SHA256_PATTERN.test(metadataAsset.sha256 || "")) return false;
  if (Number(metadataAsset.size) !== Number(releaseAsset.size)) return false;
  return metadataAsset.sha256.toLowerCase() === digestForAsset(checksums, releaseAsset.name);
}

/**
 * Select the update payload for the current platform (Windows or macOS).
 * Any missing, stale, or incompatible patch metadata falls back to the full ZIP,
 * which keeps older releases compatible.
 */
export function selectPlatformUpdatePackage({
  platform = "win32",
  arch = "arm64",
  version,
  assets = [],
  metadata,
  electronVersion,
  checksums = "",
}) {
  const normalizedVersion = String(version || "").replace(/^v/, "");
  const releaseAssets = Array.isArray(assets) ? assets : [];
  let fullName;
  if (platform === "win32") {
    fullName = `WebRevisionDesk-${normalizedVersion}-electron-win-x64.zip`;
  } else if (platform === "darwin") {
    const macArch = arch === "x64" ? "x64" : "arm64";
    fullName = `WebRevisionDesk-${normalizedVersion}-mac-${macArch}.zip`;
  } else {
    return null;
  }

  const fullAsset = releaseAssets.find((asset) => asset?.name === fullName);
  if (!fullAsset) return null;

  const fallback = {
    asset: fullAsset,
    packageType: "full",
    expectedSha256: digestForAsset(checksums, fullName),
  };
  if (!/^\d+\.\d+\.\d+$/.test(normalizedVersion) || !metadata || !electronVersion) return fallback;
  if (String(metadata.version || "").replace(/^v/, "") !== normalizedVersion) return fallback;
  if (metadata.electronVersion !== electronVersion) return fallback;

  const manifest = metadata.assets || {};
  const fullMetadata = manifest.full;
  const patchMetadata = manifest.patch;
  const patchName = `WebRevisionDesk-${normalizedVersion}-patch.zip`;
  const patchAsset = releaseAssets.find((asset) => asset?.name === patchName);
  if (!patchAsset || patchMetadata?.targetElectronVersion !== electronVersion) return fallback;
  if (!matchesMetadataAsset(patchMetadata, patchAsset, checksums)) return fallback;
  if (platform === "win32" && !matchesMetadataAsset(fullMetadata, fullAsset, checksums)) return fallback;
  if (!(Number(patchMetadata.size) < Number(fullAsset.size))) return fallback;

  return {
    asset: patchAsset,
    packageType: "patch",
    expectedSha256: patchMetadata.sha256.toLowerCase(),
  };
}

/**
 * Choose the Windows update payload. Any missing, stale, or incompatible patch
 * metadata falls back to the full ZIP, which keeps older releases compatible.
 */
export function selectWindowsUpdatePackage(params) {
  return selectPlatformUpdatePackage({ ...params, platform: "win32" });
}

/**
 * Choose the macOS update payload. Any missing, stale, or incompatible patch
 * metadata falls back to the full ZIP, which keeps older releases compatible.
 */
export function selectMacUpdatePackage(params) {
  return selectPlatformUpdatePackage({ ...params, platform: "darwin" });
}

/**
 * Extract minimum applicable version from patch installer asset name.
 * e.g. "WebRevisionDesk-0.7.31-Patch-from-0.7.10+-Setup.exe" -> "0.7.10"
 */
export function extractPatchMinimumVersion(assetName) {
  const match = String(assetName || "").match(/^WebRevisionDesk-.*-Patch-from-(.+?)\+-Setup\.exe$/i);
  return match ? match[1] : null;
}

/**
 * Compare two semver-like strings "x.y.z".
 * Returns 1 if left > right, -1 if left < right, 0 if equal.
 */
export function compareVersionNumbers(left, right) {
  const a = String(left || "").replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  const b = String(right || "").replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/**
 * Select the appropriate installer asset for direct browser download.
 * On Windows:
 * If a patch installer (WebRevisionDesk-*-Patch*Setup.exe) is available
 * AND currentVersion is compatible with it (>= minimumVersion and < releaseVersion),
 * prioritize the patch installer even if in-app packageType fell back to "full"
 * (e.g. because release.json download failed under strict security).
 */
export function selectPlatformInstallerAsset({
  platform = "win32",
  currentVersion,
  releaseVersion,
  assets = [],
  packageType = "full",
  defaultMinimumPatchVersion = "0.7.10",
}) {
  const releaseAssets = Array.isArray(assets) ? assets : [];
  const setupExe = releaseAssets.find((asset) => /^WebRevisionDesk-.*-Setup\.exe$/i.test(asset?.name || "") && !asset?.name?.includes("Patch"));
  const patchExe = releaseAssets.find((asset) => /^WebRevisionDesk-.*-Patch.*Setup\.exe$/i.test(asset?.name || ""));
  const macDmg = releaseAssets.find((asset) => /^WebRevisionDesk-.*-mac-.*\.dmg$/i.test(asset?.name || ""));

  if (platform === "win32") {
    if (patchExe) {
      const minimumVersion = extractPatchMinimumVersion(patchExe.name) || defaultMinimumPatchVersion;
      const isEligibleForPatch = Boolean(
        currentVersion
        && compareVersionNumbers(currentVersion, minimumVersion) >= 0
        && (!releaseVersion || compareVersionNumbers(currentVersion, releaseVersion) < 0)
      );
      if (isEligibleForPatch || packageType === "patch") {
        return { asset: patchExe, installerType: "patch" };
      }
    }
    const asset = setupExe || patchExe || null;
    return { asset, installerType: asset === patchExe ? "patch" : "full" };
  }

  if (platform === "darwin") {
    return { asset: macDmg || null, installerType: "full" };
  }

  const asset = (packageType === "patch" && patchExe) ? patchExe : (setupExe || patchExe || null);
  return { asset, installerType: asset === patchExe ? "patch" : "full" };
}



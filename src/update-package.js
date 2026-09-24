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
 * Choose the Windows update payload. Any missing, stale, or incompatible patch
 * metadata falls back to the full ZIP, which keeps older releases compatible.
 */
export function selectWindowsUpdatePackage({ version, assets = [], metadata, electronVersion, checksums = "" }) {
  const normalizedVersion = String(version || "").replace(/^v/, "");
  const releaseAssets = Array.isArray(assets) ? assets : [];
  const fullName = `WebRevisionDesk-${normalizedVersion}-electron-win-x64.zip`;
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
  if (!matchesMetadataAsset(fullMetadata, fullAsset, checksums)
      || !matchesMetadataAsset(patchMetadata, patchAsset, checksums)) return fallback;
  if (!(Number(patchMetadata.size) < Number(fullMetadata.size))) return fallback;

  return {
    asset: patchAsset,
    packageType: "patch",
    expectedSha256: patchMetadata.sha256.toLowerCase(),
  };
}

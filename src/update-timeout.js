export const DEFAULT_UPDATE_DOWNLOAD_TIMEOUT_SECONDS = 120;
export const MIN_UPDATE_DOWNLOAD_TIMEOUT_SECONDS = 30;
export const MAX_UPDATE_DOWNLOAD_TIMEOUT_SECONDS = 1800;

export function normalizeUpdateDownloadTimeoutSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_UPDATE_DOWNLOAD_TIMEOUT_SECONDS;
  return Math.min(
    MAX_UPDATE_DOWNLOAD_TIMEOUT_SECONDS,
    Math.max(MIN_UPDATE_DOWNLOAD_TIMEOUT_SECONDS, Math.round(parsed)),
  );
}

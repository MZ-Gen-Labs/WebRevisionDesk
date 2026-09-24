export const LATEST_RELEASE_URL = "https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/latest";

export function isAllowedReleaseUrl(url) {
  return url === LATEST_RELEASE_URL;
}

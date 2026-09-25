export const LATEST_RELEASE_URL = "https://github.com/MZ-Gen-Labs/WebRevisionDesk/releases/latest";

const ALLOWED_RELEASE_URL_PATTERN = /^https:\/\/github\.com\/MZ-Gen-Labs\/WebRevisionDesk\/releases\/(?:latest|download\/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/[A-Za-z0-9_.%+~-]+)$/;

export function isAllowedReleaseUrl(url) {
  if (typeof url !== "string") return false;
  return ALLOWED_RELEASE_URL_PATTERN.test(url);
}

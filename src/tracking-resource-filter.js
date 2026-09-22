const trackingHosts = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "stats.g.doubleclick.net",
];

export function isTrackingResourceUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return trackingHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

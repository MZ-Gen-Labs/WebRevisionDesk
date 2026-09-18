export const STARTUP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function shouldCheckForUpdatesOnStartup(settings, now = Date.now()) {
  if (settings?.checkUpdatesOnStartup === false || !settings?.githubRepository) return false;
  const checkedAt = Date.parse(settings.lastCheckAttemptAt || settings.lastCheckAt || "");
  if (!Number.isFinite(checkedAt)) return true;
  const elapsed = now - checkedAt;
  return elapsed < 0 || elapsed >= STARTUP_UPDATE_CHECK_INTERVAL_MS;
}

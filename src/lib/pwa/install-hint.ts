/** localStorage key holding the time the install hint was closed. */
export const INSTALL_HINT_KEY = "nordavo:install-hint-dismissed";
/** The hint comes back this long after it was closed. */
export const INSTALL_HINT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** iPhone, iPod or iPad (iPadOS reports itself as a Mac with touch). */
export function isIosDevice(userAgent: string, maxTouchPoints: number) {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Show the "add to home screen" hint on iOS in the browser only: not once
 * installed, and not within 30 days after it was closed.
 */
export function shouldShowInstallHint({
  userAgent,
  maxTouchPoints,
  standalone,
  dismissedAt,
  now,
}: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
  dismissedAt: number | null;
  now: number;
}) {
  if (standalone) return false;
  if (!isIosDevice(userAgent, maxTouchPoints)) return false;
  if (dismissedAt !== null && Number.isFinite(dismissedAt) && now - dismissedAt < INSTALL_HINT_SNOOZE_MS) return false;
  return true;
}

/** "zojuist", "5 min geleden", "3 uur geleden", "gisteren", "4 dagen geleden", or a date. */
export function timeAgo(value: string, now: Date) {
  const diff = Math.max(0, now.getTime() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours === 1 ? "1 hour" : `${hours} hours`} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: days > 300 ? "numeric" : undefined,
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
}

/** "12 kB", "3,4 MB". */
export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} kB`;
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(kb / 1024)} MB`;
}

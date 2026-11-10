import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import type { BufferState, WeekRhythm } from "@/lib/content/rules";
import type { PostSummary } from "@/lib/content/planning";

const bufferTones: Record<BufferState, { bar: string; text: string; label: string }> = {
  low: { bar: "bg-danger", text: "text-danger", label: "Below target" },
  ok: { bar: "bg-emerald-500", text: "text-emerald-700", label: "On target" },
  full: { bar: "bg-brand-500", text: "text-brand-700", label: "Above target" },
};

/** Posts in Approved or Scheduled against the target range. */
export function BufferMeter({ count, min, max, state, compact }: { count: number; min: number; max: number; state: BufferState; compact?: boolean }) {
  const scale = Math.max(max, count, 1);
  const tone = bufferTones[state];
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className={compact ? "text-xs font-medium text-muted" : "text-sm font-medium text-ink"}>Buffer ready ahead</p>
        <p className={`text-xs font-semibold ${tone.text}`}>{tone.label}</p>
      </div>
      <p className="mt-1 font-display text-2xl font-bold text-brand-900">
        {count}
        <span className="ml-1 text-sm font-medium text-muted">
          of {min} to {max}
        </span>
      </p>
      <div
        className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-valuenow={count}
        aria-label={`Buffer: ${count} posts approved or scheduled, target ${min} to ${max}`}
      >
        <div className="absolute inset-y-0 rounded-full bg-emerald-100" style={{ left: `${(min / scale) * 100}%`, width: `${((max - min) / scale) * 100}%` }} />
        <div className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, (count / scale) * 100)}%` }} />
      </div>
    </div>
  );
}

/** Posts planned in a week against the rhythm goal. */
export function RhythmStat({ label, rhythm }: { label: string; rhythm: WeekRhythm }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-bold ${rhythm.onTrack ? "text-brand-900" : "text-amber-700"}`}>
        {rhythm.planned}
        <span className="ml-1 text-sm font-medium text-muted">of {rhythm.goal} planned</span>
      </p>
      <p className={`text-xs font-semibold ${rhythm.onTrack ? "text-emerald-700" : "text-amber-700"}`}>{rhythm.onTrack ? "On track" : "Below the rhythm goal"}</p>
    </div>
  );
}

/** The most important signal: planned tomorrow and not approved yet. */
export function TomorrowWarning({ posts, hrefFor }: { posts: (PostSummary & { workspaceName?: string })[]; hrefFor: (post: PostSummary) => string }) {
  if (posts.length === 0) return null;
  return (
    <div role="alert" className="mb-6 rounded-2xl border border-danger/30 bg-danger-bg p-4">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
        {posts.length === 1 ? "Planned for tomorrow and not approved yet" : `${posts.length} posts planned for tomorrow are not approved yet`}
      </p>
      <ul className="mt-2 space-y-1 pl-7 text-sm">
        {posts.map((post) => (
          <li key={post.id}>
            <Link href={hrefFor(post)} className="font-medium text-ink underline-offset-2 hover:underline">
              {post.title}
            </Link>
            {post.workspaceName && <span className="text-muted"> · {post.workspaceName}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RhythmWarning({ weeks }: { weeks: { label: string; rhythm: WeekRhythm }[] }) {
  const below = weeks.filter((w) => !w.rhythm.onTrack && w.rhythm.goal > 0);
  if (below.length === 0) return null;
  return (
    <div className="mb-6 flex items-start gap-2 rounded-2xl border border-amber-600/20 bg-amber-50 p-4 text-sm text-amber-900">
      <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <p>
        {below.map((w) => `${w.label}: ${w.rhythm.planned} of ${w.rhythm.goal} posts planned`).join(". ")}. Plan more posts to stay on rhythm.
      </p>
    </div>
  );
}

/** "Tue 10 Nov" for a YYYY-MM-DD day. */
export function formatDay(day: string, options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

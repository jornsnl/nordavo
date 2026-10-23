import { Star } from "lucide-react";
import { formatDate } from "@/lib/format";

type Checkin = {
  id: string;
  checkin_date: string;
  rating: number | null;
  notes: string | null;
  author: { full_name: string | null } | null;
};

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center" role="img" aria-label={`${rating} van 5 sterren`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden="true"
          className={`size-4 ${n <= rating ? "fill-accent-500 text-accent-500" : "text-brand-200"}`}
        />
      ))}
    </span>
  );
}

export function CheckinList({ checkins }: { checkins: Checkin[] }) {
  if (checkins.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nog geen check-ins. Plan de eerste rond twee weken na de start, dan weet je snel of het klikt.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-border">
      {checkins.map((checkin) => (
        <li key={checkin.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-sm font-semibold text-ink">{formatDate(checkin.checkin_date)}</p>
            {checkin.rating ? (
              <Stars rating={checkin.rating} />
            ) : (
              <span className="text-xs text-muted">Geen score</span>
            )}
            {checkin.author?.full_name && (
              <span className="text-xs text-muted">door {checkin.author.full_name}</span>
            )}
          </div>
          {checkin.notes && (
            <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-ink">
              {checkin.notes}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

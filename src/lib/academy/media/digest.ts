// The mail summary of Academy notifications (Academy: gebruikersomgeving):
// daily or weekly as the person chose (academy_members.digest_frequency),
// sent from 08:00 in their own time zone. Pure, tested in
// tests/academy-media.test.ts; sent by the academy-digest job
// (src/jobs/academy.ts).

import type { AcademyLocale, DigestFrequency } from "@/lib/academy/database";
import { formatAcademyDateTime, safeZone } from "@/lib/academy/time";
import { escapeMailHtml as esc, mailButton, mailParagraph, renderMailLayout } from "@/lib/notify/layout";

/** The local hour from which the summary goes out. */
export const DIGEST_HOUR = 8;
/** Weekly summaries go out on this local weekday (1 = Monday). */
export const DIGEST_WEEKDAY = 1;

/** Local calendar day, hour and weekday (1 = Monday ... 7 = Sunday) of an instant in a zone. */
export function localClock(at: Date, zone: string): { date: string; hour: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safeZone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), weekday: weekdays[get("weekday")] ?? 0 };
}

/**
 * Whether the summary is due now for this person. Daily: from 08:00 local,
 * once per local day. Weekly: on Monday from 08:00 local, at most once in
 * six days. An hourly job therefore sends it in the first run after 08:00.
 */
export function digestDue(
  { frequency, sentAt, timeZone }: { frequency: DigestFrequency; sentAt: string | null; timeZone: string },
  now: Date = new Date(),
): boolean {
  if (frequency === "off") return false;
  const local = localClock(now, timeZone);
  if (local.hour < DIGEST_HOUR) return false;
  if (frequency === "daily") {
    return !sentAt || localClock(new Date(sentAt), timeZone).date !== local.date;
  }
  if (local.weekday !== DIGEST_WEEKDAY) return false;
  return !sentAt || now.getTime() - new Date(sentAt).getTime() > 6 * 24 * 3600 * 1000;
}

export type DigestItem = { title: string; body: string | null; link: string | null; createdAt: string };

/** At most this many notifications are listed in one mail. */
export const DIGEST_MAX_ITEMS = 25;

function absolute(siteUrl: string, link: string | null) {
  const base = siteUrl.replace(/\/+$/, "");
  return link && link.startsWith("/") ? `${base}${link}` : `${base}/academy/notifications`;
}

/** The summary mail in the person's language. */
export function digestMail({
  name,
  locale,
  frequency,
  items,
  total,
  timeZone,
  siteUrl,
}: {
  name: string;
  locale: AcademyLocale;
  frequency: Exclude<DigestFrequency, "off">;
  items: DigestItem[];
  /** All unread notifications (items may be fewer). */
  total: number;
  timeZone: string;
  siteUrl: string;
}) {
  const nl = locale === "nl";
  const first = name.trim().split(/\s+/)[0] || name;
  const shown = items.slice(0, DIGEST_MAX_ITEMS);
  const subject = nl
    ? `${total === 1 ? "1 nieuwe melding" : `${total} nieuwe meldingen`} in de Nordavo Academy`
    : `${total === 1 ? "1 new notification" : `${total} new notifications`} in the Nordavo Academy`;
  const intro = nl
    ? frequency === "daily"
      ? "Dit is er sinds gisteren gebeurd in de Academy."
      : "Dit is er deze week gebeurd in de Academy."
    : frequency === "daily"
      ? "This is what happened in the Academy since yesterday."
      : "This is what happened in the Academy this week.";

  const rows = shown
    .map(
      (item) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid #e3e8ef">` +
        `<a href="${esc(absolute(siteUrl, item.link))}" style="font-weight:700;color:#173a66;text-decoration:none">${esc(item.title)}</a>` +
        (item.body ? `<div style="margin-top:2px;font-size:14px;line-height:21px;color:#0f1b2d">${esc(item.body)}</div>` : "") +
        `<div style="margin-top:2px;font-size:12px;color:#5b6779">${esc(formatAcademyDateTime(item.createdAt, locale, timeZone))}</div>` +
        `</td></tr>`,
    )
    .join("");
  const more = total > shown.length ? (nl ? `En nog ${total - shown.length} meer.` : `And ${total - shown.length} more.`) : "";
  const pageUrl = absolute(siteUrl, "/academy/notifications");
  const settingsUrl = absolute(siteUrl, "/academy/settings");
  const action = nl ? "Bekijk je meldingen" : "View your notifications";

  const body = [
    mailParagraph(nl ? `Hoi ${esc(first)},` : `Hi ${esc(first)},`),
    mailParagraph(intro),
    `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin:0 0 8px">${rows}</table>`,
    more ? mailParagraph(esc(more)) : "",
    mailButton(pageUrl, action, { tone: "accent" }),
  ].join("\n");

  const text = [
    nl ? `Hoi ${first},` : `Hi ${first},`,
    "",
    intro,
    "",
    ...shown.map((item) => `- ${item.title}${item.body ? `: ${item.body}` : ""} (${absolute(siteUrl, item.link)})`),
    ...(more ? ["", more] : []),
    "",
    `${action}: ${pageUrl}`,
    "",
    nl ? `Minder of geen mail? Pas het aan in je instellingen: ${settingsUrl}` : `Fewer or no mails? Change it in your settings: ${settingsUrl}`,
  ].join("\n");

  return {
    subject,
    text,
    html: renderMailLayout({
      body,
      eyebrow: "Academy",
      title: nl ? (frequency === "daily" ? "Je dagelijkse samenvatting" : "Je wekelijkse samenvatting") : frequency === "daily" ? "Your daily summary" : "Your weekly summary",
      preheader: shown[0]?.title ?? subject,
      footerNote: nl
        ? `Je krijgt deze samenvatting omdat je hem ${frequency === "daily" ? "dagelijks" : "wekelijks"} hebt aangezet. <a href="${esc(settingsUrl)}" style="color:#1f4e8c">Instellingen</a>`
        : `You get this summary because you chose to receive it ${frequency}. <a href="${esc(settingsUrl)}" style="color:#1f4e8c">Settings</a>`,
      siteUrl,
    }),
  };
}

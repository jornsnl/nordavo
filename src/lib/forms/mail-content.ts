/**
 * The mails candidates get: the form link and the reminder. One mail per
 * candidate, never BCC. Pure, so the content is tested without sending.
 */

function escape(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const deadlineFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDeadline(deadline: string | null | undefined) {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  return deadlineFormatter.format(new Date(`${deadline}T00:00:00Z`));
}

export type FormMailInput = {
  candidateName: string;
  vacancyTitle: string;
  link: string;
  deadline: string | null;
};

export type MailContent = { subject: string; html: string; text: string };

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}

function layout(paragraphs: string[], link: string, button: string) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px">${p}</p>`).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:560px">
${body}
<p style="margin:24px 0"><a href="${escape(link)}" style="background:#1d4ed8;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">${escape(button)}</a></p>
<p style="margin:0 0 16px;color:#64748b;font-size:13px">Or open this link: <a href="${escape(link)}">${escape(link)}</a></p>
<p style="margin:0">Kind regards,<br>The Nordavo recruitment team</p>
</div>`;
}

export function inviteMail({ candidateName, vacancyTitle, link, deadline }: FormMailInput): MailContent {
  const when = formatDeadline(deadline);
  const subject = `Next step for ${vacancyTitle} at Nordavo`;
  const lines = [
    `Hi ${escape(firstName(candidateName))},`,
    `Thank you for your interest in the ${escape(vacancyTitle)} role. The next step is a short application form with your CV and a 1 to 2 minute intro video.`,
    when ? `Please fill it in before <strong>${escape(when)}</strong>.` : "Please fill it in as soon as you can.",
  ];
  const text = [
    `Hi ${firstName(candidateName)},`,
    "",
    `Thank you for your interest in the ${vacancyTitle} role. The next step is a short application form with your CV and a 1 to 2 minute intro video.`,
    when ? `Please fill it in before ${when}.` : "Please fill it in as soon as you can.",
    "",
    `Your personal link: ${link}`,
    "",
    "Kind regards,",
    "The Nordavo recruitment team",
  ].join("\n");
  return { subject, html: layout(lines, link, "Open the form"), text };
}

export function reminderMail({ candidateName, vacancyTitle, link, deadline }: FormMailInput): MailContent {
  const when = formatDeadline(deadline);
  const subject = `Reminder: your application for ${vacancyTitle}`;
  const lines = [
    `Hi ${escape(firstName(candidateName))},`,
    `We have not received your application form for the ${escape(vacancyTitle)} role yet${when ? ` (the deadline was ${escape(when)})` : ""}.`,
    "If you are still interested, please fill it in now. It takes about five minutes. If you are no longer interested, you can ignore this mail.",
  ];
  const text = [
    `Hi ${firstName(candidateName)},`,
    "",
    `We have not received your application form for the ${vacancyTitle} role yet${when ? ` (the deadline was ${when})` : ""}.`,
    "If you are still interested, please fill it in now. It takes about five minutes. If you are no longer interested, you can ignore this mail.",
    "",
    `Your personal link: ${link}`,
    "",
    "Kind regards,",
    "The Nordavo recruitment team",
  ].join("\n");
  return { subject, html: layout(lines, link, "Fill in the form"), text };
}

/** Public link of a form token. */
export function applyUrl(siteUrl: string, token: string) {
  return `${siteUrl.replace(/\/+$/, "")}/apply/${token}`;
}

/** Kinds of mail the portal sends, as shown and filtered in Settings > Mail log. */
export const mailCategories = [
  { value: "test", label: "Test mail" },
  { value: "interview_invite", label: "Interview invitation" },
  { value: "interview_reminder", label: "Interview reminder" },
  { value: "form_invite", label: "Application form" },
  { value: "form_reminder", label: "Form reminder" },
  { value: "work_notification", label: "Work update" },
  { value: "work_invite", label: "Work invite" },
  { value: "work_sign_in", label: "Work sign-in link" },
  { value: "caller_invite", label: "Caller invitation" },
  { value: "academy_invite", label: "Academy invitation" },
  // Academy and ATS (docs/academy.md, ATS-koppeling)
  { value: "academy_welcome", label: "Academy welcome (placed)" },
  { value: "academy_top_candidate", label: "Academy top candidate" },
  { value: "academy_reminder", label: "Academy reminder" },
  { value: "weekly_report", label: "Weekly report" },
  { value: "job_failure", label: "Job failure" },
  { value: "other", label: "Other" },
] as const;

export type MailCategory = (typeof mailCategories)[number]["value"];

export function mailCategoryLabel(value: string) {
  return mailCategories.find((c) => c.value === value)?.label ?? value;
}

export function isMailCategory(value: string | undefined): value is MailCategory {
  return mailCategories.some((c) => c.value === value);
}

// Every text of the Academy learner UI in Dutch (clients) and English
// (developers and candidates). Each user can switch (academy_members.locale).
// Add a key to both dictionaries: the nl type is checked against en. Pure,
// safe for client components, tested in tests/academy-i18n.test.ts.
//
// Placeholders: {name} is replaced by vars.name.

import type { AcademyLocale } from "@/lib/academy/database";
import { learnEn, learnNl } from "@/lib/academy/i18n/learn";

const en = {
  // Shell
  "shell.academy": "Academy",
  "shell.home": "Home",
  "shell.courses": "Courses",
  "shell.settings": "Settings",
  "shell.security": "Security",
  "shell.signOut": "Sign out",
  "shell.backToPortal": "Client portal",
  "shell.backToDashboard": "Back to the portal",
  "shell.language": "Language",
  "shell.preview": "Preview as Nordavo: nothing you do here is saved as progress.",
  "shell.notifications": "Notifications",

  // Start page
  "home.welcome": "Welcome, {name}",
  "home.intro": "Your learning path with Nordavo. Pick up where you left off, or start a new lesson.",
  "home.progress": "Your progress",
  "home.lessonsDone": "{done} of {total} lessons done",
  "home.continue": "Continue where you left off",
  "home.start": "Start the course",
  "home.allDone": "All lessons are done. Well done!",
  "home.noCourses": "No course is open for you yet. Nordavo will let you know when it is.",
  "home.openTasks": "Open tasks",
  "home.ritualsThisWeek": "Rituals this week",
  "home.upcoming": "Coming up",
  "home.placement": "Your placement",
  "home.planCall": "Plan a call with Nordavo",
  "home.planCallText": "A question, or want to talk something through? Pick a moment that suits you.",
  "home.nothingYet": "Nothing here yet.",
  "home.courseCompleted": "Completed",
  "home.team": "Progress of your team",
  "home.checkScore": "knowledge check {percent}%",
  "home.lastActive": "last active {date}",
  "placement.start": "Start",
  "placement.hours": "Hours per week",
  "placement.overlap": "Overlap (your time)",
  "placement.probation": "End of probation",

  // Course
  "course.modules": "Modules",
  "course.module": "Module {number}",
  "course.lessons": "{count} lessons",
  "course.lessonOne": "1 lesson",
  "course.noLessons": "Lessons follow soon.",
  "course.core": "Core",
  "course.beforeStart": "Finish before the developer starts",
  "course.workbook": "Workbook",
  "course.notFound": "This course is not open for you.",

  // Module states
  "state.completed": "Completed",
  "state.open": "Open",
  "state.locked_scope": "Not open for you yet",
  "state.locked_order": "Opens after the previous module",
  "state.locked_requirement": "Opens after the required modules",
  "state.locked_release": "Opens on {date}",
  "state.locked_release_unknown": "Opens a while after your start date",

  // Lesson player
  "lesson.previous": "Previous",
  "lesson.next": "Next",
  "lesson.backToCourse": "Back to the course",
  "lesson.progress": "Lesson progress",
  "lesson.done": "Lesson done",
  "lesson.todo": "To finish this lesson",
  "lesson.noRequirements": "Open the lesson and it counts as done.",
  "lesson.required": "Required",
  "lesson.minutes": "{count} min",
  "lesson.locked": "This lesson is locked.",
  "lesson.lessonsInCourse": "Lessons",
  "lesson.courseProgress": "{percent}% of the course",
  "lesson.empty": "This lesson has no content yet.",

  // Blocks
  "block.explanation": "Explanation",
  "block.video": "Video",
  "block.document": "Document",
  "block.worksheet": "Worksheet",
  "block.assignment": "Assignment",
  "block.tasks": "Tasks",
  "block.knowledge_check": "Knowledge check",
  "block.notes": "Notes",
  "block.questionnaire": "Questionnaire",
  "block.preparing": "This part is being prepared.",
  "block.done": "Done",
  "notes.placeholder": "Write your own notes. Only you and Nordavo can read them.",
  "notes.moduleHint": "These notes belong to the whole module.",
  "notes.saving": "Saving…",
  "notes.saved": "Saved",
  "notes.failed": "Not saved. Check your connection.",

  // Requirements (completion rules)
  "req.explanation": "Read the explanation",
  "req.video": "Watch at least {percent}% of the video",
  "req.document": "Open the document",
  "req.worksheet": "Fill in and submit the worksheet",
  "req.assignment": "Hand in the assignment",
  "req.assignmentApproved": "Have the assignment approved by Nordavo",
  "req.tasks": "Tick off the required tasks",
  "req.knowledge_check": "Do the knowledge check",
  "req.knowledgeCheckScore": "Score at least {percent}% on the knowledge check",
  "req.notes": "Write a note",
  "req.questionnaire": "Fill in the questionnaire",

  // Settings
  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.timeZone": "Time zone",
  "settings.timeZoneHint": "Deadlines, reminders and notifications use this time zone.",
  "settings.digest": "Mail summary of notifications",
  "settings.digest.daily": "Daily",
  "settings.digest.weekly": "Weekly",
  "settings.digest.off": "No summary",
  "settings.save": "Save",
  "settings.saved": "Saved.",
  "settings.failed": "Not saved. Please try again.",
  "tz.Europe/Amsterdam": "Netherlands (Amsterdam)",
  "tz.Asia/Kolkata": "India (Kolkata)",
  "locale.nl": "Nederlands",
  "locale.en": "English",

  // Errors
  "error.generic": "Something went wrong. Please try again.",
  "error.notOpen": "This lesson is not open for you.",

  // Area learn: assignment, tasks, knowledge check, questionnaire (i18n/learn.ts)
  ...learnEn,
} as const;

export type AcademyMessageKey = keyof typeof en;

const nl: Record<AcademyMessageKey, string> = {
  "shell.academy": "Academy",
  "shell.home": "Start",
  "shell.courses": "Courses",
  "shell.settings": "Instellingen",
  "shell.security": "Beveiliging",
  "shell.signOut": "Uitloggen",
  "shell.backToPortal": "Klantportaal",
  "shell.backToDashboard": "Terug naar het portaal",
  "shell.language": "Taal",
  "shell.preview": "Voorbeeld als Nordavo: wat je hier doet telt niet als voortgang.",
  "shell.notifications": "Meldingen",

  "home.welcome": "Welkom, {name}",
  "home.intro": "Je leerroute met Nordavo. Ga verder waar je was, of begin aan een nieuwe les.",
  "home.progress": "Je voortgang",
  "home.lessonsDone": "{done} van {total} lessen af",
  "home.continue": "Verder waar je was",
  "home.start": "Begin aan de course",
  "home.allDone": "Alle lessen zijn af. Goed gedaan!",
  "home.noCourses": "Er staat nog geen course voor je open. Nordavo laat het je weten zodra dat zo is.",
  "home.openTasks": "Openstaande taken",
  "home.ritualsThisWeek": "Rituelen deze week",
  "home.upcoming": "Komende momenten",
  "home.placement": "Je plaatsing",
  "home.planCall": "Plan een call met Nordavo",
  "home.planCallText": "Een vraag, of iets bespreken? Kies een moment dat jou uitkomt.",
  "home.nothingYet": "Hier staat nog niets.",
  "home.courseCompleted": "Afgerond",
  "home.team": "Voortgang van je team",
  "home.checkScore": "kennischeck {percent}%",
  "home.lastActive": "laatst actief {date}",
  "placement.start": "Start",
  "placement.hours": "Uren per week",
  "placement.overlap": "Overlap (jouw tijd)",
  "placement.probation": "Einde proeftijd",

  "course.modules": "Modules",
  "course.module": "Module {number}",
  "course.lessons": "{count} lessen",
  "course.lessonOne": "1 les",
  "course.noLessons": "De lessen volgen binnenkort.",
  "course.core": "Kern",
  "course.beforeStart": "Afronden voordat je developer start",
  "course.workbook": "Werkboek",
  "course.notFound": "Deze course staat niet voor je open.",

  "state.completed": "Afgerond",
  "state.open": "Open",
  "state.locked_scope": "Nog niet voor je open",
  "state.locked_order": "Gaat open na de vorige module",
  "state.locked_requirement": "Gaat open na de vereiste modules",
  "state.locked_release": "Gaat open op {date}",
  "state.locked_release_unknown": "Gaat open een tijd na je startdatum",

  "lesson.previous": "Vorige",
  "lesson.next": "Volgende",
  "lesson.backToCourse": "Terug naar de course",
  "lesson.progress": "Voortgang van de les",
  "lesson.done": "Les afgerond",
  "lesson.todo": "Om deze les af te ronden",
  "lesson.noRequirements": "Open de les en hij telt als afgerond.",
  "lesson.required": "Verplicht",
  "lesson.minutes": "{count} min",
  "lesson.locked": "Deze les is nog dicht.",
  "lesson.lessonsInCourse": "Lessen",
  "lesson.courseProgress": "{percent}% van de course",
  "lesson.empty": "Deze les heeft nog geen inhoud.",

  "block.explanation": "Uitleg",
  "block.video": "Video",
  "block.document": "Document",
  "block.worksheet": "Werkblad",
  "block.assignment": "Opdracht",
  "block.tasks": "Taken",
  "block.knowledge_check": "Kennischeck",
  "block.notes": "Notities",
  "block.questionnaire": "Vragenlijst",
  "block.preparing": "Dit onderdeel wordt voorbereid.",
  "block.done": "Gedaan",
  "notes.placeholder": "Schrijf je eigen notities. Alleen jij en Nordavo kunnen ze lezen.",
  "notes.moduleHint": "Deze notities horen bij de hele module.",
  "notes.saving": "Opslaan…",
  "notes.saved": "Opgeslagen",
  "notes.failed": "Niet opgeslagen. Controleer je verbinding.",

  "req.explanation": "Lees de uitleg",
  "req.video": "Bekijk minstens {percent}% van de video",
  "req.document": "Open het document",
  "req.worksheet": "Vul het werkblad in en lever het in",
  "req.assignment": "Lever de opdracht in",
  "req.assignmentApproved": "Laat de opdracht goedkeuren door Nordavo",
  "req.tasks": "Vink de verplichte taken af",
  "req.knowledge_check": "Doe de kennischeck",
  "req.knowledgeCheckScore": "Haal minstens {percent}% in de kennischeck",
  "req.notes": "Schrijf een notitie",
  "req.questionnaire": "Vul de vragenlijst in",

  "settings.title": "Instellingen",
  "settings.language": "Taal",
  "settings.timeZone": "Tijdzone",
  "settings.timeZoneHint": "Deadlines, herinneringen en meldingen volgen deze tijdzone.",
  "settings.digest": "Mailsamenvatting van meldingen",
  "settings.digest.daily": "Dagelijks",
  "settings.digest.weekly": "Wekelijks",
  "settings.digest.off": "Geen samenvatting",
  "settings.save": "Opslaan",
  "settings.saved": "Opgeslagen.",
  "settings.failed": "Niet opgeslagen. Probeer het opnieuw.",
  "tz.Europe/Amsterdam": "Nederland (Amsterdam)",
  "tz.Asia/Kolkata": "India (Kolkata)",
  "locale.nl": "Nederlands",
  "locale.en": "English",

  "error.generic": "Er ging iets mis. Probeer het opnieuw.",
  "error.notOpen": "Deze les staat niet voor je open.",

  // Area learn (i18n/learn.ts)
  ...learnNl,
};

export const academyMessages: Record<AcademyLocale, Record<AcademyMessageKey, string>> = { en, nl };

export const ACADEMY_LOCALES: AcademyLocale[] = ["nl", "en"];

export function isAcademyLocale(value: unknown): value is AcademyLocale {
  return value === "nl" || value === "en";
}

/** One text in the user's language, with {placeholders} filled in. */
export function t(locale: AcademyLocale, key: AcademyMessageKey, vars?: Record<string, string | number>): string {
  const template = academyMessages[locale]?.[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** A translator bound to one locale, for components. */
export function translator(locale: AcademyLocale) {
  return (key: AcademyMessageKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}

export type Translate = ReturnType<typeof translator>;

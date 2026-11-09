// Nordavo Working Style Profile: every fixed text, copied verbatim from the
// assignment of Julius (Athmium tasks 1/4 to 4/4). Do not rewrite or add to
// these texts: a change is a new instrument version (docs/working-style-profile.md).
// The 52 statements are seeded in SQL as well
// (supabase/migrations/20261116000000_wsp_core.sql); tests/wsp.test.ts checks
// that both are the same. Pure, no AI anywhere.

export const INSTRUMENT_VERSION = "nordavo-wsp-v1";
export const CONSENT_TEXT_VERSION = "nordavo-wsp-consent-v1";

export type Dimension = "E" | "A" | "C" | "S" | "O";
export type ItemDimension = Dimension | "check";
export type ItemKey = "normal" | "reversed";

export type Item = {
  position: number;
  code: string;
  statement: string;
  dimension: ItemDimension;
  /** Null for the two control statements. */
  key: ItemKey | null;
  /** Only for the control statements. */
  expected: number | null;
};

const n = (position: number, code: string, statement: string, dimension: Dimension): Item => ({
  position,
  code,
  statement,
  dimension,
  key: "normal",
  expected: null,
});
const r = (position: number, code: string, statement: string, dimension: Dimension): Item => ({
  position,
  code,
  statement,
  dimension,
  key: "reversed",
  expected: null,
});
const check = (position: number, code: string, statement: string, expected: number): Item => ({
  position,
  code,
  statement,
  dimension: "check",
  key: null,
  expected,
});

/** Stellingen (vaste volgorde). */
export const ITEMS: readonly Item[] = [
  n(1, "E1", "I make friends easily.", "E"),
  r(2, "A1", "I feel little concern for others.", "A"),
  n(3, "C1", "I am always prepared.", "C"),
  r(4, "S1", "I get stressed out easily.", "S"),
  n(5, "O1", "I like to solve complex problems.", "O"),
  r(6, "E2", "I don't talk a lot.", "E"),
  n(7, "A2", "I am interested in people.", "A"),
  r(8, "C2", "I put little time and effort into my work.", "C"),
  n(9, "S2", "I am relaxed most of the time.", "S"),
  r(10, "O2", "I have difficulty understanding abstract ideas.", "O"),
  n(11, "E3", "I feel comfortable around people.", "E"),
  r(12, "A3", "I insult people.", "A"),
  n(13, "C3", "I pay attention to details.", "C"),
  r(14, "S3", "I worry about things.", "S"),
  n(15, "O3", "I have a vivid imagination.", "O"),
  r(16, "E4", "I keep in the background.", "E"),
  n(17, "A4", "I sympathize with others' feelings.", "A"),
  r(18, "C4", "I make a mess of things.", "C"),
  n(19, "S4", "I remain calm under pressure.", "S"),
  r(20, "O4", "I am not interested in abstract ideas.", "O"),
  n(21, "E5", "I start conversations.", "E"),
  r(22, "A5", "I am not interested in other people's problems.", "A"),
  check(23, "CHK1", 'For this statement, please select "Moderately accurate".', 4),
  n(24, "C5", "I start tasks right away.", "C"),
  r(25, "S5", "I am easily disturbed.", "S"),
  n(26, "O5", "I have excellent ideas.", "O"),
  r(27, "E6", "I have little to say.", "E"),
  n(28, "A6", "I have a soft heart.", "A"),
  r(29, "C6", "I break my promises.", "C"),
  r(30, "S6", "I get upset easily.", "S"),
  r(31, "O6", "I do not have a good imagination.", "O"),
  n(32, "E7", "I take charge.", "E"),
  r(33, "A7", "I am not really interested in others.", "A"),
  n(34, "C7", "I like order.", "C"),
  n(35, "S7", "I am not easily annoyed.", "S"),
  n(36, "O7", "I am quick to understand things.", "O"),
  r(37, "E8", "I don't like to draw attention to myself.", "E"),
  n(38, "A8", "I take time out for others.", "A"),
  r(39, "C8", "I shirk my duties.", "C"),
  r(40, "S8", "I become overwhelmed by events.", "S"),
  n(41, "O8", "I prefer variety to routine.", "O"),
  n(42, "E9", "I don't mind being the center of attention.", "E"),
  n(43, "A9", "I feel others' emotions.", "A"),
  check(44, "CHK2", 'For this statement, please select "Very inaccurate".', 1),
  n(45, "C9", "I follow a schedule.", "C"),
  r(46, "S9", "I get irritated easily.", "S"),
  n(47, "O9", "I spend time reflecting on things.", "O"),
  r(48, "E10", "I am quiet around strangers.", "E"),
  n(49, "A10", "I make people feel at ease.", "A"),
  n(50, "C10", "I am exacting in my work.", "C"),
  r(51, "S10", "I fear for the worst.", "S"),
  n(52, "O10", "I am full of ideas.", "O"),
];

export const ITEMS_PER_PAGE = 10;
export const PAGE_COUNT = Math.ceil(ITEMS.length / ITEMS_PER_PAGE);

/** Instructie bovenaan elke pagina. */
export const PAGE_INSTRUCTION = "Describe yourself as you generally are now, not as you wish to be in the future.";

/** Antwoordknoppen. */
export const ANSWER_OPTIONS = [
  { value: 1, label: "Very inaccurate" },
  { value: 2, label: "Moderately inaccurate" },
  { value: 3, label: "Neither accurate nor inaccurate" },
  { value: 4, label: "Moderately accurate" },
  { value: 5, label: "Very accurate" },
] as const;

// ---------------------------------------------------------------------------
// Introscherm (exacte tekst)
// ---------------------------------------------------------------------------

/** Alleen voor developers, bovenaan. */
export const DEVELOPER_INTRO_SENTENCE = "This is optional. Not completing it has no consequences for your role.";

export const INTRO_TITLE = "Welcome to your Working Style Profile";
export const INTRO_LEAD =
  "This short questionnaire helps you understand how you like to work. It also helps the companies you work with understand how to get the best out of you.";

/** The placeholder in the last bullet, replaced by a link to NEXT_PUBLIC_PRIVACY_URL. */
export const PRIVACY_PLACEHOLDER = "[link to privacy statement]";

export const INTRO_SECTIONS: readonly { heading: string; bullets: readonly string[] }[] = [
  {
    heading: "What to expect",
    bullets: [
      "52 short statements, about 10 minutes.",
      "For each statement, choose how well it describes you.",
      "Your answers are saved as you go, so you can take a break and continue later.",
    ],
  },
  {
    heading: "How to answer",
    bullets: [
      "There are no right or wrong answers. Every personality has its own strengths.",
      "Describe yourself as you generally are now, not as you would like to be.",
      "Go with your first instinct. Don't overthink it.",
      "Answer honestly. An accurate profile helps you end up in a team that fits you. A few control statements check that answers are given with care.",
    ],
  },
  {
    heading: "What happens with your results",
    bullets: [
      "You see your own report first, and you can download it as a PDF.",
      "Your profile is never shared with a client company unless you tick the box for that company yourself. You can withdraw your permission at any time.",
      "This is not a pass or fail test, and it is never the only basis for a decision.",
      `We keep your results for 4 weeks after your application process ends, or up to 1 year if you agreed to stay in our talent pool. You can delete your profile yourself at any time. Read our privacy statement ${PRIVACY_PLACEHOLDER}.`,
    ],
  },
];

export const INTRO_CHECKBOX = "I have read this and want to start.";
export const INTRO_BUTTON = "Start";

// ---------------------------------------------------------------------------
// Vacature
// ---------------------------------------------------------------------------

/** Added to the vacancy text that goes out when the vacancy has the profile on. */
export const VACANCY_SENTENCE =
  "As part of the process, shortlisted candidates are invited to complete a short working style questionnaire (about 10 minutes). You always see your own results first.";

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

export const REPORT_TITLE = "Working Style Profile";
export const DOWNLOAD_PDF = "Download PDF";

export const PERSON_INTRO = {
  heading: "About your report",
  body: "This report describes your working style on five dimensions. Each score runs from 0 to 100 and shows where you are on the scale between two sides. 50 is the middle. A score is not a grade: a low score is not worse than a high score. Both sides of every scale have their own strengths and their own watch outs. The report is based only on your own answers, so it shows how you see yourself. Use it to reflect, and to talk with your team about how you work best.",
} as const;

/** [first name] is filled in by clientIntro(). */
export const CLIENT_INTRO_TEMPLATE = {
  heading: "How to read this profile",
  body: "This profile shows how [first name] describes their own working style on five dimensions. Each score runs from 0 to 100 and shows a position on the scale between two sides, with 50 as the middle. There is no good or bad score: each side brings different strengths and different points of attention. Use the profile to understand how to get the best out of [first name] and as a starting point for a conversation about collaboration and onboarding. It does not measure skills or performance and should never be the only basis for a decision. [first name] has seen this report and chose to share it with you.",
} as const;

export const SCORE_TOOLTIP =
  "This score shows where your answers fall on the scale between the two sides. It is not a percentage of correct answers and not a grade.";

export const REPORT_FOOTER =
  "This profile is based on the person's own answers. It describes preferences and working style, not skills or performance. Use it as input for conversation, never as the only basis for a decision. Statements adapted from the International Personality Item Pool (ipip.ori.org), public domain.";

export const COLUMN_LOWER_STRENGTHS = "Strengths of the lower side";
export const COLUMN_HIGHER_STRENGTHS = "Strengths of the higher side";
export const COLUMN_FOR_YOU = "What this means for you";
export const COLUMN_FOR_EMPLOYER = "For the employer";

export type Band = "lower" | "middle" | "higher";

export const BAND_LABELS: Record<Band, string> = {
  lower: "Lower side",
  middle: "Middle",
  higher: "Higher side",
};

export type DimensionText = {
  dimension: Dimension;
  name: string;
  description: string;
  leftLabel: string;
  rightLabel: string;
  lowerStrengths: string;
  higherStrengths: string;
  bands: Record<Band, { forYou: string; forEmployer: string }>;
};

/** Rapportteksten per dimensie, in de volgorde van het rapport. */
export const DIMENSION_TEXTS: readonly DimensionText[] = [
  {
    dimension: "O",
    name: "Openness",
    description: "How much you seek out new ideas and technology.",
    leftLabel: "Practical",
    rightLabel: "Curious",
    lowerStrengths: "Practical, prefers proven solutions, steady in maintenance work.",
    higherStrengths: "Curious, picks up new tech fast, brings fresh ideas.",
    bands: {
      lower: {
        forYou: "You like proven tools and a clear approach. Watch out: new technology can feel like a detour, so give it a fair try.",
        forEmployer: "Strong on stable, well defined work. Explain the why when you introduce new tools or methods.",
      },
      middle: {
        forYou: "You are open to new things when there is a clear reason. You switch easily between exploring and executing.",
        forEmployer: "Flexible: fits both maintenance and new builds. Give clear goals when you ask them to explore.",
      },
      higher: {
        forYou: "You enjoy new ideas and technology. Watch out: not every improvement has to happen now.",
        forEmployer: "Give room to experiment within limits, for example a timeboxed spike. Routine work alone may bore them.",
      },
    },
  },
  {
    dimension: "C",
    name: "Conscientiousness",
    description: "How structured and thorough you work.",
    leftLabel: "Flexible",
    rightLabel: "Structured",
    lowerStrengths: "Flexible, quick to start, comfortable with change.",
    higherStrengths: "Organised, reliable, finishes what they start.",
    bands: {
      lower: {
        forYou: "You work flexibly and move fast. Watch out: loose ends and missing documentation.",
        forEmployer: "Agree on a clear definition of done and use short check ins.",
      },
      middle: {
        forYou: "You are structured when it matters and flexible when needed.",
        forEmployer: "Works well within a normal sprint rhythm. Be clear about priorities.",
      },
      higher: {
        forYou: "You plan, prepare and deliver. Watch out: perfectionism, and stress when specs are unclear.",
        forEmployer: "Reliable on deadlines. Give clear specs and say when good enough is good enough.",
      },
    },
  },
  {
    dimension: "E",
    name: "Extraversion",
    description: "Where you get your energy: from people or from focus.",
    leftLabel: "Focused",
    rightLabel: "Outgoing",
    lowerStrengths: "Focused, independent, strong in async and deep work.",
    higherStrengths: "Energetic, communicative, builds contact quickly.",
    bands: {
      lower: {
        forYou: "You get energy from focused work. Watch out: staying invisible in calls, so share your progress in writing.",
        forEmployer: "Async updates work well. Quiet does not mean disengaged: ask for their view directly in meetings.",
      },
      middle: {
        forYou: "You are comfortable working alone and in a group.",
        forEmployer: "Fits both async teams and meeting heavy teams.",
      },
      higher: {
        forYou: "You get energy from people. Remote work can feel lonely, so plan regular contact with your team.",
        forEmployer: "Involve them in calls and team moments. They can become a bridge between team members.",
      },
    },
  },
  {
    dimension: "A",
    name: "Agreeableness",
    description: "How you balance cooperation and standing your ground.",
    leftLabel: "Direct",
    rightLabel: "Cooperative",
    lowerStrengths: "Direct, critical, guards quality, dares to disagree.",
    higherStrengths: "Cooperative, helpful, creates a good atmosphere.",
    bands: {
      lower: {
        forYou: "You say what you think and guard quality. Watch out: your feedback can come across as harsh.",
        forEmployer: "Valuable in code reviews. Agree together on how feedback is given.",
      },
      middle: {
        forYou: "You can cooperate and also stand your ground.",
        forEmployer: "Balanced between team player and critical reviewer.",
      },
      higher: {
        forYou: "You are helpful and avoid conflict. Watch out: saying yes too quickly, also to unrealistic deadlines.",
        forEmployer: "Ask explicitly: what would you do differently? Make it safe to say no.",
      },
    },
  },
  {
    dimension: "S",
    name: "Emotional stability",
    description: "How you respond to pressure and setbacks at work.",
    leftLabel: "Alert",
    rightLabel: "Calm",
    lowerStrengths: "Alert to risks, careful, takes things seriously.",
    higherStrengths: "Calm, steady under pressure, recovers quickly.",
    bands: {
      lower: {
        forYou: "You notice risks early and care about getting it right. Watch out: pressure can weigh on you, so ask for clarity early.",
        forEmployer: "Give clear priorities and early feedback. Unclear pressure costs them energy.",
      },
      middle: {
        forYou: "You usually stay calm, and you notice when things get tight.",
        forEmployer: "Handles normal work pressure well.",
      },
      higher: {
        forYou: "You stay calm when things go wrong. Watch out: underestimating risks.",
        forEmployer: "Strong during incidents and deadlines. Ask them to name risks out loud.",
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Toestemming, mail, PDF
// ---------------------------------------------------------------------------

/** [client name] is filled in by consentText(). */
export const CONSENT_TEXT_TEMPLATE =
  "I agree that [client name] can view and download my Working Style Profile. I can withdraw this at any time.";

/** Sent to the client contact when a share ends. [first name] is filled in. */
export const WITHDRAWN_MAIL_TEMPLATE =
  "[first name] has withdrawn permission to share their Working Style Profile with you. Please delete any downloaded copies.";

/** On every page of a client PDF. */
export const WATERMARK_TEMPLATE =
  "Shared with [client name] by [full name] on [date of consent]. Confidential. Delete when no longer needed or when consent is withdrawn.";

/** Staff only. */
export const CAUTION_BANNER = "Interpret with caution";

export const PAGE_TITLE_MY_PROFILE = "My working style profile";
export const SEND_BUTTON = "Send working style profile";
export const ASK_PERMISSION_BUTTON = "Ask for permission";
export const DELETE_MY_PROFILE_BUTTON = "Delete my profile";

export const PERSON_MODE_LABELS = {
  follow_vacancy: "Follow vacancy",
  always: "Always",
  never: "Never",
} as const;

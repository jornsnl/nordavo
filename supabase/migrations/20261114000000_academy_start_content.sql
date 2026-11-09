-- Nordavo Academy, the content of the start curriculum (spec Academy:
-- startcurriculum). Fills the courses and modules of
-- 20261112030000_academy_curriculum.sql with lessons and blocks: a video
-- block waiting for a recording, an explanation, and where it fits a
-- knowledge check (three questions), a worksheet, an assignment, tasks with
-- relative deadlines and a notes field. See docs/academy.md, section
-- "Startcurriculum (inhoud)".
--
-- DRAFT CONTENT. The original sources (course structure, HTML courses,
-- policies) were not available; the texts are a first draft for Julius and
-- Floris to check. Places where Nordavo must add a fact or a number say
-- "[Nordavo vult in: ...]" or "[Nordavo to fill in: ...]".
--
-- Idempotent and never overwriting: every row has a stable id derived from
-- its seed key (md5('nordavo-academy-start:' || key)::uuid). A lesson that
-- already exists is skipped together with everything in it, so lessons a
-- manager edited (texts, blocks, tasks, questions, position) stay as they
-- are. Lessons whose module is gone (no seed_key) are skipped. Running
-- public.academy_seed_start_curriculum() again only adds lessons that are
-- missing (for example one that was deleted) and returns how many it added.
--
-- Completion: the video block is required with min 90%, but
-- academy_block_done_video counts a block without a video (or without a
-- file) as done, so it never blocks a lesson until a recording is uploaded.
-- The same goes for the policy documents without a file. Explanation,
-- knowledge check (any attempt), worksheet (submitted), assignment
-- (submitted) and tasks (required instances done; placement-only and shared
-- tasks only count with a placement) are required; notes are optional.
--
-- Courses stay draft and module settings are left alone: Julius publishes
-- the courses after review. Lessons are published, so publishing a course
-- is one step.

create or replace function public.academy_seed_start_curriculum()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_data constant jsonb := $seed$
{
 "documents": {
  "ws-client-5w": {
   "title": "5W-sjabloon: een taak uitschrijven",
   "kind": "worksheet",
   "category": "template",
   "description": "Schrijf een taak uit met wat, waarom, wie, wanneer en waar, plus wanneer hij af is.",
   "fields": [
    {
     "key": "wat",
     "label": "Wat moet er gebeuren?",
     "type": "long_text",
     "help": "Beschrijf het resultaat, niet de oplossing.",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "waarom",
     "label": "Waarom is het nodig?",
     "type": "long_text",
     "help": "Wie heeft er last van, wat levert het op?",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "wie",
     "label": "Wie is erbij betrokken?",
     "type": "long_text",
     "help": "Wie beslist bij twijfel, wie test, wie moet het weten?",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "wanneer",
     "label": "Wanneer moet het af?",
     "type": "short_text",
     "help": "Datum en tijd in Nederlandse tijd. Hard of zacht?",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "waar",
     "label": "Waar staat wat je developer nodig heeft?",
     "type": "long_text",
     "help": "Ontwerp, documentatie, plek in de code, testdata, eerdere tickets.",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "af_als",
     "label": "Wanneer is het af?",
     "type": "long_text",
     "help": "Bijvoorbeeld: werkt voor alle gevallen, er is een test, het staat op de testomgeving.",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-client-decision": {
   "title": "Beslissingsmatrix",
   "kind": "worksheet",
   "category": "decision_matrix",
   "description": "Per soort beslissing: wat mag je developer zelf beslissen?",
   "fields": [
    {
     "key": "technisch",
     "label": "Technische keuzes binnen een taak",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Doe wat gevraagd is",
      "Onderzoek en stel voor",
      "Beslis en meld",
      "Beslis zelf"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "dependency",
     "label": "Een nieuwe library of dependency toevoegen",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Doe wat gevraagd is",
      "Onderzoek en stel voor",
      "Beslis en meld",
      "Beslis zelf"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "database",
     "label": "Iets veranderen aan de database of datastructuur",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Doe wat gevraagd is",
      "Onderzoek en stel voor",
      "Beslis en meld",
      "Beslis zelf"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "deadline",
     "label": "Een deadline verschuiven",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Doe wat gevraagd is",
      "Onderzoek en stel voor",
      "Beslis en meld",
      "Beslis zelf"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "extern",
     "label": "Contact met een externe partij of eindklant",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Doe wat gevraagd is",
      "Onderzoek en stel voor",
      "Beslis en meld",
      "Beslis zelf"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "live",
     "label": "Iets live zetten",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Doe wat gevraagd is",
      "Onderzoek en stel voor",
      "Beslis en meld",
      "Beslis zelf"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "anders",
     "label": "Andere beslissingen en afspraken",
     "type": "long_text",
     "help": "",
     "required": false,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-client-comms": {
   "title": "Communicatieafspraken",
   "kind": "worksheet",
   "category": "template",
   "description": "Welk kanaal voor wat, reactietijden en wat urgent is. Vul het samen met je developer in.",
   "fields": [
    {
     "key": "kanaal_taken",
     "label": "Waar staan taken en beslissingen?",
     "type": "short_text",
     "help": "Bijvoorbeeld Jira of Linear.",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "kanaal_vragen",
     "label": "Waar stel je korte vragen en doe je de check-in?",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "kanaal_urgent",
     "label": "Hoe bereik je elkaar bij iets urgents?",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "reactie_venster",
     "label": "Reactietijd binnen het overlapvenster",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "reactie_buiten",
     "label": "Reactietijd buiten het overlapvenster",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "urgent",
     "label": "Wat is bij jullie urgent?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "vervanger",
     "label": "Wie is het aanspreekpunt als jij er niet bent?",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "opnieuw",
     "label": "Wanneer bespreken jullie de afspraken opnieuw?",
     "type": "date",
     "help": "",
     "required": false,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-client-blocker": {
   "title": "Blokkadeafspraak",
   "kind": "worksheet",
   "category": "blocker_agreement",
   "description": "Wanneer en hoe je developer aan de bel trekt als hij vastzit.",
   "fields": [
    {
     "key": "na_hoelang",
     "label": "Na hoeveel tijd zelf zoeken meldt je developer een blokkade?",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "waar",
     "label": "Waar en bij wie meldt hij het?",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "melding",
     "label": "Wat staat er in de melding?",
     "type": "long_text",
     "help": "Bijvoorbeeld: wat probeer ik, wat heb ik al geprobeerd, wat heb ik nodig.",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "tweede_taken",
     "label": "Welke taken kan je developer altijd oppakken terwijl hij wacht?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "urgent_buiten",
     "label": "Wie mag bij urgentie buiten het overlapvenster gebeld worden?",
     "type": "short_text",
     "help": "",
     "required": false,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-client-30": {
   "title": "30-dagenevaluatie",
   "kind": "worksheet",
   "category": "checklist",
   "description": "Bereid de evaluatie rond dag 30 voor.",
   "fields": [
    {
     "key": "goed",
     "label": "Wat gaat goed? Geef voorbeelden.",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "beter",
     "label": "Wat moet beter? Geef voorbeelden.",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "niveau",
     "label": "Niveau van het werk",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Boven verwachting",
      "Zoals verwacht",
      "Onder verwachting",
      "Weet ik nog niet"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "communicatie",
     "label": "Communicatie",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Boven verwachting",
      "Zoals verwacht",
      "Onder verwachting",
      "Weet ik nog niet"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "zelf",
     "label": "Wat kan ik zelf anders doen?",
     "type": "long_text",
     "help": "Context, tijd, duidelijkheid van taken.",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "twijfel",
     "label": "Twijfel je of de samenwerking past?",
     "type": "choice",
     "help": "Twijfel je, zeg het dan ook tegen Nordavo.",
     "required": true,
     "options": [
      "Nee",
      "Een beetje",
      "Ja"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "vragen",
     "label": "Vragen of punten voor Nordavo",
     "type": "long_text",
     "help": "",
     "required": false,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-client-90": {
   "title": "Review na 90 dagen: voorbereiding",
   "kind": "worksheet",
   "category": "template",
   "description": "Bereid de review na 90 dagen met je developer en Nordavo voor.",
   "fields": [
    {
     "key": "goed",
     "label": "Wat ging goed in de eerste drie maanden?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "beter_developer",
     "label": "Wat kan je developer beter doen?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "beter_zelf",
     "label": "Wat kun jij beter doen?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "zelfstandigheid",
     "label": "Hoe zelfstandig werkt je developer nu?",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Heeft veel hulp nodig",
      "Werkt grotendeels zelfstandig",
      "Werkt zelfstandig en neemt initiatief"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "doelen",
     "label": "Doelen voor de komende drie maanden",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "afspraken",
     "label": "Afspraken die moeten veranderen (overlapvenster, beslissingsruimte, rituelen)",
     "type": "long_text",
     "help": "",
     "required": false,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-client-escalation": {
   "title": "Escalatiematrix",
   "kind": "worksheet",
   "category": "escalation_matrix",
   "description": "Per situatie: los je het zelf op, informeer je Nordavo of schakel je Nordavo in?",
   "fields": [
    {
     "key": "misverstand",
     "label": "Een misverstand over een taak",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Zelf oplossen",
      "Nordavo informeren",
      "Nordavo inschakelen"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "deadline",
     "label": "Een deadline wordt voor de tweede keer gemist",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Zelf oplossen",
      "Nordavo informeren",
      "Nordavo inschakelen"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "kwaliteit",
     "label": "De kwaliteit verbetert niet na feedback",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Zelf oplossen",
      "Nordavo informeren",
      "Nordavo inschakelen"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "onbereikbaar",
     "label": "Je developer is vaak onbereikbaar in het overlapvenster",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Zelf oplossen",
      "Nordavo informeren",
      "Nordavo inschakelen"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "persoonlijk",
     "label": "Je merkt dat er iets persoonlijks speelt",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Zelf oplossen",
      "Nordavo informeren",
      "Nordavo inschakelen"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "incident",
     "label": "Een beveiligingsincident of datalek",
     "type": "choice",
     "help": "Bel Nordavo dan meteen, ook buiten het overlapvenster.",
     "required": true,
     "options": [
      "Zelf oplossen",
      "Nordavo informeren",
      "Nordavo inschakelen"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "aanspreekpunt",
     "label": "Wie is bij jullie het aanspreekpunt voor Nordavo?",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "eigen",
     "label": "Eigen situaties en wat je dan doet",
     "type": "long_text",
     "help": "",
     "required": false,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-dev-escalation": {
   "title": "Escalation matrix",
   "kind": "worksheet",
   "category": "escalation_matrix",
   "description": "For each situation: who do you go to?",
   "fields": [
    {
     "key": "technical",
     "label": "A technical problem I cannot solve within the agreed time",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Solve it myself or with my buddy",
      "Raise it with my manager",
      "Raise it with Nordavo",
      "Raise it with my manager and Nordavo immediately"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "deadline",
     "label": "A deadline will be missed",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Solve it myself or with my buddy",
      "Raise it with my manager",
      "Raise it with Nordavo",
      "Raise it with my manager and Nordavo immediately"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "priorities",
     "label": "Priorities are unclear",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Solve it myself or with my buddy",
      "Raise it with my manager",
      "Raise it with Nordavo",
      "Raise it with my manager and Nordavo immediately"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "hours",
     "label": "I am asked again and again to work far outside my hours, and talking to my manager did not help",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Solve it myself or with my buddy",
      "Raise it with my manager",
      "Raise it with Nordavo",
      "Raise it with my manager and Nordavo immediately"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "leave_pay",
     "label": "A question about leave, pay or my contract",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Solve it myself or with my buddy",
      "Raise it with my manager",
      "Raise it with Nordavo",
      "Raise it with my manager and Nordavo immediately"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "security",
     "label": "A suspected security incident or data leak",
     "type": "choice",
     "help": "",
     "required": true,
     "options": [
      "Solve it myself or with my buddy",
      "Raise it with my manager",
      "Raise it with Nordavo",
      "Raise it with my manager and Nordavo immediately"
     ],
     "min": null,
     "max": null
    },
    {
     "key": "manager",
     "label": "My manager and the channel I use to reach them",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "nordavo",
     "label": "My Nordavo contact and how I reach them",
     "type": "short_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "own",
     "label": "Other situations and what I do then",
     "type": "long_text",
     "help": "",
     "required": false,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "ws-dev-growth": {
   "title": "90-day review: preparation",
   "kind": "worksheet",
   "category": "template",
   "description": "Prepare your 90-day review with your client and Nordavo.",
   "fields": [
    {
     "key": "went_well",
     "label": "What went well in the first three months?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "difficult",
     "label": "What did you find difficult, and what did you learn?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "more",
     "label": "What would you like to do more of, or take ownership of?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "need",
     "label": "What do you need from your client or from Nordavo?",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    },
    {
     "key": "goals",
     "label": "Your goals for the next three months",
     "type": "long_text",
     "help": "",
     "required": true,
     "options": [],
     "min": null,
     "max": null
    }
   ]
  },
  "doc-policy-leave": {
   "title": "Leave Policy",
   "kind": "download",
   "category": "policy",
   "description": "Nordavo Leave Policy. Placeholder: Nordavo uploads the policy here.",
   "fields": []
  },
  "doc-policy-wfh": {
   "title": "Work From Home Policy",
   "kind": "download",
   "category": "policy",
   "description": "Nordavo Work From Home Policy. Placeholder: Nordavo uploads the policy here.",
   "fields": []
  },
  "doc-policy-conduct": {
   "title": "Code of Conduct",
   "kind": "download",
   "category": "policy",
   "description": "Nordavo Code of Conduct. Placeholder: Nordavo uploads the policy here.",
   "fields": []
  },
  "doc-policy-compensation": {
   "title": "Compensation Policy",
   "kind": "download",
   "category": "policy",
   "description": "Nordavo Compensation Policy. Placeholder: Nordavo uploads the policy here.",
   "fields": []
  }
 },
 "lessons": [
  {
   "key": "client-1.1",
   "module": "client-1",
   "position": 1,
   "title": "Hoe de samenwerking werkt: de driehoek",
   "summary": "Wie doet wat tussen jou, je developer en Nordavo, en wat je van Nordavo mag verwachten.",
   "language": "nl",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Julius of Floris legt de driehoek uit: klant, developer en Nordavo. Wat Nordavo doet voor en na de start, de 30-dagengarantie, maandelijkse opzegging en wanneer je Nordavo belt."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Je haalt geen freelancer en geen projectbureau in huis. Je krijgt een developer die voor de lange termijn bij jouw team hoort, alleen werkt hij of zij vanuit India, meestal vanuit Bangalore. Nordavo zit ernaast. Die drie samen noemen we de driehoek.</p><h2>De drie kanten</h2><ul><li><strong>Jij (de klant)</strong> bepaalt wat er gebouwd wordt, geeft prioriteiten, zorgt voor context en toegang, en geeft feedback. Je stuurt de developer zoals je een collega in je eigen team stuurt.</li><li><strong>De developer</strong> werkt dagelijks in jouw team, binnen jouw tools en processen, en is aanspreekbaar op zijn of haar werk.</li><li><strong>Nordavo</strong> heeft de developer gevonden en geselecteerd, regelt het contract, de verloning en het verlof, en houdt de samenwerking gezond: met een maandgesprek, een korte pulse elke twee weken en een review na 90 dagen.</li></ul><h2>Wat Nordavo wel en niet doet</h2><p>Nordavo is geen tussenlaag in je dagelijkse werk. Je hoeft taken niet via ons te sturen en wij lezen niet mee in je tickets. Wij zijn er voor alles rond de samenwerking:</p><ul><li>Je weet niet goed hoe je iets aankaart, of een gesprek loopt vast.</li><li>Je wilt verlof afstemmen of een feestdag inplannen.</li><li>Er schuurt iets dat je niet in één gesprek oplost.</li><li>Je wilt uitbreiden, of juist stoppen.</li></ul><h2>Afspraken die je moet kennen</h2><ul><li><strong>30 dagen garantie.</strong> Past het binnen de eerste 30 dagen echt niet, dan zoekt Nordavo een oplossing. [Nordavo vult in: de exacte voorwaarden van de garantie.]</li><li><strong>Maandelijkse opzegging.</strong> Je zit niet vast aan een lang contract. [Nordavo vult in: opzegtermijn en hoe je opzegt.]</li><li><strong>Overlapvenster.</strong> Je spreekt een vast blok per dag af waarin jullie allebei online zijn. Daarover gaat de volgende les.</li><li><strong>Escalatie via Nordavo.</strong> Loopt iets vast, dan bel je ons. Niet pas na drie maanden, maar zodra je merkt dat je er zelf niet uitkomt.</li></ul><h2>Waarom dit werkt</h2><p>De driehoek maakt het makkelijker om dingen bespreekbaar te maken. Een developer in India zegt niet snel tegen een klant dat iets niet goed gaat, maar wel tegen Nordavo. En jij hoeft niet in je eentje uit te zoeken hoe je een cultuurverschil overbrugt.</p><blockquote><p>Behandel je developer als teamgenoot, en Nordavo als de partner die de samenwerking gezond houdt.</p></blockquote><p>Je Nordavo-contactpersoon staat op je plaatsingspagina in de Academy. [Nordavo vult in: reactietijd van Nordavo bij vragen en bij escalaties.]</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Bij wie leg je de taken van je developer neer?",
       "options": [
        "Bij Nordavo, die geeft ze door",
        "Rechtstreeks bij de developer, zoals bij een collega",
        "In een gedeeld document dat Nordavo beheert"
       ],
       "correct_index": 1,
       "explanation": "Je stuurt je developer zelf aan, net als iedere andere collega. Nordavo is er voor de samenwerking eromheen, niet voor het dagelijkse werk."
      },
      {
       "question": "Wanneer neem je contact op met Nordavo?",
       "options": [
        "Pas na de review van 90 dagen",
        "Alleen als je wilt opzeggen",
        "Zodra je merkt dat je er samen met je developer niet uitkomt"
       ],
       "correct_index": 2,
       "explanation": "Hoe eerder, hoe makkelijker het op te lossen is. Nordavo is er juist voor de dingen die je niet in één gesprek oplost."
      },
      {
       "question": "Welke van deze regelt Nordavo en niet jij?",
       "options": [
        "Prioriteiten in de sprint",
        "Contract, verloning en verlof van de developer",
        "Code reviews"
       ],
       "correct_index": 1,
       "explanation": "Nordavo regelt contract, verloning en verlof. Prioriteiten en reviews horen bij jouw team."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Wat wil je als eerste met je Nordavo-contactpersoon afstemmen?"
     }
    }
   ]
  },
  {
   "key": "client-1.2",
   "module": "client-1",
   "position": 2,
   "title": "Tijdzones en het overlapvenster",
   "summary": "Het tijdsverschil met India, wanneer het verandert en hoe je een overlapvenster kiest dat werkt.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Uitleg tijdsverschil NL en India (3,5 of 4,5 uur), zomertijd, en hoe je samen het overlapvenster kiest. Laat een voorbeeldagenda zien."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Je developer werkt in India Standard Time (IST). India kent geen zomertijd, Nederland wel. Daardoor verschuift het verschil twee keer per jaar.</p><h2>Het tijdsverschil</h2><ul><li><strong>Wintertijd in Nederland</strong> (eind oktober tot eind maart): India is <strong>4,5 uur</strong> later. 09:00 in Amsterdam is 13:30 in Bangalore.</li><li><strong>Zomertijd in Nederland</strong> (eind maart tot eind oktober): India is <strong>3,5 uur</strong> later. 09:00 in Amsterdam is 12:30 in Bangalore.</li></ul><p>Je developer begint de dag dus eerder dan jij. Dat is een voordeel: als jij om 09:00 begint, heeft je developer er al een paar uur werk op zitten.</p><h2>Wat is het overlapvenster</h2><p>Het overlapvenster is een vast blok per werkdag waarin jullie allebei online en bereikbaar zijn. In dat blok plan je calls, beantwoord je vragen snel en los je blokkades op. Buiten het venster werkt je developer zelfstandig.</p><p>Een veelgebruikt venster is de Nederlandse ochtend, bijvoorbeeld 09:00 tot 13:00. Voor je developer is dat de middag. Het venster staat op je plaatsingspagina.</p><h2>Een goed venster kiezen</h2><ul><li>Kies minstens een paar uur per dag, elke werkdag op dezelfde tijd.</li><li>Leg je vaste teammomenten (stand-up, planning) in het venster.</li><li>Houd rekening met de wisseling naar zomer- of wintertijd: blijft het venster in Nederlandse tijd gelijk, dan schuift het voor je developer een uur op. Bespreek dat een week van tevoren.</li><li>Spreek af wat er gebeurt als jij een keer niet in het venster kunt: wie is dan het aanspreekpunt?</li></ul><h2>Valkuilen</h2><ul><li><strong>Late calls.</strong> Een call om 16:00 Nederlandse tijd is 20:30 in India. Een keer kan, structureel niet.</li><li><strong>Alles via chat buiten het venster.</strong> Je developer leest het pas de volgende ochtend, en jij wacht op antwoord. Schrijf berichten zo dat ze zonder vraag terug uit te voeren zijn (daarover gaat module 3).</li><li><strong>Geen vervanger.</strong> Ben jij op vakantie, wijs dan iemand aan die in het venster bereikbaar is.</li></ul><blockquote><p>Het overlapvenster is jullie gedeelde kantoor. Behandel het als een afspraak, niet als iets wat je erbij doet.</p></blockquote>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Het is januari en 10:00 in Amsterdam. Hoe laat is het in Bangalore?",
       "options": [
        "13:30",
        "14:30",
        "12:30"
       ],
       "correct_index": 1,
       "explanation": "In de Nederlandse wintertijd is India 4,5 uur later. 10:00 wordt dus 14:30."
      },
      {
       "question": "Waarom verandert het tijdsverschil twee keer per jaar?",
       "options": [
        "Omdat India zomertijd heeft en Nederland niet",
        "Omdat Nederland zomertijd heeft en India niet",
        "Omdat het overlapvenster elk kwartaal wordt aangepast"
       ],
       "correct_index": 1,
       "explanation": "India kent geen zomertijd. Als Nederland een uur verzet, wordt het verschil 3,5 uur (zomer) of 4,5 uur (winter)."
      },
      {
       "question": "Wat hoort er in het overlapvenster?",
       "options": [
        "Calls, snelle vragen en het oplossen van blokkades",
        "Al het werk van de developer",
        "Alleen het maandgesprek met Nordavo"
       ],
       "correct_index": 0,
       "explanation": "In het venster zijn jullie allebei bereikbaar. Daar plan je samenwerking; buiten het venster werkt je developer zelfstandig."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Zet het overlapvenster als terugkerende afspraak in je agenda",
       "description": "Elke werkdag, in Nederlandse tijd. Zet de tijd in India in de beschrijving.",
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Spreek met je team af wie het aanspreekpunt is als jij niet in het venster kunt",
       "description": "Bijvoorbeeld bij vakantie of een dag vol afspraken.",
       "deadline_offset_days": 0,
       "shared": true,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Zet een herinnering in je agenda voor de wisseling van zomer- naar wintertijd en terug",
       "description": "Een week ervoor: bespreek of het venster gelijk blijft.",
       "deadline_offset_days": 6,
       "shared": false,
       "placement_only": false,
       "required": false
      }
     ]
    }
   ]
  },
  {
   "key": "client-1.3",
   "module": "client-1",
   "position": 3,
   "title": "De eerste week voorbereiden",
   "summary": "Toegang, een buddy en een eerste taak: zo staat alles klaar als je developer begint.",
   "language": "nl",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Wat je klaarzet voor dag 1: accounts, toegang, buddy, eerste taak, welkomstbericht. Voorbeelden van wat vaak misgaat."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>De eerste dag bepaalt veel. Een developer die op dag 1 nog geen toegang heeft, zit een dag stil, ver weg, en durft dat vaak niet te zeggen. Zorg dat alles klaarstaat voordat de startdatum er is.</p><h2>Toegang en accounts</h2><p>Maak een lijst van alles wat een nieuwe collega bij jou nodig heeft, en regel het vóór dag 1:</p><ul><li>Mailadres en chat (Slack, Teams of wat je gebruikt), en toegang tot de juiste kanalen.</li><li>Repository, CI/CD en de omgevingen waar de developer in moet werken.</li><li>Projectmanagement (Jira, Linear, Trello) en de documentatie.</li><li>VPN, wachtwoordmanager en tweestapsverificatie.</li><li>Testaccounts en testdata. Gebruik geen echte klantgegevens als het niet nodig is.</li></ul><p>Test de toegang als het kan van tevoren, bijvoorbeeld met een korte call voor de start.</p><h2>Een buddy</h2><p>Wijs iemand in je team aan als buddy: de persoon bij wie je developer terecht kan met kleine vragen (\"waar staat dit?\", \"hoe werkt de release?\"). Dat ben jij liever niet zelf: een developer stelt een collega makkelijker een vraag dan zijn manager.</p><h2>Een eerste taak</h2><p>Zet een kleine, echte taak klaar die in de eerste dagen af kan: een bug, een kleine verbetering, een test die ontbreekt. Doel is dat je developer de hele weg een keer aflegt: code ophalen, bouwen, wijzigen, review, live. Schrijf de taak uit volgens het 5W-sjabloon uit module 4.</p><h2>Een welkom</h2><ul><li>Stuur vóór dag 1 een kort welkomstbericht met de planning van de eerste dag.</li><li>Stel je developer op dag 1 voor aan het team, met camera aan.</li><li>Vertel wat jullie bedrijf doet, voor wie, en waarom het werk van de developer ertoe doet.</li></ul><h2>Checklist voor de start</h2><ol><li>Alle accounts aangevraagd en getest.</li><li>Buddy aangewezen en geïnformeerd.</li><li>Eerste taak uitgeschreven.</li><li>Kick-off op dag 1 in de agenda, binnen het overlapvenster.</li><li>Overlapvenster en rituelen in de agenda (zie module 2).</li></ol><p>Lukt iets niet op tijd, bijvoorbeeld een laptop of een account dat via IT moet? Laat het Nordavo weten, dan stemmen wij de start af met de developer.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wat is het doel van de eerste taak?",
       "options": [
        "Testen hoe snel de developer is",
        "De hele weg een keer afleggen: code, review en live",
        "Een groot onderdeel opleveren in de eerste week"
       ],
       "correct_index": 1,
       "explanation": "Een kleine, echte taak laat je developer het hele proces doorlopen. Daarna gaat alles sneller."
      },
      {
       "question": "Waarom is de buddy liever niet de manager?",
       "options": [
        "Omdat de manager geen tijd heeft",
        "Omdat een developer een collega makkelijker een kleine vraag stelt",
        "Omdat de buddy ook de beoordeling doet"
       ],
       "correct_index": 1,
       "explanation": "Zeker in een hiërarchische cultuur stelt iemand een kleine vraag eerder aan een collega dan aan de baas."
      },
      {
       "question": "Op dag 1 werkt de VPN-toegang nog niet. Wat is het risico?",
       "options": [
        "Geen, de developer meldt het meteen",
        "De developer zit stil en zegt dat misschien niet",
        "De developer regelt het zelf wel"
       ],
       "correct_index": 1,
       "explanation": "Op afstand valt stilzitten niet op, en veel developers melden een probleem niet uit beleefdheid. Regel toegang vooraf en vraag ernaar."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Vraag alle accounts en toegang aan voor je developer",
       "description": "Mail, chat, repository, omgevingen, projecttool, VPN. Test ze waar mogelijk vóór de start.",
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Wijs een buddy aan in je team",
       "description": "De vaste persoon voor kleine vragen in de eerste weken.",
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Zet de eerste taak klaar, uitgeschreven volgens het 5W-sjabloon",
       "description": null,
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Plan de kick-off op dag 1 binnen het overlapvenster",
       "description": "Met camera aan, met het team erbij.",
       "deadline_offset_days": 0,
       "shared": true,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "client-2.1",
   "module": "client-2",
   "position": 1,
   "title": "Dag 1 en week 1",
   "summary": "Hoe een goede eerste dag en week eruitzien, en waar je op let.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Een goede eerste dag en week, stap voor stap. Wat je doet als iets niet loopt."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>In de eerste week bouw je twee dingen op: de basis om te werken en het vertrouwen om vragen te stellen. Het tweede is net zo belangrijk als het eerste.</p><h2>Dag 1</h2><ul><li><strong>Kick-off met camera aan.</strong> Stel jezelf en het team voor. Vertel wat het bedrijf doet en waar de developer aan gaat werken.</li><li><strong>Rondleiding door het product.</strong> Laat zien wat de gebruiker ziet, niet alleen de code.</li><li><strong>Toegang controleren.</strong> Loop samen na of alle accounts werken. Vraag concreet: \"Kun je de repository bouwen?\" in plaats van \"Werkt alles?\".</li><li><strong>De eerste taak bespreken.</strong> Laat je developer in eigen woorden terugvertellen wat de taak is.</li><li><strong>Afspraken over het ritme.</strong> Wanneer is de check-in, wanneer de review? Zie de volgende les.</li></ul><h2>Week 1</h2><ul><li>Elke dag een korte check-in in het overlapvenster.</li><li>De eerste taak gaat door de review en het liefst live.</li><li>De buddy loopt een keer mee door de manier van werken: branches, reviews, releases.</li><li>Op vrijdag een eerste terugblik: wat ging goed, wat was onduidelijk, wat heb je nodig?</li></ul><h2>Waar je op let</h2><ul><li><strong>Stilte.</strong> Hoor je weinig, vraag dan zelf. Stilte betekent vaak niet dat alles goed gaat, maar dat iemand vastzit en dat niet wil laten merken.</li><li><strong>\"Ja\" dat geen ja is.</strong> \"Yes, I understand\" kan betekenen \"ik heb je gehoord\". Vraag om een samenvatting of een voorstel.</li><li><strong>Te lange dagen.</strong> Een nieuwe developer wil graag laten zien wat hij kan en werkt soms tot laat. Zeg dat je dat niet verwacht.</li></ul><h2>Als iets niet loopt</h2><p>Kleine dingen los je samen op. Merk je in week 1 al dat er iets fundamenteels niet klopt, bijvoorbeeld in niveau of in communicatie, meld het dan meteen bij Nordavo. Juist in de eerste 30 dagen kunnen we nog veel bijsturen.</p><h2>In het kort</h2><ul><li>Dag 1: kick-off met camera, rondleiding, toegang testen, eerste taak laten terugvertellen.</li><li>Week 1: elke dag een check-in, de eerste taak live, een terugblik op vrijdag.</li><li>Let op stilte, op \"ja\" zonder resultaat en op lange dagen.</li><li>Twijfel je aan iets fundamenteels? Bel Nordavo in de eerste weken, niet pas na een maand.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Je vraagt \"Is alles duidelijk?\" en je developer zegt \"Yes\". Wat doe je?",
       "options": [
        "Je gaat door, het is duidelijk",
        "Je vraagt de developer de taak in eigen woorden samen te vatten",
        "Je stuurt de vraag nog eens per mail"
       ],
       "correct_index": 1,
       "explanation": "Een samenvatting laat zien of het echt duidelijk is. \"Yes\" betekent vaak alleen dat de vraag gehoord is."
      },
      {
       "question": "Je hoort twee dagen niets van je developer. Wat is de meest waarschijnlijke reden?",
       "options": [
        "Alles gaat goed",
        "De developer zit vast en wil dat niet laten merken",
        "De developer is op vakantie"
       ],
       "correct_index": 1,
       "explanation": "Stilte is in de eerste weken vaak een teken dat iemand vastzit. Vraag er zelf naar."
      },
      {
       "question": "Wanneer meld je een fundamenteel probleem bij Nordavo?",
       "options": [
        "Na de review van 90 dagen",
        "Meteen, ook als het in week 1 is",
        "Pas als het drie keer is gebeurd"
       ],
       "correct_index": 1,
       "explanation": "In de eerste 30 dagen kan Nordavo nog veel bijsturen. Hoe eerder je het meldt, hoe beter."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Houd de kick-off op dag 1 met camera aan",
       "description": null,
       "deadline_offset_days": 0,
       "shared": true,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Laat de eerste taak door review gaan en het liefst live",
       "description": null,
       "deadline_offset_days": 4,
       "shared": true,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Doe op vrijdag van week 1 een korte terugblik met je developer",
       "description": "Wat ging goed, wat was onduidelijk, wat is nodig?",
       "deadline_offset_days": 4,
       "shared": false,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "client-2.2",
   "module": "client-2",
   "position": 2,
   "title": "Het ritme: weekplan, check-in en vrijdagreview",
   "summary": "De vaste momenten die de samenwerking dragen, en wat Nordavo daarnaast doet.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: De rituelen: weekplan op maandag, dagelijkse check-in, review op vrijdag, maandgesprek met Nordavo, pulse en de review na 90 dagen."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Op afstand gebeurt niets vanzelf. Je loopt niet even langs en je ziet niet aan iemands gezicht dat het niet lekker gaat. Een vast ritme vangt dat op. Het kost weinig tijd en het voorkomt veel.</p><h2>De vaste momenten</h2><ul><li><strong>Weekplan (maandag).</strong> Je developer stuurt aan het begin van de week wat hij of zij deze week wil afronden. Jij bevestigt of stuurt bij. Zo weten jullie allebei wat de prioriteit is.</li><li><strong>Check-in (dagelijks).</strong> Kort, in het overlapvenster of schriftelijk: wat is af, wat is het volgende, waar zit ik vast. Vijf tot vijftien minuten is genoeg.</li><li><strong>Review (vrijdag).</strong> Wat is er gedaan tegenover het weekplan, wat ging goed, wat kan beter. Dit is ook het moment om feedback te geven.</li><li><strong>Maandgesprek met Nordavo.</strong> Nordavo spreekt elke maand met jou en met je developer over hoe het gaat.</li></ul><h2>Wat Nordavo daarnaast doet</h2><ul><li><strong>Pulse elke twee weken.</strong> Jij en je developer krijgen een korte vraag: hoe gaat het, op een schaal van 1 tot 10, wat gaat goed, wat schuurt. De scores ziet alleen Nordavo. Zo vangen we signalen op voordat ze groot worden.</li><li><strong>Review na 90 dagen.</strong> Een vast moment om samen terug en vooruit te kijken. Daarover gaat module 7.</li></ul><h2>Hoe je het ritme vasthoudt</h2><ul><li>Zet alles als terugkerende afspraak in de agenda, binnen het overlapvenster.</li><li>Laat een check-in niet vallen omdat het druk is. Maak hem korter, maar laat hem staan.</li><li>Schrijf het weekplan en de review op een vaste plek, zodat je terug kunt kijken.</li><li>De rituelen staan ook op je plaatsingspagina in de Academy, waar je ze kunt afvinken.</li></ul><h2>Als het ritme wringt</h2><p>Is de dagelijkse check-in na een paar maanden overbodig, omdat je developer al in jullie stand-up zit? Prima, dan vervangt de stand-up de check-in. Het gaat om het doel: elke dag weten waar je staat en wat er in de weg zit.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wat is het doel van het weekplan op maandag?",
       "options": [
        "Uren registreren",
        "Samen vastleggen wat deze week de prioriteit is",
        "De planning van Nordavo bijwerken"
       ],
       "correct_index": 1,
       "explanation": "Het weekplan zorgt dat jullie allebei weten wat er deze week af moet."
      },
      {
       "question": "Wie ziet de scores van de pulse?",
       "options": [
        "Iedereen in het team",
        "Alleen Nordavo",
        "Alleen de klantbeheerder"
       ],
       "correct_index": 1,
       "explanation": "De scores ziet alleen Nordavo. Zo kunnen jij en je developer eerlijk antwoorden."
      },
      {
       "question": "Het is een drukke week. Wat doe je met de dagelijkse check-in?",
       "options": [
        "Overslaan tot het rustiger is",
        "Korter maken, maar laten staan",
        "Vervangen door een mail aan het eind van de week"
       ],
       "correct_index": 1,
       "explanation": "Juist in drukke weken raakt iemand op afstand snel uit beeld. Een korte check-in is beter dan geen."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Zet het weekplan (maandag), de check-in (dagelijks) en de review (vrijdag) als terugkerende afspraken in je agenda",
       "description": null,
       "deadline_offset_days": 2,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Spreek met je developer af waar het weekplan en de review worden opgeschreven",
       "description": "Bijvoorbeeld een vast kanaal of document.",
       "deadline_offset_days": 4,
       "shared": true,
       "placement_only": true,
       "required": true
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Welke vaste momenten heb je al in je team, en hoe passen de rituelen daarin?"
     }
    }
   ]
  },
  {
   "key": "client-2.3",
   "module": "client-2",
   "position": 3,
   "title": "De 30-dagengarantie en je eerste evaluatie",
   "summary": "Wat de garantie betekent en hoe je na 30 dagen eerlijk evalueert.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: De 30-dagengarantie: wat ze inhoudt en hoe je evalueert. Hoe Nordavo het gesprek begeleidt."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Na 30 dagen kijk je samen met Nordavo of de samenwerking werkt. Dat is geen formaliteit: het is het moment waarop je nog makkelijk kunt bijsturen.</p><h2>Wat de garantie inhoudt</h2><p>Nordavo staat in voor de match in de eerste 30 dagen. Blijkt in die periode dat de developer niet past, dan zoekt Nordavo een oplossing. [Nordavo vult in: de exacte voorwaarden, bijvoorbeeld kosteloos vervangen of stoppen, en vanaf wanneer de 30 dagen tellen.]</p><p>Belangrijk: de garantie werkt alleen als je op tijd aan de bel trekt. Wacht dus niet tot dag 29 met een probleem dat je in week 2 al zag.</p><h2>Eerlijk evalueren</h2><p>Kijk niet alleen naar snelheid. Een developer die net begint in een onbekende codebase, met een nieuw team en een andere cultuur, levert in de eerste weken minder dan later. Kijk naar de richting:</p><ul><li><strong>Niveau.</strong> Is de kwaliteit van het werk goed, ook als het nog niet snel gaat?</li><li><strong>Leren.</strong> Worden fouten niet twee keer gemaakt? Wordt feedback opgepakt?</li><li><strong>Communicatie.</strong> Weet je waar je developer staat? Meldt hij of zij blokkades?</li><li><strong>Houding.</strong> Neemt je developer initiatief, stelt hij vragen, denkt hij mee?</li><li><strong>Jij zelf.</strong> Heb je genoeg context en tijd gegeven? Was de eerste taak duidelijk?</li></ul><h2>Het gesprek</h2><p>Rond dag 30 plant Nordavo een evaluatie. Bereid je voor met het werkblad hieronder. In het gesprek:</p><ol><li>Vertel wat goed gaat, concreet en met voorbeelden.</li><li>Vertel wat beter moet, ook concreet.</li><li>Vraag hoe je developer de eerste maand heeft ervaren.</li><li>Spreek af wat jullie de komende twee maanden anders doen.</li></ol><p>Twijfel je, zeg het dan tegen Nordavo, ook als je het lastig vindt. Twijfel uitspreken is geen afwijzing; het is de start van een oplossing.</p><h2>In het kort</h2><ul><li>De garantie werkt het best als je problemen meteen meldt.</li><li>Beoordeel de richting, niet alleen de snelheid.</li><li>Kijk ook naar je eigen rol: context, tijd en duidelijke taken.</li><li>Bereid het gesprek voor met het werkblad, en spreek af wat jullie de komende twee maanden anders doen.</li><li>Twijfel uitspreken is het begin van een oplossing, geen afwijzing.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wanneer meld je een probleem dat je in week 2 ziet?",
       "options": [
        "Op dag 30, in de evaluatie",
        "Meteen, dan werkt de garantie het best",
        "Pas als het na de evaluatie nog speelt"
       ],
       "correct_index": 1,
       "explanation": "Hoe eerder Nordavo het weet, hoe meer ruimte er is om bij te sturen binnen de 30 dagen."
      },
      {
       "question": "Waar kijk je in de eerste 30 dagen vooral naar?",
       "options": [
        "Alleen naar snelheid",
        "Naar de richting: niveau, leren, communicatie en houding",
        "Naar het aantal uren"
       ],
       "correct_index": 1,
       "explanation": "In een nieuwe codebase gaat het eerst langzamer. De richting zegt meer dan de snelheid."
      },
      {
       "question": "Waarom kijk je in de evaluatie ook naar jezelf?",
       "options": [
        "Omdat Nordavo dat verplicht",
        "Omdat context, tijd en duidelijke taken van jou bepalen hoe goed je developer kan werken",
        "Dat hoeft niet"
       ],
       "correct_index": 1,
       "explanation": "Veel problemen in de eerste maand komen door te weinig context of onduidelijke taken. Die kun jij oplossen."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Werkblad: 30-dagenevaluatie",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-client-30"
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Vul het werkblad 30-dagenevaluatie in",
       "description": null,
       "deadline_offset_days": 24,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Plan het evaluatiegesprek rond dag 30 met je developer en Nordavo",
       "description": null,
       "deadline_offset_days": 21,
       "shared": true,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "client-3.1",
   "module": "client-3",
   "position": 1,
   "title": "Schrijven dat in één keer landt",
   "summary": "Berichten die je developer zonder vraag terug kan uitvoeren.",
   "language": "nl",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Voorbeelden van berichten die wel en niet werken, met een herschreven versie."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Een groot deel van jullie samenwerking is geschreven: chat, tickets, reviews. En vaak leest je developer je bericht op een moment dat jij niet online bent. Een onduidelijk bericht kost dan geen vijf minuten, maar een halve dag.</p><h2>Wat maakt een bericht duidelijk</h2><ul><li><strong>Context eerst.</strong> Waarom vraag je dit? Wat is het probleem voor de gebruiker?</li><li><strong>Eén vraag per bericht.</strong> Twee vragen in één bericht? Dan wordt vaak alleen de eerste beantwoord.</li><li><strong>Concreet.</strong> Niet \"kun je hier even naar kijken?\", maar \"kun je uitzoeken waarom de export bij klanten met meer dan 1.000 regels faalt, en me vóór vrijdag laten weten wat de oorzaak is?\".</li><li><strong>Wat is af.</strong> Hoe weet je developer dat de taak klaar is?</li><li><strong>Een deadline met een tijdzone.</strong> \"Morgen\" is in India al eerder morgen. Schrijf \"donderdag 12:00 Nederlandse tijd\".</li></ul><h2>Vermijd</h2><ul><li><strong>Spreekwoorden en ironie.</strong> \"Dat is een fluitje van een cent\" of \"nou, lekker dan\" komen niet goed over in het Engels, en zeker niet vertaald.</li><li><strong>Afkortingen die alleen jullie kennen.</strong> Schrijf ze de eerste keer uit.</li><li><strong>Halve zinnen.</strong> \"Login kapot?\" kan een vraag zijn, een melding of een verwijt.</li><li><strong>Alleen spraakberichten.</strong> Handig voor jou, lastig om terug te vinden en te begrijpen in een tweede taal.</li></ul><h2>Engels</h2><p>Je developer werkt in het Engels. Je hoeft geen perfect Engels te schrijven, wel eenvoudig Engels: korte zinnen, gewone woorden. Dat begrijpt iedereen.</p><h2>Voorbeeld</h2><p>Niet zo:</p><blockquote><p>Kun je ff naar die bug kijken van gisteren? Moet eigenlijk vandaag nog.</p></blockquote><p>Wel zo:</p><blockquote><p>Customers report that the invoice PDF shows the wrong VAT rate (21% instead of 9%) for food products. Can you find the cause and fix it today? Done means: the PDF shows the correct rate and there is a test for it. I am online until 17:00 Dutch time if you have questions.</p></blockquote><h2>Even checken</h2><p>Bij iets belangrijks: vraag je developer om in eigen woorden terug te schrijven wat hij of zij gaat doen. Dat kost een minuut en voorkomt een dag werk in de verkeerde richting.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Welke deadline is het duidelijkst?",
       "options": [
        "Morgen",
        "Zo snel mogelijk",
        "Donderdag 12:00 Nederlandse tijd"
       ],
       "correct_index": 2,
       "explanation": "Een dag, een tijd en een tijdzone. \"Morgen\" en \"zo snel mogelijk\" betekenen voor iedereen iets anders."
      },
      {
       "question": "Je stuurt drie vragen in één bericht. Wat gebeurt er vaak?",
       "options": [
        "Alle drie worden beantwoord",
        "Alleen de eerste wordt beantwoord",
        "Je developer belt je meteen"
       ],
       "correct_index": 1,
       "explanation": "Eén vraag per bericht is duidelijker en makkelijker te beantwoorden."
      },
      {
       "question": "Waarom vermijd je spreekwoorden en ironie?",
       "options": [
        "Ze zijn onprofessioneel",
        "Ze komen in een tweede taal vaak niet of verkeerd over",
        "Ze zijn te lang"
       ],
       "correct_index": 1,
       "explanation": "Ironie en spreekwoorden zijn lastig in een tweede taal en kunnen verkeerd vallen."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Neem een bericht dat je deze week stuurde. Hoe zou je het nu schrijven?"
     }
    }
   ]
  },
  {
   "key": "client-3.2",
   "module": "client-3",
   "position": 2,
   "title": "Calls, camera en stiltes",
   "summary": "Hoe je een videocall zo inricht dat je weet wat je developer echt denkt.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Een goede call: camera aan, open vragen, ruimte voor stilte, samenvatten. Voorbeelden van vragen die werken."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>In een call hoor je meer dan in een chat, als je het goed aanpakt. Veel Indiase developers zijn opgegroeid in een cultuur waarin je een meerdere niet tegenspreekt en geen slecht nieuws brengt als het niet hoeft. Dat is geen onwil, het is beleefdheid. Jij kunt het makkelijker maken.</p><h2>Camera aan</h2><p>Camera aan maakt het persoonlijk en laat je zien hoe iets valt. Doe het zelf ook, zeker in de eerste maanden. Is de verbinding slecht, spreek dan af dat jullie bij de start en het eind even de camera aanzetten.</p><h2>Open vragen</h2><p>Gesloten vragen (\"Lukt het?\", \"Is het duidelijk?\") krijgen bijna altijd \"ja\". Open vragen geven informatie:</p><ul><li>\"Wat is het lastigste deel van deze taak?\"</li><li>\"Wat heb je nodig om dit vrijdag af te hebben?\"</li><li>\"Welke aanpak zou jij kiezen, en waarom?\"</li><li>\"Wat zou er mis kunnen gaan?\"</li></ul><h2>Stiltes</h2><p>Stel een vraag en wacht. Echt wachten, ook als het even stil is. Wie in een tweede taal praat, heeft even nodig om een antwoord te formuleren. Vul je de stilte zelf, dan hoor je het antwoord nooit.</p><h2>Ruimte voor nee</h2><p>Zeg expliciet dat je tegenspraak wilt horen: \"Als je denkt dat dit een slecht idee is, wil ik dat weten.\" En als je developer dan een keer kritiek geeft: bedank hem of haar. Zo leert iemand dat het veilig is.</p><h2>Afsluiten</h2><ul><li>Laat je developer aan het eind samenvatten wat de afspraken zijn.</li><li>Zet de afspraken daarna in de chat of het ticket.</li><li>Vraag: \"Is er nog iets wat je niet hebt kunnen zeggen?\"</li></ul><h2>Groepscalls</h2><p>In een call met het hele team praat een nieuwe developer op afstand weinig. Geef hem of haar een vaste beurt, bijvoorbeeld in de stand-up, en vraag in grotere overleggen gericht om een mening.</p><h2>Een vaste opbouw voor je check-in</h2><ol><li>Hoe gaat het? (en wacht op een echt antwoord)</li><li>Wat is af sinds gisteren?</li><li>Waar werk je vandaag aan?</li><li>Wat is het lastigste deel, of waar zit je vast?</li><li>Samenvatten: wat spreken we af?</li></ol><p>Na een paar weken weet je developer wat er komt en bereidt hij of zij de antwoorden voor. Dan duurt de check-in vaak niet meer dan tien minuten.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Welke vraag geeft de meeste informatie?",
       "options": [
        "Lukt het?",
        "Is het duidelijk?",
        "Wat is het lastigste deel van deze taak?"
       ],
       "correct_index": 2,
       "explanation": "Een open vraag geeft een echt antwoord. Gesloten vragen krijgen vaak alleen \"ja\"."
      },
      {
       "question": "Je stelt een vraag en het blijft even stil. Wat doe je?",
       "options": [
        "Je herhaalt de vraag in andere woorden",
        "Je wacht",
        "Je geeft zelf alvast een antwoord"
       ],
       "correct_index": 1,
       "explanation": "Iemand die in een tweede taal praat, heeft even tijd nodig. Wacht het antwoord af."
      },
      {
       "question": "Je developer geeft kritiek op je plan. Wat doe je?",
       "options": [
        "Je legt uit waarom je plan klopt",
        "Je bedankt hem en bespreekt de kritiek",
        "Je negeert het, je bent de klant"
       ],
       "correct_index": 1,
       "explanation": "Door kritiek te waarderen, leert je developer dat het veilig is om eerlijk te zijn."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Welke open vragen ga je in je volgende check-in stellen?"
     }
    }
   ]
  },
  {
   "key": "client-3.3",
   "module": "client-3",
   "position": 3,
   "title": "Kanalen en reactietijden afspreken",
   "summary": "Welk kanaal voor wat, hoe snel je antwoord verwacht en wat urgent is.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Afspraken over kanalen en reactietijden, met het werkblad Communicatieafspraken als voorbeeld."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Veel wrijving op afstand komt niet door wat er gezegd wordt, maar door waar en wanneer. De ene manager verwacht binnen tien minuten antwoord in de chat, de andere leest de chat nooit en wil alles in tickets. Leg het vast, dan hoeft niemand te raden.</p><h2>Welk kanaal voor wat</h2><p>Een indeling die vaak werkt:</p><ul><li><strong>Ticket (Jira, Linear):</strong> de taak zelf, de beslissingen erover, de status.</li><li><strong>Chat:</strong> korte vragen, afstemming, de dagelijkse check-in.</li><li><strong>Call:</strong> alles wat ingewikkeld is of waar meningen botsen, en de vaste rituelen.</li><li><strong>Telefoon:</strong> alleen als iets echt urgent is.</li><li><strong>Mail:</strong> formele zaken, zoals verlof of afspraken met Nordavo.</li></ul><h2>Reactietijden</h2><p>Spreek af hoe snel jullie op elkaar reageren, binnen en buiten het overlapvenster. Bijvoorbeeld: in het venster binnen een uur in de chat, buiten het venster de volgende werkdag. Wat jullie kiezen maakt minder uit dan dat jullie het allebei weten.</p><h2>Wat is urgent</h2><p>Spreek af wat urgent is (bijvoorbeeld: productie ligt eruit, een klant kan niet inloggen) en hoe je developer jou dan bereikt. En andersom: mag jij je developer buiten werktijd bellen? Meestal is het antwoord nee, behalve bij afgesproken uitzonderingen.</p><h2>Buiten werktijd</h2><p>Je developer werkt in een andere tijdzone. Een bericht van jou om 17:00 komt in de winter binnen om 21:30 Indiase tijd. Zeg erbij dat het morgen ook goed is, of plan het bericht in. Zo voorkom je dat je developer 's avonds denkt te moeten reageren.</p><h2>Leg het vast</h2><p>Vul met je developer het werkblad Communicatieafspraken in. Bespreek het na een maand opnieuw: werkt het, of moet er iets anders?</p><h2>Voorbeeld van een afspraak</h2><blockquote><p>Taken en beslissingen staan in Linear. Vragen en de check-in doen we in het teamkanaal. In het overlapvenster reageren we binnen een uur, daarbuiten de volgende werkdag. Urgent is: productie ligt eruit of een klant kan niet werken. Dan bel je mij; ben ik er niet, dan bel je Sanne. Na een maand kijken we of dit werkt.</p></blockquote><p>Zo'n afspraak past op een half A4'tje en scheelt veel gedoe. Zet hem op een plek waar jullie hem allebei terugvinden, bijvoorbeeld bovenaan het teamkanaal of in de documentatie.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Waar leg je een beslissing over een taak vast?",
       "options": [
        "In een spraakbericht",
        "In het ticket",
        "In een privéchat"
       ],
       "correct_index": 1,
       "explanation": "In het ticket blijft de beslissing terug te vinden voor iedereen die aan de taak werkt."
      },
      {
       "question": "Je stuurt om 17:00 Nederlandse tijd een vraag. Hoe laat is het dan in de winter in India?",
       "options": [
        "20:30",
        "21:30",
        "13:30"
       ],
       "correct_index": 1,
       "explanation": "In de Nederlandse wintertijd is India 4,5 uur later: 17:00 wordt 21:30. Zeg erbij of het tot morgen kan wachten."
      },
      {
       "question": "Wat is het belangrijkste aan afspraken over reactietijden?",
       "options": [
        "Dat ze zo kort mogelijk zijn",
        "Dat jullie ze allebei kennen",
        "Dat Nordavo ze goedkeurt"
       ],
       "correct_index": 1,
       "explanation": "Welke tijd je kiest maakt minder uit dan dat jullie allebei weten wat je van elkaar mag verwachten."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Werkblad: Communicatieafspraken",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-client-comms"
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Vul samen met je developer het werkblad Communicatieafspraken in",
       "description": null,
       "deadline_offset_days": 6,
       "shared": true,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "client-4.1",
   "module": "client-4",
   "position": 1,
   "title": "Een taak uitschrijven met het 5W-sjabloon",
   "summary": "Wat, waarom, wie, wanneer en waar: een taak die je developer zelfstandig kan oppakken.",
   "language": "nl",
   "minutes": 15,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Het 5W-sjabloon uitgelegd met een echte taak, eerst slecht en dan goed uitgeschreven."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Op afstand kun je niet even bijsturen als iemand de verkeerde kant op gaat. Een goed uitgeschreven taak is daarom het belangrijkste wat je als manager doet. Het 5W-sjabloon helpt je om niets te vergeten.</p><h2>De vijf W's</h2><ul><li><strong>Wat</strong> moet er gebeuren? Beschrijf het resultaat, niet de oplossing. \"Klanten kunnen hun factuur als PDF downloaden\" in plaats van \"maak een knop met een PDF-library\".</li><li><strong>Waarom</strong> is het nodig? Wie heeft er last van, wat levert het op? Met het waarom kan je developer zelf goede keuzes maken.</li><li><strong>Wie</strong> is erbij betrokken? Wie beslist bij twijfel, wie test, wie moet het weten?</li><li><strong>Wanneer</strong> moet het af, en waarom dan? Noem een datum en tijd in Nederlandse tijd, en zeg of het hard of zacht is.</li><li><strong>Waar</strong> staat wat je nodig hebt? Ontwerp, documentatie, de plek in de code, testdata, eerdere tickets.</li></ul><p>Voeg daar altijd aan toe: <strong>wanneer is het af?</strong> Bijvoorbeeld: \"de PDF werkt voor alle facturen, er is een test en het staat op de testomgeving\".</p><h2>Hoeveel detail</h2><p>Hoe nieuwer je developer en hoe groter de taak, hoe meer detail. Na een paar maanden kan een taak korter, omdat je developer de context kent. Maar het waarom en het \"wanneer is het af\" blijven altijd staan.</p><h2>Laat de oplossing open</h2><p>Beschrijf het probleem, niet de oplossing. Je developer is ingehuurd om na te denken. Vraag bij grotere taken eerst om een kort plan: \"Hoe zou je dit aanpakken? Stuur me je voorstel voordat je begint.\"</p><h2>Veelgemaakte fouten</h2><ul><li>Alleen een titel (\"Fix login\").</li><li>Geen waarom, dus kiest je developer de technisch mooiste en niet de handigste oplossing.</li><li>Geen deadline, of \"zo snel mogelijk\".</li><li>Informatie die alleen in jouw hoofd zit.</li></ul><h2>Aan de slag</h2><p>Gebruik het werkblad 5W-sjabloon hieronder en schrijf daarna je eerste echte taak uit in de opdracht. Nordavo kijkt mee en geeft je feedback.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Waarom schrijf je het waarom van een taak op?",
       "options": [
        "Zodat Nordavo kan factureren",
        "Zodat je developer zelf goede keuzes kan maken",
        "Dat hoeft niet, het wat is genoeg"
       ],
       "correct_index": 1,
       "explanation": "Met het waarom kan je developer afwegingen maken die passen bij wat je echt wilt bereiken."
      },
      {
       "question": "Welke beschrijving is beter?",
       "options": [
        "Maak een knop met library X",
        "Klanten kunnen hun factuur als PDF downloaden",
        "Fix PDF"
       ],
       "correct_index": 1,
       "explanation": "Beschrijf het resultaat, niet de oplossing. Dan kan je developer meedenken."
      },
      {
       "question": "Wat voeg je altijd toe aan de vijf W's?",
       "options": [
        "Het aantal uren",
        "Wanneer de taak af is",
        "De naam van de Nordavo-contactpersoon"
       ],
       "correct_index": 1,
       "explanation": "Zonder \"wanneer is het af\" weet niemand wanneer het klaar is."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Werkblad: 5W-sjabloon: een taak uitschrijven",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-client-5w"
    },
    {
     "type": "assignment",
     "title": "Schrijf je eerste taak uit volgens het 5W-sjabloon",
     "required": true,
     "completion": {
      "require": "submitted"
     },
     "content": {
      "prompt": "Kies een echte taak voor je developer, het liefst de eerste taak. Schrijf hem uit met wat, waarom, wie, wanneer en waar, plus wanneer hij af is. Plak de tekst hieronder of lever een link naar het ticket in. Nordavo geeft je feedback.",
      "formats": [
       "text",
       "file",
       "link"
      ]
     }
    }
   ]
  },
  {
   "key": "client-4.2",
   "module": "client-4",
   "position": 2,
   "title": "Beslissingsruimte: wat mag je developer zelf beslissen",
   "summary": "Vier niveaus van beslissingsruimte en een beslissingsmatrix voor je team.",
   "language": "nl",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: De vier niveaus van beslissingsruimte met voorbeelden, en hoe je de beslissingsmatrix invult."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Veel developers uit India zijn gewend dat de manager beslist. In een Nederlands team wordt juist verwacht dat je zelf nadenkt en beslist. Als je niet zegt wat je developer zelf mag beslissen, wacht hij of zij op jou. En jij denkt: waarom pakt hij het niet gewoon op?</p><h2>Vier niveaus</h2><ol><li><strong>Doe wat gevraagd is.</strong> De taak ligt vast, de developer voert uit. Bijvoorbeeld: een tekst aanpassen.</li><li><strong>Onderzoek en stel voor.</strong> De developer zoekt uit wat de opties zijn en doet een voorstel. Jij beslist. Bijvoorbeeld: een nieuwe library kiezen.</li><li><strong>Beslis en meld.</strong> De developer beslist zelf en laat weten wat het is geworden. Bijvoorbeeld: een refactoring binnen een module.</li><li><strong>Beslis zelf.</strong> De developer beslist en hoeft het niet te melden. Bijvoorbeeld: naamgeving, kleine verbeteringen, tests toevoegen.</li></ol><h2>Maak het expliciet</h2><p>Zet per soort beslissing op welk niveau je developer zit. Gebruik daarvoor het werkblad Beslissingsmatrix. Denk aan:</p><ul><li>Technische keuzes binnen een taak.</li><li>Een nieuwe dependency toevoegen.</li><li>Iets aan de database of de datastructuur veranderen.</li><li>Een deadline verschuiven.</li><li>Contact met een externe partij of een eindklant.</li><li>Iets live zetten.</li></ul><h2>Groeien in niveaus</h2><p>Begin voorzichtig en verruim snel. Gaat het een paar keer goed op niveau 2, schuif dan op naar 3. Zeg het hardop: \"Hier hoef je me niet meer voor te vragen.\" Anders blijft je developer vragen, uit voorzichtigheid.</p><h2>Als het misgaat</h2><p>Neemt je developer een beslissing die je anders had genomen? Bespreek het zonder verwijt: wat was de afweging, wat weet je nu? En stel zo nodig het niveau bij. Wie nooit iets fout doet, krijgt te weinig ruimte.</p><h2>Voorbeeld</h2><p>Een developer krijgt een bug in de export. Op niveau 1 vraagt hij voor elke keuze toestemming en ligt de bug drie dagen stil. Op niveau 3 lost hij de bug op, kiest hij zelf de aanpak en schrijft hij in het ticket: \"Opgelost door de query te splitsen; getest met 50.000 regels.\" Dat laatste is meestal wat je wilt.</p><h2>In het kort</h2><ul><li>Zeg per soort beslissing op welk niveau je developer zit.</li><li>Begin voorzichtig, verruim snel en zeg het hardop.</li><li>Fouten horen erbij; stel bij in plaats van te verwijten.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Je developer kiest zelf een library en laat achteraf weten welke het is. Welk niveau is dat?",
       "options": [
        "Doe wat gevraagd is",
        "Onderzoek en stel voor",
        "Beslis en meld"
       ],
       "correct_index": 2,
       "explanation": "Zelf beslissen en daarna melden is niveau 3."
      },
      {
       "question": "Waarom maak je de beslissingsruimte expliciet?",
       "options": [
        "Omdat je developer anders uit voorzichtigheid op jou wacht",
        "Omdat het contractueel moet",
        "Zodat Nordavo het kan controleren"
       ],
       "correct_index": 0,
       "explanation": "Zonder duidelijke ruimte wacht een developer die gewend is aan hiërarchie op de manager."
      },
      {
       "question": "Het gaat een paar keer goed op niveau 2. Wat doe je?",
       "options": [
        "Niets, het werkt",
        "Je zegt hardop dat het voortaan niveau 3 is",
        "Je gaat terug naar niveau 1"
       ],
       "correct_index": 1,
       "explanation": "Verruim de ruimte en zeg het expliciet, anders blijft je developer vragen."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Werkblad: Beslissingsmatrix",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-client-decision"
    }
   ]
  },
  {
   "key": "client-4.3",
   "module": "client-4",
   "position": 3,
   "title": "Blokkades: afspreken wanneer je developer aan de bel trekt",
   "summary": "Een blokkadeafspraak voorkomt dat je developer uren of dagen vastzit.",
   "language": "nl",
   "minutes": 8,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Wat een blokkadeafspraak is, waarom die nodig is en hoe je hem samen maakt."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Een developer die vastzit en het niet zegt, is een van de grootste risico's op afstand. In jouw kantoor zie je iemand fronsen. Op afstand zie je niets, en je developer wil je niet storen met iets wat hij \"zelf zou moeten kunnen\".</p><h2>De blokkadeafspraak</h2><p>Spreek samen af:</p><ul><li><strong>Na hoeveel tijd vastzitten</strong> meldt je developer het. Bijvoorbeeld na een uur zelf zoeken. Kies wat bij jullie werk past.</li><li><strong>Waar en bij wie</strong> je developer het meldt: bij jou, bij de buddy, in een vast kanaal.</li><li><strong>Wat er in de melding staat:</strong> wat probeer ik, wat heb ik al geprobeerd, wat heb ik nodig.</li><li><strong>Wat je developer doet terwijl hij wacht:</strong> een andere taak oppakken, documentatie lezen, tests schrijven.</li></ul><h2>Reageer goed op een melding</h2><p>Hoe je reageert op de eerste melding, bepaalt of er een tweede komt. Bedank je developer, help snel, en vraag niet \"waarom heb je dat niet zelf opgelost?\". Komt dezelfde vraag vaak terug, schrijf het antwoord dan op in de documentatie.</p><h2>Buiten het overlapvenster</h2><p>Zit je developer vast terwijl jij nog slaapt? Dan helpt een lijst met tweede taken die altijd opgepakt kunnen worden, en een afspraak wie er bij urgentie gebeld mag worden.</p><h2>Leg het vast</h2><p>Vul het werkblad Blokkadeafspraak samen in en zet de afspraak ook op een plek waar je developer hem terugvindt.</p><h2>Voorbeeld van een blokkadeafspraak</h2><blockquote><p>Zit je langer dan een uur vast, dan meld je het in het teamkanaal met wat je probeert, wat je al hebt geprobeerd en wat je nodig hebt. Ik of Tom reageren in het overlapvenster binnen een uur. Buiten het venster pak je een taak op van de lijst met tweede taken. Ligt productie eruit, dan bel je mij.</p></blockquote><h2>Waarom het werkt</h2><p>Een vaste afspraak haalt de twijfel weg. Je developer hoeft niet af te wegen of hij je mag storen: de afspraak zegt dat hij het moet doen. Daardoor komen blokkades eerder boven, en dat scheelt jullie allebei tijd en frustratie.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wat staat er in een goede blokkademelding?",
       "options": [
        "Alleen \"I am stuck\"",
        "Wat ik probeer, wat ik al geprobeerd heb en wat ik nodig heb",
        "Een excuus"
       ],
       "correct_index": 1,
       "explanation": "Met deze drie dingen kan de ander meteen helpen."
      },
      {
       "question": "Je developer meldt voor het eerst een blokkade. Wat doe je?",
       "options": [
        "Vragen waarom hij het niet zelf oploste",
        "Bedanken en snel helpen",
        "Het doorsturen naar Nordavo"
       ],
       "correct_index": 1,
       "explanation": "Je reactie op de eerste melding bepaalt of er een tweede komt."
      },
      {
       "question": "Wat doet je developer terwijl hij op hulp wacht?",
       "options": [
        "Wachten tot jij online bent",
        "Een afgesproken andere taak oppakken",
        "Naar huis gaan"
       ],
       "correct_index": 1,
       "explanation": "Een lijst met tweede taken voorkomt dat er tijd verloren gaat."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Werkblad: Blokkadeafspraak",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-client-blocker"
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Maak samen met je developer de blokkadeafspraak",
       "description": "Vul het werkblad in en bespreek het in de check-in.",
       "deadline_offset_days": 4,
       "shared": true,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "client-5.1",
   "module": "client-5",
   "position": 1,
   "title": "Feedback geven die aankomt",
   "summary": "Nederlandse directheid en Indiase beleefdheid: zo komt je feedback over zoals je hem bedoelt.",
   "language": "nl",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Hoe feedback anders valt in India dan in Nederland, en een eenvoudige structuur om feedback te geven."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Nederlanders staan bekend om hun directheid. Voor jou is \"dit klopt niet\" gewoon informatie. Voor een developer uit een cultuur waarin kritiek meestal verpakt wordt, kan dezelfde zin klinken als een flinke berisping, zeker als hij in een groep valt. Andersom hoor je zelf soms niet dat je developer iets lastig vindt, omdat het heel voorzichtig gezegd wordt.</p><h2>Een eenvoudige structuur</h2><ol><li><strong>Situatie.</strong> Wanneer en waar: \"In de pull request van gisteren...\"</li><li><strong>Gedrag.</strong> Wat je zag, zonder oordeel: \"...stonden er geen tests bij de nieuwe functie.\"</li><li><strong>Gevolg.</strong> Waarom het ertoe doet: \"Daardoor ging er een fout mee naar de testomgeving.\"</li><li><strong>Vraag of verzoek.</strong> \"Kun je voortaan tests toevoegen? Wat heb je nodig om dat te doen?\"</li></ol><h2>Wat helpt</h2><ul><li><strong>Privé.</strong> Kritische feedback geef je één op één, niet in de groepschat of in de stand-up.</li><li><strong>Snel.</strong> Geef feedback binnen een paar dagen, niet pas in de review aan het eind van de maand.</li><li><strong>Specifiek.</strong> \"Goed gedaan\" is fijn, \"de manier waarop je die migratie in stappen opdeelde, scheelde ons veel risico\" is beter.</li><li><strong>Ook positief.</strong> Zeg wat goed gaat, en doe dat gerust in de groep. Dat maakt de kritische feedback makkelijker te ontvangen.</li><li><strong>Check of het aankomt.</strong> Vraag na een feedbackgesprek: \"Hoe kijk jij hiernaar?\" en luister.</li></ul><h2>Wat je vermijdt</h2><ul><li>Feedback in een bijzin of als grap.</li><li>Een ironische opmerking in een review.</li><li>Het hele team aanspreken op iets wat één persoon deed.</li><li>Alleen schriftelijk, bij iets wat gevoelig ligt. Doe dat in een call en zet de afspraak daarna op schrift.</li></ul><h2>Schriftelijke reviews</h2><p>In code reviews is de toon in een tweede taal snel harder dan bedoeld. Schrijf \"Could we...\" of \"What do you think about...\" in plaats van \"This is wrong\". Leg uit waarom. Dat is geen softheid: zo leert je developer sneller.</p><h2>Voorbeeld</h2><blockquote><p>Yesterday in the pull request for the export, there were no tests for the new function. Because of that, a bug reached the test environment. Could you add tests next time? Is there anything you need for that?</p></blockquote><p>Kort, concreet en zonder verwijt. Zo komt het over.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Waar geef je kritische feedback?",
       "options": [
        "In de stand-up, dan leert iedereen ervan",
        "Eén op één",
        "In de groepschat"
       ],
       "correct_index": 1,
       "explanation": "Kritiek in een groep kan veel gezichtsverlies opleveren. Doe het privé; positieve feedback mag wel in de groep."
      },
      {
       "question": "Welke volgorde gebruik je?",
       "options": [
        "Situatie, gedrag, gevolg, vraag",
        "Oordeel, gedrag, sanctie",
        "Vraag, oordeel, situatie"
       ],
       "correct_index": 0,
       "explanation": "Situatie, gedrag, gevolg en een vraag of verzoek maakt feedback concreet en niet persoonlijk."
      },
      {
       "question": "Waarom vraag je na feedback \"Hoe kijk jij hiernaar?\"",
       "options": [
        "Om te checken of het aankomt zoals je het bedoelde",
        "Om de developer te testen",
        "Dat hoeft niet"
       ],
       "correct_index": 0,
       "explanation": "Zo merk je of de boodschap goed is aangekomen, en hoor je de kant van je developer."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Welke feedback wil je je developer deze week geven? Schrijf hem op met situatie, gedrag, gevolg en vraag."
     }
    }
   ]
  },
  {
   "key": "client-5.2",
   "module": "client-5",
   "position": 2,
   "title": "Corrigeren zonder gezichtsverlies",
   "summary": "Wat je doet als het werk niet is wat je verwachtte, en wanneer je Nordavo erbij haalt.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Corrigeren in drie stappen, met een voorbeeldgesprek. Wanneer je Nordavo inschakelt."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Soms is het werk gewoon niet goed. De taak is anders opgevat, de kwaliteit is te laag, of een afspraak is niet nagekomen. Dan moet je corrigeren. Dat kan zonder dat de relatie eronder lijdt.</p><h2>Eerst vragen, dan oordelen</h2><p>Begin met een vraag: \"Ik had iets anders verwacht. Kun je me meenemen in hoe je dit hebt aangepakt?\" Vaak blijkt dan dat de taak onduidelijk was, of dat je developer een aanname deed die hij niet durfde te checken. Dat los je anders op dan een kwaliteitsprobleem.</p><h2>Corrigeren in drie stappen</h2><ol><li><strong>Benoem het verschil.</strong> Wat was de verwachting, wat is er geleverd? Concreet en zonder verwijt.</li><li><strong>Zoek samen de oorzaak.</strong> Was de taak onduidelijk? Ontbrak kennis? Was er te weinig tijd? Speelde er iets anders?</li><li><strong>Spreek af wat er anders gaat.</strong> Wat doet je developer anders, en wat doe jij anders? Zet het daarna op schrift.</li></ol><h2>Na het gesprek</h2><ul><li>Stuur een korte samenvatting van de afspraken.</li><li>Kijk bij de volgende vergelijkbare taak bewust of het beter gaat, en zeg het als dat zo is.</li><li>Maak er geen dossier van. Eén fout is een leermoment.</li></ul><h2>Wanneer je Nordavo erbij haalt</h2><ul><li>Hetzelfde probleem komt na een gesprek terug.</li><li>Je merkt dat er iets anders speelt: thuis, gezondheid, motivatie.</li><li>Je twijfelt of het niveau past.</li><li>Je vindt het gesprek zelf lastig, bijvoorbeeld door de taal of de cultuur.</li></ul><p>Nordavo kent je developer en kan het gesprek voorbereiden of erbij zijn. Vaak hoort Nordavo in een gesprek met de developer dingen die hij tegen jou niet zegt.</p><blockquote><p>Corrigeren is investeren. Als het je niets kon schelen, zou je het niet doen.</p></blockquote><h2>Voorbeeld</h2><blockquote><p>I expected the export to include all invoices, but cancelled invoices are missing. Can you walk me through how you approached it?</p></blockquote><p>Blijkt het een onduidelijke taak, dan pas je je eigen manier van uitschrijven aan. Blijkt het een kennisgat, dan zoek je samen uit hoe je developer dat het snelst bijleert: een sessie met een collega, documentatie of een kleine oefentaak.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Het werk is anders dan je verwachtte. Waar begin je mee?",
       "options": [
        "Met een vraag over hoe je developer het heeft aangepakt",
        "Met een waarschuwing",
        "Met een mail aan Nordavo"
       ],
       "correct_index": 0,
       "explanation": "Door eerst te vragen, ontdek je of het aan de taak, de kennis of iets anders lag."
      },
      {
       "question": "Wanneer haal je Nordavo erbij?",
       "options": [
        "Bij elke fout",
        "Als hetzelfde probleem na een gesprek terugkomt",
        "Nooit, dat is jouw verantwoordelijkheid"
       ],
       "correct_index": 1,
       "explanation": "Bij een terugkerend probleem, twijfel over het niveau of als er iets anders speelt, kan Nordavo helpen."
      },
      {
       "question": "Wat doe je na het correctiegesprek?",
       "options": [
        "Een dossier aanleggen",
        "Een korte samenvatting sturen en bij de volgende taak bewust kijken",
        "Niets meer"
       ],
       "correct_index": 1,
       "explanation": "Een samenvatting maakt de afspraak helder. Zeg het ook als het daarna beter gaat."
      }
     ]
    }
   ]
  },
  {
   "key": "client-5.3",
   "module": "client-5",
   "position": 3,
   "title": "Feedback vragen en de pulse",
   "summary": "Zo krijg je eerlijke feedback van je developer, en wat de pulse van Nordavo doet.",
   "language": "nl",
   "minutes": 8,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Hoe je feedback vraagt aan je developer en hoe de pulse werkt."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Je developer zegt niet snel uit zichzelf dat jij iets beter kunt doen. Toch is die feedback goud waard: over onduidelijke taken, te weinig context of een vergadering die altijd uitloopt. Je moet er wel om vragen, en op de goede manier.</p><h2>Zo vraag je feedback</h2><ul><li><strong>Maak het klein en concreet.</strong> Niet \"Heb je feedback voor me?\", maar \"Wat zou ik aan mijn taken kunnen verbeteren zodat je minder hoeft te vragen?\"</li><li><strong>Vraag om één ding.</strong> \"Noem één ding dat ik anders kan doen.\"</li><li><strong>Geef zelf het voorbeeld.</strong> \"Ik merk dat ik taken soms te kort uitschrijf. Herken je dat?\"</li><li><strong>Doe er iets mee.</strong> Pas iets aan en zeg dat je het deed. Dan komt er een volgende keer meer.</li><li><strong>Herhaal het.</strong> Bijvoorbeeld in elke vrijdagreview één vraag over de samenwerking.</li></ul><h2>De pulse</h2><p>Elke twee weken krijgen jij en je developer van Nordavo een korte pulse in de Academy: een score van 1 tot 10 en twee vragen, wat gaat goed en wat schuurt. De scores en antwoorden ziet alleen Nordavo.</p><ul><li>Vul hem eerlijk in, ook als alles goed gaat. Een korte \"prima\" is ook informatie.</li><li>Een lage score is geen klacht, het is een signaal. Nordavo neemt dan contact op.</li><li>Daalt de score van je developer, dan hoor je dat van Nordavo, op een manier die het vertrouwen niet schaadt.</li></ul><h2>Waarom het werkt</h2><p>Een developer vertelt Nordavo vaak eerder dat iets schuurt dan zijn klant. De pulse maakt dat structureel. Daardoor kun je kleine dingen oplossen voordat ze groot worden.</p><h2>Voorbeeld</h2><blockquote><p>One question for this week's review: what is one thing I could change in how I write tasks, so you need to ask fewer questions?</p></blockquote><h2>In het kort</h2><ul><li>Vraag klein en concreet, één ding tegelijk.</li><li>Doe er iets mee en laat dat zien.</li><li>Vul de pulse eerlijk in; Nordavo doet de rest.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Welke vraag levert de meeste feedback op?",
       "options": [
        "Heb je feedback voor me?",
        "Is alles goed?",
        "Noem één ding dat ik aan mijn taken kan verbeteren"
       ],
       "correct_index": 2,
       "explanation": "Een kleine, concrete vraag is makkelijker te beantwoorden dan een open uitnodiging."
      },
      {
       "question": "Hoe vaak komt de pulse?",
       "options": [
        "Elke week",
        "Elke twee weken",
        "Elk kwartaal"
       ],
       "correct_index": 1,
       "explanation": "De pulse komt elke twee weken."
      },
      {
       "question": "Je developer geeft een lage pulsescore. Wat gebeurt er?",
       "options": [
        "De klant krijgt automatisch een melding met de score",
        "Nordavo neemt contact op",
        "Niets"
       ],
       "correct_index": 1,
       "explanation": "De scores ziet alleen Nordavo. Bij een laag signaal neemt Nordavo contact op."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Vraag in de volgende vrijdagreview je developer om één ding dat jij anders kunt doen",
       "description": null,
       "deadline_offset_days": 11,
       "shared": false,
       "placement_only": true,
       "required": false
      }
     ]
    }
   ]
  },
  {
   "key": "client-6.1",
   "module": "client-6",
   "position": 1,
   "title": "Onderdeel van het team, niet van de leverancier",
   "summary": "Wat je doet zodat je developer zich teamlid voelt, en ook zo werkt.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Kleine dingen die het verschil maken tussen een externe en een teamgenoot."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Na een maand of twee zie je het verschil: de ene developer is \"die externe in India\", de andere is gewoon Priya of Arjun uit het team. Dat tweede levert veel meer op: meer initiatief, betere beslissingen en een developer die blijft. Het verschil zit in kleine dingen.</p><h2>Zo hoort je developer erbij</h2><ul><li><strong>Dezelfde kanalen.</strong> Je developer zit in de teamkanalen, niet in een apart kanaal \"India\".</li><li><strong>Dezelfde rituelen.</strong> Stand-up, planning, retro, demo: als het kan binnen het overlapvenster, met je developer erbij.</li><li><strong>Dezelfde informatie.</strong> Nieuws over het bedrijf, de roadmap, een nieuwe klant. Wie niets hoort, gaat zich extern voelen.</li><li><strong>Een naam, geen land.</strong> Zeg \"Arjun bouwt de export\", niet \"India doet de export\".</li><li><strong>Erkenning in het openbaar.</strong> Noem het werk van je developer in de demo of in de bedrijfsupdate.</li></ul><h2>Context geven</h2><p>Een teamgenoot weet waarom iets belangrijk is. Neem je developer mee in klantgesprekken (als luisteraar), in de cijfers van het product en in de keuzes van het management. Hoe meer context, hoe beter de beslissingen.</p><h2>Sociale momenten</h2><ul><li>Een vrijdagmiddag-call zonder agenda, een keer per maand.</li><li>Een virtuele lunch of koffie, in het overlapvenster.</li><li>Verjaardagen en jubilea, ook die van je developer.</li><li>Als je team een uitje heeft: bedenk iets waar je developer aan mee kan doen, of stuur iets op.</li></ul><h2>Langs gaan</h2><p>Een keer persoonlijk kennismaken doet veel, in Nederland of in India. [Nordavo vult in: of en hoe Nordavo een bezoek ondersteunt.]</p><h2>Een eenvoudige test</h2><p>Stel jezelf na twee maanden deze vragen:</p><ol><li>Weet je developer wat de belangrijkste doelen van het bedrijf dit kwartaal zijn?</li><li>Wordt hij uitgenodigd voor dezelfde overleggen als zijn Nederlandse collega's met dezelfde rol?</li><li>Kent het team zijn naam, en weet het waar hij aan werkt?</li><li>Heeft hij weleens een idee ingebracht dat is overgenomen?</li></ol><p>Is het antwoord vaker nee dan ja, dan is er werk aan de winkel. Begin met één ding, bijvoorbeeld de kanalen of de rituelen.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wat werkt het beste?",
       "options": [
        "Een apart kanaal voor de developers in India",
        "Je developer in dezelfde teamkanalen als iedereen",
        "Alle communicatie via Nordavo"
       ],
       "correct_index": 1,
       "explanation": "Wie in dezelfde kanalen zit, krijgt dezelfde informatie en hoort er echt bij."
      },
      {
       "question": "Waarom geef je je developer context over klanten en roadmap?",
       "options": [
        "Omdat het in het contract staat",
        "Zodat hij betere beslissingen kan nemen",
        "Dat hoeft niet"
       ],
       "correct_index": 1,
       "explanation": "Context maakt het mogelijk om zelf goede keuzes te maken."
      },
      {
       "question": "Wat zeg je in de demo?",
       "options": [
        "India heeft de export gebouwd",
        "Arjun heeft de export gebouwd",
        "Het externe team heeft de export gebouwd"
       ],
       "correct_index": 1,
       "explanation": "Noem je developer bij naam. Dat is erkenning, en het maakt hem een teamgenoot."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Zet je developer in alle teamkanalen en terugkerende teamoverleggen",
       "description": null,
       "deadline_offset_days": 30,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Neem je developer een keer mee in een gesprek over de roadmap of een klant",
       "description": null,
       "deadline_offset_days": 45,
       "shared": false,
       "placement_only": true,
       "required": false
      }
     ]
    }
   ]
  },
  {
   "key": "client-6.2",
   "module": "client-6",
   "position": 2,
   "title": "Eigenaarschap geven",
   "summary": "Van taken uitvoeren naar verantwoordelijk zijn voor een stuk van het product.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Hoe je stap voor stap eigenaarschap overdraagt, met een voorbeeld."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Na de eerste maanden kent je developer de codebase en jullie manier van werken. Dan is het tijd voor de volgende stap: niet meer alleen taken uitvoeren, maar eigenaar worden van een onderdeel.</p><h2>Wat eigenaarschap is</h2><p>Een eigenaar van een onderdeel (een module, een service, een integratie):</p><ul><li>weet hoe het werkt en waarom het zo gebouwd is;</li><li>denkt mee over wat er beter kan, en zet dat op de backlog;</li><li>is het eerste aanspreekpunt bij vragen of problemen;</li><li>reviewt wijzigingen van anderen in dat onderdeel.</li></ul><h2>Stap voor stap</h2><ol><li><strong>Kies een afgebakend onderdeel</strong> waar je developer al aan heeft gewerkt.</li><li><strong>Zeg het expliciet</strong> tegen je developer en tegen het team: \"Vanaf nu is Arjun eigenaar van de export.\"</li><li><strong>Verruim de beslissingsruimte</strong> voor dat onderdeel (zie module 4), bijvoorbeeld naar \"beslis en meld\".</li><li><strong>Vraag om een plan:</strong> wat zou je de komende maanden aan dit onderdeel verbeteren?</li><li><strong>Bespreek het regelmatig</strong> in de vrijdagreview of het maandgesprek.</li></ol><h2>Reviews in twee richtingen</h2><p>Laat je developer ook code van anderen reviewen, niet alleen andersom. Dat is een sterk signaal dat je zijn oordeel vertrouwt, en het verspreidt kennis door het team.</p><h2>Waar je op let</h2><ul><li>Eigenaarschap zonder bevoegdheid werkt niet. Als je developer eigenaar is, moet hij ook beslissingen mogen nemen.</li><li>Je developer neemt het misschien voorzichtig aan. Moedig voorstellen aan, ook als ze niet allemaal doorgaan.</li><li>Eigenaarschap betekent niet alleen staan. De buddy en jij blijven beschikbaar.</li></ul><h2>Voorbeeld</h2><blockquote><p>From now on Arjun owns the invoice export. Questions about the export go to him first, and he reviews changes to it. Arjun, could you share in two weeks what you would improve in the export this quarter?</p></blockquote><h2>In het kort</h2><ul><li>Kies een afgebakend onderdeel en zeg het hardop.</li><li>Geef de beslissingsruimte die erbij hoort.</li><li>Laat je developer ook reviewen, en vraag om een plan.</li><li>Bespreek het eigenaarschap in de vrijdagreview en in het maandgesprek met Nordavo.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wat hoort bij eigenaarschap van een onderdeel?",
       "options": [
        "Alleen de taken uitvoeren die binnenkomen",
        "Meedenken, eerste aanspreekpunt zijn en wijzigingen reviewen",
        "Alles alleen doen"
       ],
       "correct_index": 1,
       "explanation": "Een eigenaar denkt mee, is aanspreekpunt en reviewt wijzigingen in zijn onderdeel."
      },
      {
       "question": "Waarom zeg je het eigenaarschap hardop tegen het team?",
       "options": [
        "Zodat iedereen weet bij wie hij moet zijn",
        "Omdat Nordavo dat vraagt",
        "Dat hoeft niet"
       ],
       "correct_index": 0,
       "explanation": "Als het team het weet, gaan vragen en reviews ook echt naar de eigenaar."
      },
      {
       "question": "Wat moet er samengaan met eigenaarschap?",
       "options": [
        "Meer uren",
        "Meer beslissingsruimte",
        "Meer controle"
       ],
       "correct_index": 1,
       "explanation": "Eigenaarschap zonder bevoegdheid werkt niet."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Welk onderdeel zou je developer de komende maanden als eigenaar kunnen oppakken?"
     }
    }
   ]
  },
  {
   "key": "client-6.3",
   "module": "client-6",
   "position": 3,
   "title": "Cultuur, feestdagen en een gezamenlijke agenda",
   "summary": "Wat je weet over werken met iemand uit India, en hoe je rekening houdt met elkaars feestdagen.",
   "language": "nl",
   "minutes": 8,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Indiase en Nederlandse feestdagen, wat ze betekenen voor de planning, en een paar culturele verschillen in het werk."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Een paar dingen over werken met iemand uit India helpen je om elkaar beter te begrijpen. Het zijn algemene patronen, geen regels: iedere developer is anders.</p><h2>Patronen die je kunt tegenkomen</h2><ul><li><strong>Respect voor hiërarchie.</strong> De manager heeft het laatste woord, dus tegenspreken voelt onbeleefd. Nodig daarom expliciet uit tot tegenspraak.</li><li><strong>\"Ja\" als beleefdheid.</strong> Ja kan betekenen \"ik hoor je\". Vraag door.</li><li><strong>Indirect slecht nieuws.</strong> \"It might be a little difficult\" kan betekenen \"dit gaat niet lukken\". Vraag wat er nodig is.</li><li><strong>Hoofdbeweging.</strong> Het zijwaarts wiegen van het hoofd betekent vaak instemming of \"ik volg je\", geen twijfel.</li><li><strong>Familie.</strong> Familie speelt vaak een grote rol, bijvoorbeeld bij bruiloften en feestdagen. Plan daar ruim op.</li></ul><h2>Feestdagen</h2><p>India heeft landelijke feestdagen en per staat eigen dagen. In Karnataka, waar Bangalore ligt, zijn dat bijvoorbeeld Ugadi en Kannada Rajyotsava. Grote feesten zoals Diwali vallen elk jaar op een andere datum. Nederland heeft weer andere vrije dagen, zoals Koningsdag en Tweede Kerstdag.</p><ul><li>De feestdagen van Nederland en Karnataka staan op je plaatsingspagina in de Academy, ook als agenda om je op te abonneren.</li><li>Bespreek aan het begin van het jaar welke dagen je developer vrij is en welke van jullie dagen voor hem een werkdag zijn.</li><li>Plan geen deadline of release op of net na een grote feestdag.</li></ul><h2>Wederzijds</h2><p>Cultuur is van twee kanten. Leg ook uit hoe het bij jullie werkt: dat een Nederlander \"dat is geen goed idee\" zegt zonder het persoonlijk te bedoelen, dat je om 17:30 naar huis gaat en dat het normaal is om je baas bij de voornaam te noemen. Je developer volgt in de Academy een eigen course daarover.</p><h2>In het kort</h2><ul><li>Patronen helpen om elkaar te begrijpen, maar vraag altijd hoe het voor jouw developer zit.</li><li>Nodig uit tot tegenspraak en vraag door bij \"ja\".</li><li>Bekijk samen de feestdagen aan het begin van het jaar en plan geen deadline op een vrije dag.</li><li>Leg ook uit hoe het bij jullie werkt.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Je developer zegt \"It might be a little difficult\". Wat kan dat betekenen?",
       "options": [
        "Het is een kleine moeite",
        "Het gaat misschien niet lukken",
        "Hij wil meer betaald krijgen"
       ],
       "correct_index": 1,
       "explanation": "Slecht nieuws wordt vaak voorzichtig gebracht. Vraag wat er nodig is."
      },
      {
       "question": "Waarom bespreek je aan het begin van het jaar de feestdagen?",
       "options": [
        "Om verlof te weigeren",
        "Om geen deadlines op vrije dagen te plannen",
        "Dat hoeft niet"
       ],
       "correct_index": 1,
       "explanation": "Zo voorkom je dat een release valt op een dag dat je developer vrij is."
      },
      {
       "question": "Waar vind je de feestdagen van Nederland en Karnataka?",
       "options": [
        "Op de plaatsingspagina in de Academy",
        "Alleen bij Nordavo op te vragen",
        "Nergens"
       ],
       "correct_index": 0,
       "explanation": "Ze staan op de plaatsingspagina, ook als agenda om op te abonneren."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Bekijk de feestdagen van Nederland en Karnataka op je plaatsingspagina en zet de belangrijkste in de teamplanning",
       "description": null,
       "deadline_offset_days": 30,
       "shared": false,
       "placement_only": true,
       "required": false
      }
     ]
    }
   ]
  },
  {
   "key": "client-7.1",
   "module": "client-7",
   "position": 1,
   "title": "Plannen met een tijdsverschil",
   "summary": "Hoe je het tijdsverschil gebruikt in je planning, in plaats van erdoor gehinderd te worden.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Plannen met een developer die eerder begint: overdracht, sprintplanning en releases."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Je developer begint de dag een paar uur eerder dan jij. Dat kun je slim gebruiken.</p><h2>De overdracht</h2><ul><li><strong>Aan het eind van jouw dag</strong> zet je klaar wat je developer morgenochtend kan oppakken: reviews, antwoorden op vragen, nieuwe taken.</li><li><strong>Aan het begin van jouw dag</strong> heeft je developer al een paar uur gewerkt. Lees eerst zijn update, dan kun je in het overlapvenster gericht bijsturen.</li><li>Zo werkt het team als een estafette in plaats van langs elkaar heen.</li></ul><h2>Sprintplanning</h2><ul><li>Plan de planning en de retro in het overlapvenster.</li><li>Zorg dat taken voor de sprint uitgeschreven zijn vóór de planning, zodat je developer ze kan lezen en vragen kan voorbereiden.</li><li>Houd rekening met feestdagen en verlof van je developer in de capaciteit.</li></ul><h2>Reviews niet laten liggen</h2><p>Een pull request die een dag op review wacht, kost je developer een dag. Spreek af dat reviews van je developer binnen een vaste tijd worden opgepakt, bijvoorbeeld in het overlapvenster van dezelfde dag.</p><h2>Releases en storingen</h2><ul><li>Release niet aan het eind van de Indiase dag als je developer daarna offline is en er iets mis kan gaan.</li><li>Spreek af wie er bereikbaar is bij een storing buiten het overlapvenster. Je developer is geen dekking voor de Nederlandse nacht, tenzij dat expliciet is afgesproken.</li></ul><h2>Afhankelijkheden</h2><p>Moet je developer wachten op een collega, een ontwerper of een externe partij? Zet die afhankelijkheden zichtbaar in de planning, en geef je developer altijd een tweede taak om op terug te vallen.</p><h2>Een voorbeelddag</h2><ul><li><strong>06:00 tot 09:00 Nederlandse tijd:</strong> je developer werkt aan de taken die jij gisteren klaarzette en schrijft zijn update.</li><li><strong>09:00:</strong> jij leest de update en de vragen.</li><li><strong>09:00 tot 13:00 (overlapvenster):</strong> stand-up, reviews, vragen, beslissingen.</li><li><strong>Na het venster:</strong> je developer rondt af; jij zet aan het eind van je dag klaar wat hij morgen kan oppakken.</li></ul><p>Zo verliest niemand tijd door het verschil, en heb je elke ochtend al resultaat.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wat zet je klaar aan het eind van jouw dag?",
       "options": [
        "Niets, je developer slaapt al",
        "Reviews, antwoorden en taken voor de volgende ochtend van je developer",
        "Een rapport voor Nordavo"
       ],
       "correct_index": 1,
       "explanation": "Je developer begint eerder. Wat jij aan het eind van de dag klaarzet, kan hij meteen oppakken."
      },
      {
       "question": "Een pull request ligt een dag op review te wachten. Wat is het gevolg?",
       "options": [
        "Geen",
        "Je developer verliest een dag",
        "De review wordt beter"
       ],
       "correct_index": 1,
       "explanation": "Door het tijdsverschil kost wachten op een review snel een hele dag."
      },
      {
       "question": "Wanneer release je liever niet?",
       "options": [
        "In het overlapvenster",
        "Aan het eind van de Indiase dag als niemand meer kan ingrijpen",
        "Op dinsdag"
       ],
       "correct_index": 1,
       "explanation": "Release als er nog iemand is die kan ingrijpen als er iets misgaat."
      }
     ]
    }
   ]
  },
  {
   "key": "client-7.2",
   "module": "client-7",
   "position": 2,
   "title": "Verlof en afwezigheid",
   "summary": "Hoe verlof werkt via de Academy en hoe je erop plant.",
   "language": "nl",
   "minutes": 8,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Hoe een verlofaanvraag loopt: developer, Nordavo en klant. Wat je doet bij ziekte."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Je developer heeft recht op verlof volgens de regeling van Nordavo. Nordavo regelt het verlof, jij stemt het af in de planning.</p><h2>Hoe een aanvraag loopt</h2><ol><li>Je developer vraagt het verlof aan in de Academy.</li><li>Nordavo stemt het af met jou.</li><li>Na akkoord ziet iedereen in de driehoek het verlof op de plaatsingspagina, met het saldo.</li></ol><p>[Nordavo vult in: het aantal verlofdagen, hoe ver van tevoren je developer verlof aanvraagt, en wat er gebeurt met verlof dat niet is opgenomen.]</p><h2>Plan vooruit</h2><ul><li>Vraag aan het begin van het jaar of je developer al grote plannen heeft, zoals een bruiloft in de familie of een reis rond Diwali.</li><li>Zet het goedgekeurde verlof meteen in de teamplanning.</li><li>Zorg dat werk dat tijdens het verlof doorgaat, is overgedragen.</li></ul><h2>Ziekte</h2><p>Is je developer ziek, dan meldt hij dat bij jou en bij Nordavo. [Nordavo vult in: hoe en bij wie de developer zich ziek meldt, en wat dit voor de facturatie betekent.]</p><h2>Jouw verlof</h2><p>Ga jij op vakantie? Regel een vervanger die in het overlapvenster bereikbaar is, en zorg dat je developer genoeg werk en beslissingsruimte heeft. Laat het ook Nordavo weten, zodat wij weten wie het aanspreekpunt is.</p><h2>Feestdagen</h2><p>Feestdagen in Karnataka zijn vrije dagen voor je developer. Ze staan op de plaatsingspagina. Nederlandse feestdagen zijn voor je developer in principe gewone werkdagen. [Nordavo vult in: de afspraak over Nederlandse en Indiase feestdagen.]</p><h2>In het kort</h2><ul><li>Verlof loopt via de Academy: developer vraagt aan, Nordavo stemt af met jou, iedereen ziet het.</li><li>Vraag vroeg in het jaar naar grote plannen en zet ze meteen in de planning.</li><li>Regel overdracht vóór het verlof, en een vervanger als jij zelf weg bent.</li><li>Ziekte meld je developer bij jou en bij Nordavo.</li></ul><h2>Veelgemaakte fout</h2><p>Verlof pas in de sprintplanning ontdekken. Zet goedgekeurd verlof daarom direct in de teamagenda, ook als het pas over maanden is.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Waar vraagt je developer verlof aan?",
       "options": [
        "Rechtstreeks bij jou per mail",
        "In de Academy, Nordavo stemt het af met jou",
        "Bij de buddy"
       ],
       "correct_index": 1,
       "explanation": "De developer vraagt aan in de Academy, Nordavo stemt het af en daarna ziet iedereen het op de plaatsingspagina."
      },
      {
       "question": "Je gaat zelf op vakantie. Wat regel je?",
       "options": [
        "Niets, je developer kan wel even zonder",
        "Een vervanger in het overlapvenster en genoeg werk en beslissingsruimte",
        "Je developer neemt dan ook vrij"
       ],
       "correct_index": 1,
       "explanation": "Zonder vervanger zit je developer zonder aanspreekpunt."
      },
      {
       "question": "Waarom vraag je aan het begin van het jaar naar grote plannen?",
       "options": [
        "Zodat je ze kunt weigeren",
        "Zodat je ze in de planning kunt meenemen",
        "Omdat dat moet van Nordavo"
       ],
       "correct_index": 1,
       "explanation": "Vooruit plannen voorkomt dat verlof en deadlines botsen."
      }
     ]
    }
   ]
  },
  {
   "key": "client-7.3",
   "module": "client-7",
   "position": 3,
   "title": "Meten zonder te micromanagen, en de review na 90 dagen",
   "summary": "Waar je op stuurt, wat je niet meet, en hoe je de review na 90 dagen voorbereidt.",
   "language": "nl",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Sturen op resultaat in plaats van uren, en wat er in de review na 90 dagen gebeurt."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Op afstand is de verleiding groot om te controleren: is hij online, hoeveel uur heeft hij gewerkt, waarom staat zijn status op afwezig? Dat werkt averechts. Een developer die zich gecontroleerd voelt, gaat bezig lijken in plaats van bezig zijn.</p><h2>Stuur op resultaat</h2><ul><li><strong>Weekplan tegenover review.</strong> Is af wat gepland was? Zo niet, waarom niet?</li><li><strong>Kwaliteit.</strong> Hoeveel moet er na review nog worden aangepast? Komen er bugs terug?</li><li><strong>Zelfstandigheid.</strong> Hoe vaak is je hulp nodig, en neemt dat af?</li><li><strong>Communicatie.</strong> Weet je waar je developer staat zonder dat je hoeft te vragen?</li><li><strong>Bijdrage.</strong> Komt je developer met voorstellen en verbeteringen?</li></ul><h2>Wat je niet doet</h2><ul><li>Groene bolletjes in de chat controleren.</li><li>Screenshots of trackers inzetten zonder dat dat is afgesproken.</li><li>Developers onderling vergelijken op aantal tickets.</li></ul><h2>De review na 90 dagen</h2><p>Na 90 dagen is er een vaste review met jou, je developer en Nordavo. Daarin kijk je terug en vooruit:</p><ol><li>Wat ging goed in de eerste drie maanden?</li><li>Wat kan beter, aan beide kanten?</li><li>Waar staat je developer: niveau, zelfstandigheid, eigenaarschap?</li><li>Wat zijn de doelen voor de komende drie maanden?</li><li>Is er iets in de afspraken dat moet veranderen, zoals het overlapvenster of de beslissingsruimte?</li></ol><p>Bereid je voor met het werkblad hieronder. Je developer bereidt zich ook voor. Het verslag komt op de plaatsingspagina.</p><h2>Doelen die werken</h2><p>Een goed doel voor de komende drie maanden is concreet en te bespreken. Bijvoorbeeld:</p><ul><li>\"Arjun is eigenaar van de export en reviewt alle wijzigingen daarin.\"</li><li>\"Taken van gemiddelde grootte gaan zonder extra vragen door de eerste review.\"</li><li>\"Arjun presenteert een keer per maand in de demo wat hij heeft gebouwd.\"</li></ul><p>Vermijd doelen als \"harder werken\" of \"meer tickets\". Ze zeggen niets over wat er beter moet en geven je developer niets om op te sturen. Spreek bij elk doel af hoe je in de vrijdagreview of het maandgesprek ziet of het lukt.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Waar stuur je op?",
       "options": [
        "Op het aantal uur online",
        "Op resultaat: weekplan, kwaliteit en zelfstandigheid",
        "Op het aantal tickets tegenover andere developers"
       ],
       "correct_index": 1,
       "explanation": "Resultaat zegt iets over het werk. Uren online zeggen weinig."
      },
      {
       "question": "Wat is het risico van veel controle?",
       "options": [
        "Dat je developer bezig gaat lijken in plaats van bezig zijn",
        "Geen",
        "Dat Nordavo boos wordt"
       ],
       "correct_index": 0,
       "explanation": "Controle haalt vertrouwen weg en levert schijnactiviteit op."
      },
      {
       "question": "Wie zijn er bij de review na 90 dagen?",
       "options": [
        "Alleen jij en je developer",
        "Jij, je developer en Nordavo",
        "Alleen Nordavo"
       ],
       "correct_index": 1,
       "explanation": "De review is met de hele driehoek."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Werkblad: Review na 90 dagen: voorbereiding",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-client-90"
    },
    {
     "type": "tasks",
     "title": "Taken",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Vul het werkblad Review na 90 dagen in, uiterlijk een week voor de review",
       "description": null,
       "deadline_offset_days": 82,
       "shared": false,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "client-8.1",
   "module": "client-8",
   "position": 1,
   "title": "Signalen herkennen",
   "summary": "De vroege tekenen dat er iets niet goed zit, op afstand.",
   "language": "nl",
   "minutes": 8,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Signalen dat het schuurt, met voorbeelden uit de praktijk."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Problemen op afstand worden laat zichtbaar. Je ziet niemand zuchten bij de koffieautomaat. Daarom is het belangrijk om de vroege signalen te kennen.</p><h2>Signalen bij je developer</h2><ul><li><strong>Stiller dan anders.</strong> Minder vragen, kortere check-ins, camera vaker uit.</li><li><strong>\"Ja\" zonder resultaat.</strong> Taken worden toegezegd maar schuiven steeds door.</li><li><strong>Werken op rare tijden.</strong> Berichten midden in de Indiase nacht kunnen betekenen dat iemand achterloopt en dat probeert in te halen.</li><li><strong>Minder initiatief.</strong> Geen voorstellen meer, alleen nog uitvoeren.</li><li><strong>Vaker afwezig</strong> of kort van tevoren.</li></ul><h2>Signalen bij jezelf en je team</h2><ul><li>Je stuurt minder taken naar je developer, omdat \"het sneller is als ik het zelf doe\".</li><li>Je merkt dat je reviews strenger zijn dan bij anderen.</li><li>Het team praat over je developer in plaats van met hem.</li><li>Je zegt de check-in vaker af.</li></ul><h2>Wat je doet</h2><ol><li><strong>Benoem wat je ziet,</strong> zonder oordeel: \"Ik merk dat je de laatste week stiller bent. Hoe gaat het?\"</li><li><strong>Luister.</strong> Er kan van alles spelen: onduidelijke taken, te veel werk, iets thuis, onzekerheid over het werk.</li><li><strong>Spreek iets af</strong> en kijk na een week of het beter gaat.</li><li><strong>Laat het Nordavo weten,</strong> ook als je het zelf oppakt. Wij zien soms hetzelfde signaal in de pulse.</li></ol><blockquote><p>Een signaal is geen probleem. Een signaal dat je negeert, wordt er wel een.</p></blockquote><h2>Voorbeeld</h2><blockquote><p>I noticed that you have been quieter in the check-ins this week, and the export moved to next week twice. How are things going? Is there anything that makes the work harder right now?</p></blockquote><p>Zo'n vraag opent het gesprek zonder verwijt. Vaak hoor je dan iets wat je makkelijk kunt oplossen: een onduidelijke taak, te veel tegelijk, of wachten op iemand anders. En als er iets anders speelt, weet je dat nu in plaats van over twee maanden.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Je ziet berichten van je developer om 02:00 Indiase tijd. Wat kan dat betekenen?",
       "options": [
        "Dat hij heel gemotiveerd is",
        "Dat hij achterloopt en probeert in te halen",
        "Niets"
       ],
       "correct_index": 1,
       "explanation": "Werken op rare tijden is vaak een teken van achterstand of druk. Vraag ernaar."
      },
      {
       "question": "Welk signaal komt van jezelf?",
       "options": [
        "Je stuurt minder taken omdat je het sneller zelf doet",
        "Je developer heeft vrij",
        "De pulse is hoog"
       ],
       "correct_index": 0,
       "explanation": "Minder delegeren is een teken dat het vertrouwen afneemt."
      },
      {
       "question": "Je merkt een signaal en pakt het zelf op. Laat je het Nordavo weten?",
       "options": [
        "Nee, je hebt het al opgepakt",
        "Ja, Nordavo ziet soms hetzelfde signaal en kan helpen",
        "Alleen als het misgaat"
       ],
       "correct_index": 1,
       "explanation": "Samen zie je meer. Nordavo kan het combineren met wat het hoort in de pulse en de gesprekken."
      }
     ]
    }
   ]
  },
  {
   "key": "client-8.2",
   "module": "client-8",
   "position": 2,
   "title": "Het lastige gesprek voeren",
   "summary": "Een gesprek over iets wat niet goed gaat, zo voorbereid dat het iets oplevert.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Een lastig gesprek voorbereiden en voeren, met een voorbeeld. Wanneer Nordavo erbij is."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Soms is een kort feedbackmoment niet genoeg. Er speelt iets wat langer duurt of groter is: deadlines die steeds worden gemist, kwaliteit die niet beter wordt, of een verstoorde verhouding. Dan is een echt gesprek nodig.</p><h2>Voorbereiden</h2><ul><li><strong>Wat is het probleem, in feiten?</strong> Drie concrete voorbeelden met datum.</li><li><strong>Wat is het gevolg</strong> voor het team, het product of de klant?</li><li><strong>Wat wil je bereiken?</strong> Wat moet er over een maand anders zijn?</li><li><strong>Wat kun jij anders doen?</strong> Er zijn bijna altijd twee kanten.</li><li><strong>Wil je Nordavo erbij?</strong> Bij een gesprek dat gevolgen kan hebben voor de plaatsing: ja.</li></ul><h2>Het gesprek</h2><ol><li><strong>Zeg meteen waar het over gaat.</strong> \"Ik wil het met je hebben over de deadlines van de laatste weken.\" Draai er niet omheen, maar blijf vriendelijk.</li><li><strong>Geef de feiten.</strong> De voorbeelden, het gevolg.</li><li><strong>Vraag en luister.</strong> \"Hoe kijk jij hiernaar? Wat speelt er?\" Laat stiltes vallen.</li><li><strong>Zoek samen een oplossing.</strong> Wat doet je developer, wat doe jij, wat doet Nordavo?</li><li><strong>Maak het concreet.</strong> Wat is er over twee weken anders, en wanneer kijken jullie terug?</li></ol><h2>Na het gesprek</h2><ul><li>Stuur een samenvatting met de afspraken, ook naar Nordavo.</li><li>Plan het vervolgmoment meteen in.</li><li>Zeg het als het beter gaat.</li></ul><h2>Taal en cultuur</h2><p>Een gesprek als dit in een tweede taal is zwaar, zeker voor iemand die gewend is dat de manager niet zo direct is. Houd je zinnen kort, check of het overkomt en geef je developer de kans om er later schriftelijk op terug te komen.</p><h2>Voorbeeld van een opening</h2><blockquote><p>I want to talk about the deadlines of the last weeks. The export, the VAT fix and the login change were all later than agreed, each by a few days. That made it hard for us to plan the release. How do you see this? What is going on?</p></blockquote><p>Daarna luister je. De oplossing kies je samen, en je schrijft hem op.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Waar begin je een lastig gesprek mee?",
       "options": [
        "Met small talk van tien minuten",
        "Met zeggen waar het over gaat",
        "Met de oplossing"
       ],
       "correct_index": 1,
       "explanation": "Zeg meteen waar het over gaat, vriendelijk en zonder eromheen te draaien."
      },
      {
       "question": "Wanneer vraag je Nordavo erbij?",
       "options": [
        "Bij een gesprek dat gevolgen kan hebben voor de plaatsing",
        "Nooit",
        "Bij elke check-in"
       ],
       "correct_index": 0,
       "explanation": "Nordavo is er bij gesprekken met mogelijke gevolgen voor de plaatsing, en helpt bij de voorbereiding."
      },
      {
       "question": "Waarom geef je je developer de kans om er schriftelijk op terug te komen?",
       "options": [
        "Om bewijs te hebben",
        "Omdat een gesprek in een tweede taal zwaar is en het niet altijd meteen lukt om te zeggen wat je denkt",
        "Dat hoeft niet"
       ],
       "correct_index": 1,
       "explanation": "Schriftelijk reageren geeft ruimte om rustig te formuleren."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Is er een gesprek dat je al een tijdje uitstelt? Schrijf de drie feiten op."
     }
    }
   ]
  },
  {
   "key": "client-8.3",
   "module": "client-8",
   "position": 3,
   "title": "Opschalen via Nordavo: de escalatiematrix",
   "summary": "Wanneer je wat zelf oplost, wanneer je Nordavo inschakelt en wat er dan gebeurt.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: De escalatiematrix uitgelegd: niveaus, wie je belt en wat Nordavo doet. Ook: opzeggen en vervangen."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Escaleren klinkt zwaar, maar het is gewoon: iemand erbij halen die kan helpen. Hoe eerder, hoe lichter. De escalatiematrix maakt duidelijk wanneer je wat doet.</p><h2>Drie niveaus</h2><ol><li><strong>Zelf oplossen.</strong> Een misverstand, een taak die anders liep, een eerste keer een gemiste deadline. Je bespreekt het met je developer in de check-in of de review.</li><li><strong>Nordavo informeren.</strong> Iets komt terug na een gesprek, je twijfelt, of er speelt iets persoonlijks. Je laat het je Nordavo-contactpersoon weten. Nordavo denkt mee en praat zo nodig met je developer.</li><li><strong>Nordavo inschakelen.</strong> Het werkt niet en jullie komen er samen niet uit, of er is iets ernstigs gebeurd (bijvoorbeeld rond beveiliging, gedrag of afspraken). Nordavo neemt het over en zoekt met jou een oplossing.</li></ol><p>[Nordavo vult in: reactietijden van Nordavo per niveau en het telefoonnummer voor urgente zaken.]</p><h2>Wat Nordavo dan doet</h2><ul><li>Met jou en met je developer apart praten.</li><li>Een gesprek met zijn drieën begeleiden.</li><li>Een verbeterplan met jou en je developer afspreken.</li><li>Als het echt niet werkt: samen kijken naar vervanging of stoppen. Je kunt maandelijks opzeggen. [Nordavo vult in: de opzegtermijn en hoe vervanging werkt.]</li></ul><h2>Een ernstig incident</h2><p>Bij een beveiligingsincident, een datalek of ernstig gedrag bel je Nordavo meteen, ook buiten het overlapvenster. Neem zelf de maatregelen die nodig zijn, zoals toegang intrekken, en leg vast wat er is gebeurd.</p><h2>Jouw escalatiematrix</h2><p>Vul het werkblad Escalatiematrix in: per soort situatie op welk niveau het valt en wie er actie neemt. De matrix van Nordavo zelf staat bij de documenten op je plaatsingspagina.</p><h2>In het kort</h2><ul><li>Hoe eerder je escaleert, hoe lichter het is.</li><li>Niveau 1: zelf. Niveau 2: Nordavo informeren. Niveau 3: Nordavo inschakelen.</li><li>Bij een ernstig incident: meteen bellen, zelf maatregelen nemen en vastleggen.</li><li>Maandelijkse opzegging is er, maar meestal is er eerst een betere oplossing.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Een misverstand over een taak. Welk niveau?",
       "options": [
        "Zelf oplossen",
        "Nordavo informeren",
        "Nordavo inschakelen"
       ],
       "correct_index": 0,
       "explanation": "Een misverstand los je zelf op in de check-in of review."
      },
      {
       "question": "Hetzelfde probleem komt na een gesprek terug. Wat doe je?",
       "options": [
        "Nog een keer zelf bespreken",
        "Nordavo informeren",
        "Meteen opzeggen"
       ],
       "correct_index": 1,
       "explanation": "Komt iets terug na een gesprek, laat het dan Nordavo weten zodat we kunnen meedenken."
      },
      {
       "question": "Er is een beveiligingsincident buiten het overlapvenster. Wat doe je?",
       "options": [
        "Wachten tot het overlapvenster",
        "Nordavo meteen bellen en zelf de nodige maatregelen nemen",
        "Een mail sturen aan je developer"
       ],
       "correct_index": 1,
       "explanation": "Bij een ernstig incident bel je Nordavo meteen en neem je zelf de nodige maatregelen, zoals toegang intrekken."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Werkblad: Escalatiematrix",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-client-escalation"
    }
   ]
  },
  {
   "key": "client-9.1",
   "module": "client-9",
   "position": 1,
   "title": "Van een paar developers naar een team",
   "summary": "Wat er verandert als je drie of meer developers via Nordavo hebt.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Wat er verandert vanaf de derde developer: structuur, een aanspreekpunt en kennis delen."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Met één of twee developers werkt alles via jou of je buddy. Vanaf de derde plaatsing verandert dat. Er ontstaat een groep die elkaar kan helpen, maar ook een risico: een eiland binnen je team.</p><h2>Wat er verandert</h2><ul><li><strong>Meer coördinatie.</strong> Wie werkt aan wat, wie reviewt wie?</li><li><strong>Kennis delen.</strong> Developers kunnen elkaar inwerken en helpen, ook buiten jouw werktijd.</li><li><strong>Een eigen dynamiek.</strong> Developers in dezelfde tijdzone gaan vanzelf vaker met elkaar praten dan met de Nederlandse collega's.</li></ul><h2>Geen eiland</h2><p>Het grootste risico is een \"India-team\" naast het \"Nederlandse team\". Voorkom dat:</p><ul><li>Verdeel developers over teams of onderdelen, in plaats van ze bij elkaar te zetten.</li><li>Houd gemengde reviews: Nederlandse collega's reviewen developers in India en andersom.</li><li>Houd alle rituelen gezamenlijk.</li><li>Wees voorzichtig met een aparte tussenlaag in India die alles doorgeeft.</li></ul><h2>Een aanspreekpunt</h2><p>Wel kan het helpen om een ervaren developer een rol te geven als aanspreekpunt of lead, bijvoorbeeld voor het inwerken van nieuwe collega's of voor technische afstemming. Spreek af wat die rol wel en niet is, en wie hem kiest. Overleg hierover met Nordavo, ook over wat het betekent voor de afspraken. [Nordavo vult in: hoe Nordavo een lead-rol inricht.]</p><h2>Inwerken door elkaar</h2><p>De derde developer kan voor een deel worden ingewerkt door de eerste twee. Dat scheelt jou tijd en het geeft de bestaande developers een nieuwe verantwoordelijkheid. Blijf zelf wel de kick-off en de eerste evaluatie doen.</p><h2>Checklist bij de derde plaatsing</h2><ol><li>Waar in het team komt de nieuwe developer, en wie is de buddy?</li><li>Wie werkt hem in, en wat doe jij zelf?</li><li>Blijven reviews en rituelen gemengd?</li><li>Is er behoefte aan een aanspreekpunt of lead, en wat betekent dat?</li><li>Wat bespreek je hierover met Nordavo?</li></ol><p>Neem deze vragen mee in het gesprek met Nordavo voordat de nieuwe developer start.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Wat is het grootste risico bij meer developers in India?",
       "options": [
        "Te veel vergaderingen",
        "Een eiland naast het Nederlandse team",
        "Te veel code reviews"
       ],
       "correct_index": 1,
       "explanation": "Een apart India-team zorgt dat kennis en betrokkenheid niet meer stromen."
      },
      {
       "question": "Hoe voorkom je een eiland?",
       "options": [
        "Alle developers in India bij elkaar zetten",
        "Developers verdelen over teams en gemengd reviewen",
        "Een tussenlaag in India die alles doorgeeft"
       ],
       "correct_index": 1,
       "explanation": "Gemengde teams en reviews houden iedereen verbonden."
      },
      {
       "question": "Wie werkt de derde developer in?",
       "options": [
        "Alleen Nordavo",
        "Deels de bestaande developers, met jou bij de kick-off en evaluatie",
        "Niemand"
       ],
       "correct_index": 1,
       "explanation": "Bestaande developers kunnen goed helpen inwerken. Jij blijft betrokken bij de belangrijke momenten."
      }
     ]
    }
   ]
  },
  {
   "key": "client-9.2",
   "module": "client-9",
   "position": 2,
   "title": "Structuur: documentatie, overdracht en groei",
   "summary": "Wat je vastlegt zodat een groter team blijft werken, en hoe developers kunnen groeien.",
   "language": "nl",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Concept: Julius en Floris controleren de tekst en nemen deze video op. Inhoud: Documentatie, overdracht en groeipaden in een groter team."
     }
    },
    {
     "type": "explanation",
     "title": "Uitleg",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Met een groter team wordt wat in hoofden zit een risico. Wat als iemand op vakantie is, ziek wordt of vertrekt? Een beetje structuur voorkomt dat.</p><h2>Documentatie</h2><ul><li><strong>Hoe we werken.</strong> Branches, reviews, releases, definitie van af, kanalen en reactietijden.</li><li><strong>Hoe het systeem werkt.</strong> Een overzicht per onderdeel, met de eigenaar erbij.</li><li><strong>Inwerken.</strong> Een checklist voor een nieuwe developer, die na elke nieuwe start wordt bijgewerkt.</li><li><strong>Beslissingen.</strong> Een korte notitie bij belangrijke technische keuzes: wat, waarom, alternatieven.</li></ul><p>Laat developers zelf documentatie bijhouden. Wie iets heeft uitgezocht, schrijft het op.</p><h2>Overdracht</h2><ul><li>Geen onderdeel heeft maar één persoon die het kent. Zorg per onderdeel voor een tweede.</li><li>Bij verlof: een korte overdracht in het ticket of kanaal.</li><li>Bij vertrek: een overdrachtsperiode, afgestemd met Nordavo.</li></ul><h2>Groei</h2><p>Developers die blijven, willen groeien. Bespreek in de review na 90 dagen en daarna regelmatig:</p><ul><li>Welk onderdeel wil je developer beter leren kennen?</li><li>Welke rol past op termijn: specialist, eigenaar, lead?</li><li>Welke vaardigheden wil hij ontwikkelen, technisch en in communicatie?</li></ul><p>Neem Nordavo mee in groeigesprekken, zeker als groei gevolgen heeft voor de rol of de afspraken.</p><h2>Terugkijken</h2><p>Kijk elk half jaar met Nordavo naar het hele team: wat werkt, wat niet, wat is de volgende stap? Een team bouwen is geen project dat af is; het blijft onderhoud.</p><h2>Een minimale set</h2><p>Begin klein. Voor een team met drie of meer developers op afstand is dit vaak genoeg:</p><ul><li>een pagina \"zo werken wij\" met kanalen, reactietijden, reviews en releases;</li><li>per onderdeel een korte beschrijving met de eigenaar en een tweede;</li><li>een inwerkchecklist die bij elke start wordt bijgewerkt;</li><li>een map met korte notities over belangrijke beslissingen.</li></ul><p>Laat elke nieuwe developer in zijn eerste week de inwerkchecklist verbeteren. Wie net begint, ziet het best wat er ontbreekt. En plan elk kwartaal een uur om de documentatie samen na te lopen: wat klopt niet meer, wat mist er?</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Kennischeck",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Waarom zorg je per onderdeel voor een tweede persoon die het kent?",
       "options": [
        "Voor het geval iemand op vakantie gaat, ziek wordt of vertrekt",
        "Om te kunnen vergelijken",
        "Dat hoeft niet"
       ],
       "correct_index": 0,
       "explanation": "Zo is er altijd iemand die het onderdeel kan overnemen."
      },
      {
       "question": "Wie houdt de documentatie bij?",
       "options": [
        "Alleen de manager",
        "De developers zelf: wie iets uitzoekt, schrijft het op",
        "Nordavo"
       ],
       "correct_index": 1,
       "explanation": "Documentatie blijft actueel als het team het zelf bijhoudt."
      },
      {
       "question": "Wanneer neem je Nordavo mee in een groeigesprek?",
       "options": [
        "Nooit",
        "Als groei gevolgen heeft voor de rol of de afspraken",
        "Alleen bij vertrek"
       ],
       "correct_index": 1,
       "explanation": "Groei die de rol of afspraken verandert, stem je af met Nordavo."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notities",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Welke documentatie mist er nu in je team?"
     }
    }
   ]
  },
  {
   "key": "developer-1.1",
   "module": "developer-1",
   "position": 1,
   "title": "How Nordavo works: you, your client and Nordavo",
   "summary": "The triangle of client, developer and Nordavo, and who you go to for what.",
   "language": "en",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: Julius or Floris welcomes the developer and explains the triangle: the client, the developer and Nordavo. Who to call for what."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Welcome. Through Nordavo you join a Dutch company as a long-term member of their team. You are not a freelancer on a short project: the idea is that you stay, grow and become a real colleague. You work remotely from India, and Nordavo is there for everything around the work.</p><h2>The triangle</h2><ul><li><strong>Your client</strong> is the company you work for every day. Your manager there gives you work, sets priorities and gives you feedback. You use their tools and follow their way of working.</li><li><strong>You</strong> do the work, communicate about it and take ownership of it.</li><li><strong>Nordavo</strong> found you, arranges your contract, your pay and your leave, and helps both sides make the collaboration work.</li></ul><h2>Who do you go to?</h2><ul><li><strong>Questions about your work</strong> (a task, a priority, a technical choice): your manager or your buddy at the client.</li><li><strong>Leave, pay, contract, your equipment:</strong> Nordavo.</li><li><strong>Something that does not feel right</strong> and you find it hard to raise with your client: Nordavo. You can always talk to us, and we will not share what you tell us without your permission.</li></ul><h2>The rhythm</h2><p>You will have a few fixed moments:</p><ul><li><strong>Weekly plan on Monday:</strong> what you want to finish this week.</li><li><strong>Daily check-in:</strong> what is done, what is next, where you are stuck.</li><li><strong>Friday review:</strong> what you did against the plan, what went well, what can be better.</li><li><strong>Monthly talk with Nordavo:</strong> how is it going, for you and for your client.</li><li><strong>Pulse every two weeks:</strong> a short question from Nordavo in the Academy. Only Nordavo sees your answers.</li><li><strong>Review after 90 days:</strong> with your client and Nordavo, looking back and ahead.</li></ul><h2>The first 30 days</h2><p>The first month is for settling in. Nobody expects you to know everything. What matters is that you learn quickly, ask questions and communicate openly. If something is not working in the first 30 days, for you or for your client, tell Nordavo early: that is when it is easiest to fix.</p><p>Your Nordavo contact is on your placement page in the Academy. [Nordavo to fill in: how and how quickly Nordavo can be reached.]</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "You have a question about the priority of a task. Who do you ask?",
       "options": [
        "Nordavo",
        "Your manager at the client",
        "Another Nordavo developer"
       ],
       "correct_index": 1,
       "explanation": "Your daily work is organised by your client. Nordavo is there for everything around it."
      },
      {
       "question": "Who arranges your leave and your pay?",
       "options": [
        "Your client",
        "Nordavo",
        "Your buddy"
       ],
       "correct_index": 1,
       "explanation": "Nordavo arranges your contract, pay and leave."
      },
      {
       "question": "Something does not feel right and you find it hard to tell your client. What do you do?",
       "options": [
        "Keep it to yourself",
        "Talk to Nordavo",
        "Post it in the team channel"
       ],
       "correct_index": 1,
       "explanation": "Nordavo is there exactly for this. We help you raise it in the right way."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notes",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "What would you like to ask Nordavo in your first monthly talk?"
     }
    }
   ]
  },
  {
   "key": "developer-1.2",
   "module": "developer-1",
   "position": 2,
   "title": "What Dutch work culture looks like",
   "summary": "Flat hierarchy, directness, punctuality and work-life balance: what to expect in a Dutch team.",
   "language": "en",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: Dutch work culture explained with examples: first names, direct feedback, consensus, being on time and going home on time."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Dutch teams can feel very different from what you are used to. Most of the differences are good news once you understand them.</p><h2>A flat hierarchy</h2><ul><li>Everyone uses first names, including the CEO.</li><li>Your manager expects you to think for yourself, give your opinion and disagree when you think something is wrong. Saying \"yes, sir\" to everything is not respectful in a Dutch team; it makes it hard for them to know what you really think.</li><li>Decisions are often made together after discussion. People call this \"polderen\": talk until there is broad agreement.</li></ul><h2>Directness</h2><p>Dutch people say what they mean. \"This is not a good idea\" is information, not an insult. A Dutch colleague who says your code has a problem is helping you, not attacking you. Later in this course you will learn how to be direct yourself in a way that still feels polite to you.</p><h2>Time</h2><ul><li><strong>Be on time.</strong> A meeting at 10:00 starts at 10:00. If you will be late, send a message before the meeting starts.</li><li><strong>Agendas and plans.</strong> Dutch people plan ahead and like to know what will happen. A short message like \"I expect this to be ready on Thursday\" is very welcome.</li><li><strong>Working hours are respected.</strong> Most Dutch colleagues stop working at the end of the day and do not expect you to reply in the evening. Long hours are not seen as a sign of commitment. Results are.</li></ul><h2>Independence</h2><p>You will often get a problem, not a detailed instruction. Your manager trusts you to find a good solution. If something is unclear, ask; if you see a better way, propose it.</p><h2>Informal, but professional</h2><p>Dutch teams are relaxed: jeans, jokes, birthdays with cake. At the same time, people expect you to keep your promises. If you say it will be done on Thursday, it is done on Thursday, or you let them know before Thursday that it will not be.</p><blockquote><p>In a Dutch team, honesty is politeness.</p></blockquote>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Your manager suggests an approach you think is wrong. What do you do?",
       "options": [
        "Do it anyway, the manager decides",
        "Say what you think and explain why",
        "Ask Nordavo to tell the manager"
       ],
       "correct_index": 1,
       "explanation": "In a Dutch team you are expected to give your opinion. Explain your reasons and propose an alternative."
      },
      {
       "question": "A colleague writes \"This is not a good idea\" about your proposal. What does that mean?",
       "options": [
        "They are angry with you",
        "They are giving honest feedback about the idea",
        "You will be replaced"
       ],
       "correct_index": 1,
       "explanation": "Dutch directness is about the idea, not about you."
      },
      {
       "question": "You will be ten minutes late for a call. What do you do?",
       "options": [
        "Join late and apologise",
        "Send a message before the call starts",
        "Skip the call"
       ],
       "correct_index": 1,
       "explanation": "Being on time matters. If you will be late, let them know before it starts."
      }
     ]
    }
   ]
  },
  {
   "key": "developer-1.3",
   "module": "developer-1",
   "position": 3,
   "title": "Time zones and the overlap window",
   "summary": "The time difference with the Netherlands, when it changes, and how to use the overlap window.",
   "language": "en",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: The time difference between India and the Netherlands, daylight saving time, and how to plan your day around the overlap window."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>India uses India Standard Time (IST) all year. The Netherlands changes its clocks twice a year. So the difference changes too.</p><h2>The time difference</h2><ul><li><strong>Dutch winter time</strong> (end of October to end of March): the Netherlands is <strong>4.5 hours behind</strong> India. 13:30 in Bangalore is 09:00 in Amsterdam.</li><li><strong>Dutch summer time</strong> (end of March to end of October): the Netherlands is <strong>3.5 hours behind</strong> India. 12:30 in Bangalore is 09:00 in Amsterdam.</li></ul><p>You start your day before your Dutch colleagues. That gives you quiet hours in the morning to focus.</p><h2>The overlap window</h2><p>The overlap window is a fixed block every working day when you and your client are both online. You will find it on your placement page. In the overlap window:</p><ul><li>you are online and reply quickly;</li><li>you join calls such as the stand-up and planning;</li><li>you ask the questions you collected in the morning.</li></ul><p>Outside the window you work independently on what was agreed.</p><h2>Plan your day</h2><ol><li><strong>Morning (before the overlap):</strong> read what your client left for you, work on your tasks, and write down your questions.</li><li><strong>Overlap window:</strong> calls, questions, reviews, decisions.</li><li><strong>After the overlap:</strong> finish what you can, and write your update so your manager can read it when they start.</li></ol><h2>When the clocks change</h2><p>When the Netherlands changes to summer or winter time, the overlap window in your time moves by one hour if your client keeps it the same in Dutch time. Check with your manager a week before, and update your calendar.</p><h2>Tips</h2><ul><li>Show both time zones in your calendar.</li><li>Always mention the time zone in messages: \"I will send it by 16:00 IST (12:30 CET)\".</li><li>If you cannot be online during part of the window, tell your manager in advance.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "It is January and 15:00 in Bangalore. What time is it in Amsterdam?",
       "options": [
        "10:30",
        "11:30",
        "12:30"
       ],
       "correct_index": 0,
       "explanation": "In Dutch winter time the Netherlands is 4.5 hours behind India: 15:00 becomes 10:30."
      },
      {
       "question": "What do you do in the overlap window?",
       "options": [
        "Only focused work without interruptions",
        "Calls, questions, reviews and decisions",
        "Nothing special"
       ],
       "correct_index": 1,
       "explanation": "The overlap window is the shared time for everything you need to do together."
      },
      {
       "question": "Why does the time difference change twice a year?",
       "options": [
        "Because India has daylight saving time",
        "Because the Netherlands has daylight saving time and India does not",
        "Because the client decides"
       ],
       "correct_index": 1,
       "explanation": "India uses IST all year. The Netherlands moves its clocks in March and October."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Tasks",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Add the Dutch time zone as a second time zone in your calendar",
       "description": null,
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": false,
       "required": true
      },
      {
       "title": "Confirm the overlap window with your manager and put it in your calendar",
       "description": "Every working day, in your own time zone.",
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "developer-2.1",
   "module": "developer-2",
   "position": 1,
   "title": "Directness: hearing it and using it",
   "summary": "How to receive direct feedback without taking it personally, and how to be direct yourself.",
   "language": "en",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: Examples of Dutch direct feedback and how to respond. How to disagree respectfully."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Dutch colleagues say what they think, often without softening words. For many people from India this feels harsh at first. It helps to know that it is meant as respect: they trust you enough to be honest.</p><h2>Hearing direct feedback</h2><p>When someone says \"This code is hard to read\":</p><ul><li><strong>It is about the code, not about you.</strong> They want the code to be better.</li><li><strong>Ask what they mean.</strong> \"Which part is hard to read? What would you change?\"</li><li><strong>Thank them.</strong> \"Thanks, I will split the function.\" That is all that is needed.</li><li><strong>Do not over-apologise.</strong> One \"sorry, my mistake\" is fine. Five times is uncomfortable for a Dutch colleague.</li></ul><h2>Being direct yourself</h2><p>You do not have to become Dutch. But you do need to say clearly what you think, especially when:</p><ul><li>you think a plan or a deadline will not work;</li><li>you do not understand something;</li><li>you disagree with a technical choice;</li><li>you see a risk.</li></ul><p>A simple pattern that is direct and still polite:</p><ol><li><strong>Say what you see.</strong> \"I think this approach will make the export slow for large customers.\"</li><li><strong>Explain why.</strong> \"It loads all rows in memory.\"</li><li><strong>Propose something.</strong> \"I suggest we stream the rows. It will take one more day.\"</li></ol><h2>Words to avoid</h2><ul><li>\"It might be a little difficult\" when you mean \"this will not work\". Your Dutch colleague will hear \"it is fine\".</li><li>\"I will try\" when you mean \"probably not\". Say \"I can do A by Thursday, B will take until next week\".</li><li>\"Yes\" when you mean \"I heard you\". Say \"Let me check and come back to you\".</li></ul><h2>Disagreeing with your manager</h2><p>It is normal and expected. Do it in a call or a private message, explain your reasons and accept the decision once it is made. Your manager will respect you more, not less.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "A colleague says \"This function is too long\". What is the best reply?",
       "options": [
        "Sorry, sorry, I am very sorry",
        "Thanks, which part would you split?",
        "Say nothing and change nothing"
       ],
       "correct_index": 1,
       "explanation": "Ask what they mean and act on it. No need to over-apologise."
      },
      {
       "question": "You think a deadline is not realistic. What do you say?",
       "options": [
        "It might be a little difficult",
        "I can finish A by Thursday; B will take until next Tuesday",
        "Yes, no problem"
       ],
       "correct_index": 1,
       "explanation": "Be concrete about what is possible. Vague words will be heard as \"it is fine\"."
      },
      {
       "question": "Which pattern is direct and polite?",
       "options": [
        "Say what you see, explain why, propose something",
        "Wait until someone asks",
        "Complain to a colleague"
       ],
       "correct_index": 0,
       "explanation": "Observation, reason and a proposal: clear and constructive."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notes",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Write down one thing you would like to say more directly at work this week."
     }
    }
   ]
  },
  {
   "key": "developer-2.2",
   "module": "developer-2",
   "position": 2,
   "title": "Asking questions and saying no",
   "summary": "Why good questions make you look stronger, and how to say no to a request.",
   "language": "en",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: Examples of good questions and of saying no with an alternative."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Many developers are afraid that asking questions shows they are not good enough. In a Dutch team it is the opposite: asking questions shows you think, and it prevents days of work in the wrong direction.</p><h2>When to ask</h2><ul><li>The goal of a task is not clear.</li><li>You see two ways to do something and the choice matters.</li><li>You have been stuck for longer than you agreed with your manager (see module 3).</li><li>You do not understand a word, an abbreviation or a piece of the product.</li></ul><h2>How to ask a good question</h2><ul><li><strong>Give context.</strong> \"I am working on the invoice export.\"</li><li><strong>Say what you tried.</strong> \"I checked the docs and the code in invoice_service.\"</li><li><strong>Ask one specific question.</strong> \"Should the export include cancelled invoices?\"</li><li><strong>Suggest an answer if you can.</strong> \"I would leave them out, unless you want them.\"</li></ul><p>Collect non-urgent questions and ask them together in the overlap window.</p><h2>Check that you understood</h2><p>After a task is explained, repeat it in your own words: \"So I will do X and Y, and it is done when Z. Correct?\" It takes one minute and it saves a lot of time.</p><h2>Saying no</h2><p>Sometimes you cannot do what is asked: there is too much work, the deadline is too close, or the request conflicts with something else. Saying \"yes\" and then not delivering is much worse than saying no.</p><ul><li><strong>Be honest early.</strong> \"I cannot do this by Friday.\"</li><li><strong>Explain.</strong> \"I am still working on the payment bug, which you said is the priority.\"</li><li><strong>Offer a choice.</strong> \"I can do this by Tuesday, or I can stop the bug and do this first. Which do you prefer?\"</li></ul><p>Your manager decides the priority; you make sure they have the information to decide.</p><h2>In short</h2><ul><li>Ask early, with context and one clear question.</li><li>Repeat a task in your own words.</li><li>Say no early, explain why and offer a choice. Your manager decides the priority.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Which question is the best?",
       "options": [
        "Help?",
        "I am working on the export and checked the docs. Should cancelled invoices be included? I would leave them out.",
        "Can we have a call?"
       ],
       "correct_index": 1,
       "explanation": "Context, what you tried, one clear question and a suggestion."
      },
      {
       "question": "Your manager asks for something you cannot finish in time. What do you do?",
       "options": [
        "Say yes and work late",
        "Say so early, explain and offer a choice",
        "Say nothing and see what happens"
       ],
       "correct_index": 1,
       "explanation": "Being honest early gives your manager the chance to decide on the priority."
      },
      {
       "question": "Why do you repeat a task in your own words?",
       "options": [
        "To show your English",
        "To check that you understood it correctly",
        "Because it is required by Nordavo"
       ],
       "correct_index": 1,
       "explanation": "Repeating it shows quickly if there is a misunderstanding."
      }
     ]
    }
   ]
  },
  {
   "key": "developer-2.3",
   "module": "developer-2",
   "position": 3,
   "title": "Writing clear updates: the daily check-in",
   "summary": "A short format for your daily update that your manager can read in one minute.",
   "language": "en",
   "minutes": 8,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: The daily check-in format with examples of a good and a weak update."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Your manager starts the day a few hours after you. The first thing they should see is a short, clear update from you. That is the daily check-in.</p><h2>The format</h2><p>Three lines are enough:</p><ul><li><strong>Done:</strong> what you finished since the last check-in.</li><li><strong>Next:</strong> what you will work on now.</li><li><strong>Blocked:</strong> what is stopping you, and what you need. Write \"nothing\" if nothing is blocking you.</li></ul><h2>A weak update</h2><blockquote><p>Working on the ticket. Will update.</p></blockquote><p>Your manager does not know which ticket, how far you are, or whether you need help.</p><h2>A good update</h2><blockquote><p>Done: invoice PDF shows the correct VAT rate, PR #214 is ready for review.<br>Next: the export for large customers (ticket 231). I expect a first version on Thursday.<br>Blocked: I need access to the staging database to test the export. Can someone give me access?</p></blockquote><h2>Tips</h2><ul><li><strong>Be specific.</strong> Use ticket numbers and links.</li><li><strong>Share bad news early.</strong> \"The export is taking longer than expected; I now expect Friday instead of Thursday.\" Early bad news is good news for a Dutch manager.</li><li><strong>Short sentences.</strong> Simple English is easier to read for everyone.</li><li><strong>Same time, same place.</strong> Post it at a fixed time in the channel you agreed with your manager.</li></ul><h2>In a call</h2><p>If your team has a daily stand-up, use the same three points. Keep it to one or two minutes and save details for after the stand-up.</p><h2>Your end-of-day note</h2><p>Because your manager starts later, a short note at the end of your day helps too:</p><blockquote><p>End of day: export first version is on the test environment. Tomorrow I start with the tests. Two questions for you in the thread below.</p></blockquote><p>Your manager reads it at the start of their day and can answer before your next morning. That way nobody waits on the other.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "What are the three parts of the daily check-in?",
       "options": [
        "Done, next, blocked",
        "Hours, tickets, mood",
        "Morning, afternoon, evening"
       ],
       "correct_index": 0,
       "explanation": "Done, next and blocked: your manager knows where you stand in one minute."
      },
      {
       "question": "Your task will take a day longer than you said. When do you share it?",
       "options": [
        "When the deadline has passed",
        "As soon as you know",
        "Only if someone asks"
       ],
       "correct_index": 1,
       "explanation": "Early bad news gives your manager time to plan."
      },
      {
       "question": "Nothing is blocking you. What do you write under blocked?",
       "options": [
        "Leave it out",
        "Nothing",
        "Everything is perfect"
       ],
       "correct_index": 1,
       "explanation": "Writing \"nothing\" makes it clear that you checked and are not stuck."
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notes",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "Write your check-in for today in the done, next, blocked format."
     }
    }
   ]
  },
  {
   "key": "developer-3.1",
   "module": "developer-3",
   "position": 1,
   "title": "Nordavo policies: leave, working from home, conduct and compensation",
   "summary": "Where to find the Nordavo policies and what they cover.",
   "language": "en",
   "minutes": 8,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: Julius or Floris walks through the Nordavo policies: leave, working from home, code of conduct and compensation, and where to find them."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>As a Nordavo developer you work under a few Nordavo policies. They are in the documents below. Read them once now and look them up when you need them. If something is unclear, ask Nordavo, not your client.</p><h2>Leave Policy</h2><p>How many days of leave you have, how you request leave in the Academy, and how it is agreed with your client. Your leave balance and requests are on your placement page.</p><ul><li>Request leave in the Academy, well in advance.</li><li>Nordavo agrees it with your client; you see the status on your placement page.</li><li>Public holidays in Karnataka and the Netherlands are on your placement page too.</li></ul><p>[Nordavo to fill in: a one-line summary once the Leave Policy is uploaded.]</p><h2>Work From Home Policy</h2><p>What Nordavo expects from your workplace: a quiet place to work, a stable internet connection, being reachable in the overlap window, and what to do if your power or internet fails.</p><p>[Nordavo to fill in: a one-line summary once the Work From Home Policy is uploaded.]</p><h2>Code of Conduct</h2><p>How we work with clients, colleagues and each other: honesty, respect, confidentiality, and what is not acceptable. It also says where you can go if you experience something that is not right.</p><p>[Nordavo to fill in: a one-line summary once the Code of Conduct is uploaded.]</p><h2>Compensation Policy</h2><p>How your pay works, when you are paid and how reviews of your compensation take place. Your compensation is between you and Nordavo: your client does not see it, and you do not discuss it with your client.</p><p>[Nordavo to fill in: a one-line summary once the Compensation Policy is uploaded.]</p><h2>Questions</h2><p>Questions about any of these policies go to your Nordavo contact, who is on your placement page.</p><h2>Placement documents</h2><p>Besides these policies, your placement page has documents for your placement, such as a contract summary and the escalation matrix. They are marked \"new\" when they change.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Where do you request leave?",
       "options": [
        "By mail to your client",
        "In the Academy; Nordavo agrees it with your client",
        "You do not need to request leave"
       ],
       "correct_index": 1,
       "explanation": "You request leave in the Academy. Nordavo agrees it with your client."
      },
      {
       "question": "Your client asks about your salary. What do you do?",
       "options": [
        "Tell them",
        "Politely say that this is between you and Nordavo, and let Nordavo know",
        "Ask a colleague"
       ],
       "correct_index": 1,
       "explanation": "Compensation is between you and Nordavo. Your client does not see it."
      },
      {
       "question": "You have a question about a policy. Who do you ask?",
       "options": [
        "Your client",
        "Your Nordavo contact",
        "Nobody"
       ],
       "correct_index": 1,
       "explanation": "Questions about Nordavo policies go to Nordavo."
      }
     ]
    },
    {
     "type": "document",
     "title": "Leave Policy",
     "required": true,
     "completion": {},
     "content": {},
     "document": "doc-policy-leave"
    },
    {
     "type": "document",
     "title": "Work From Home Policy",
     "required": true,
     "completion": {},
     "content": {},
     "document": "doc-policy-wfh"
    },
    {
     "type": "document",
     "title": "Code of Conduct",
     "required": true,
     "completion": {},
     "content": {},
     "document": "doc-policy-conduct"
    },
    {
     "type": "document",
     "title": "Compensation Policy",
     "required": true,
     "completion": {},
     "content": {},
     "document": "doc-policy-compensation"
    }
   ]
  },
  {
   "key": "developer-3.2",
   "module": "developer-3",
   "position": 2,
   "title": "Your week: weekly plan, check-in and Friday review",
   "summary": "How to plan your week so your manager always knows what to expect.",
   "language": "en",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: How to write a weekly plan and a Friday review, with examples."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Working independently does not mean working alone. It means you plan your own work, keep your promises and make sure your manager always knows where you are. The weekly rhythm makes that easy.</p><h2>The weekly plan (Monday)</h2><p>On Monday, before or at the start of the overlap window, send your manager a short plan for the week:</p><ul><li><strong>Goals:</strong> two to five things you want to finish this week, with ticket numbers.</li><li><strong>Expected dates:</strong> when you expect each one to be done.</li><li><strong>Risks:</strong> anything that could stop you, such as a dependency on someone else.</li><li><strong>Away:</strong> leave, a public holiday or anything else that affects your time.</li></ul><p>Your manager confirms or changes the priorities. Now you both know what this week is about.</p><h2>Example</h2><blockquote><p>Weekly plan, week 14<br>1. Finish the VAT fix (ticket 212), Tuesday.<br>2. Export for large customers (ticket 231), first version Thursday.<br>3. Add tests for the invoice service, Friday.<br>Risk: I need staging database access for 2.<br>Away: Friday is Ugadi, a public holiday in Karnataka, so I will finish 3 on Thursday.</p></blockquote><h2>The daily check-in</h2><p>Every day: done, next, blocked (module 2). If the plan changes during the week, say so in the check-in.</p><h2>The Friday review</h2><p>On Friday, look back with your manager:</p><ul><li>What did you finish, compared with the plan?</li><li>What did not get done, and why?</li><li>What went well, and what would you do differently?</li><li>Is there anything you need for next week?</li></ul><p>Be honest. A plan that was not finished is not a problem if you explain it and learn from it. A plan that silently disappears is.</p><h2>In short</h2><ul><li>Monday: weekly plan with goals, dates, risks and time away.</li><li>Every day: done, next, blocked.</li><li>Friday: review against the plan, honestly.</li><li>Keep your plans and reviews in one place, so you and your manager can look back at the 90-day review.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "What belongs in a weekly plan?",
       "options": [
        "Goals with expected dates, risks and time away",
        "Only the hours you will work",
        "A list of all open tickets"
       ],
       "correct_index": 0,
       "explanation": "Goals, dates, risks and time away tell your manager what to expect."
      },
      {
       "question": "Halfway through the week the plan changes. What do you do?",
       "options": [
        "Wait for the Friday review",
        "Say so in the daily check-in",
        "Change the plan without telling anyone"
       ],
       "correct_index": 1,
       "explanation": "Share changes as soon as they happen, in the check-in."
      },
      {
       "question": "You did not finish a goal. What matters most on Friday?",
       "options": [
        "Hiding it",
        "Explaining why and what you learned",
        "Working through the weekend"
       ],
       "correct_index": 1,
       "explanation": "An honest explanation is fine. A plan that silently disappears is not."
      }
     ]
    },
    {
     "type": "assignment",
     "title": "Write your weekly plan",
     "required": true,
     "completion": {
      "require": "submitted"
     },
     "content": {
      "prompt": "Write your weekly plan for next week (or, if you are not placed yet, for an example project): your goals with expected dates, risks and time away. Use the format from this lesson. Nordavo gives you feedback on clarity and English.",
      "formats": [
       "text",
       "file",
       "link"
      ]
     }
    },
    {
     "type": "tasks",
     "title": "Tasks",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Send your first weekly plan to your manager on Monday",
       "description": null,
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": true,
       "required": true
      },
      {
       "title": "Do your first Friday review with your manager",
       "description": null,
       "deadline_offset_days": 4,
       "shared": false,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "developer-3.3",
   "module": "developer-3",
   "position": 3,
   "title": "When you are stuck: blockers and decisions",
   "summary": "How long to try alone, how to report a blocker and which decisions you can take yourself.",
   "language": "en",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: The blocker agreement and the levels of decision making, with examples."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Every developer gets stuck sometimes. The question is what you do then. Struggling alone for two days is the most expensive answer, for you and for your client.</p><h2>The blocker agreement</h2><p>With your manager you agree:</p><ul><li><strong>How long you try on your own</strong> before you ask for help, for example an hour. Agree on what fits your work.</li><li><strong>Where and to whom</strong> you report it: your manager, your buddy, a fixed channel.</li><li><strong>What you do while you wait:</strong> another task from your list, documentation, tests.</li></ul><h2>A good blocker message</h2><blockquote><p>I am stuck on the export for large customers (ticket 231).<br>I am trying to stream rows from the database, but the connection closes after 30 seconds.<br>I tried increasing the timeout in the config and checked the logs; the error is \"connection reset\".<br>I need: someone who knows the database proxy settings. Meanwhile I am working on the invoice tests.</p></blockquote><p>What you are doing, what you tried, what you need, and what you do in the meantime.</p><h2>Decisions: how much can you decide?</h2><p>Your manager decides how much room you have. Typical levels:</p><ol><li><strong>Do what was asked.</strong> The task is fixed.</li><li><strong>Investigate and propose.</strong> You look at the options and propose; your manager decides.</li><li><strong>Decide and inform.</strong> You decide and let your manager know what you chose.</li><li><strong>Decide yourself.</strong> Small things like naming, tests and small improvements.</li></ol><p>If you do not know which level applies, ask: \"Can I decide this myself, or do you want to decide?\" After a while your manager will give you more room. Use it.</p><h2>Outside the overlap window</h2><p>If you are stuck while your manager is offline, write the blocker message anyway, so it is the first thing they read, and continue with another task.</p><h2>In short</h2><ul><li>Agree how long you try alone, and stick to it.</li><li>A blocker message: what, tried, need, meanwhile.</li><li>Ask which decision level applies.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "You have been stuck for longer than you agreed. What do you do?",
       "options": [
        "Keep trying until it works",
        "Send a blocker message and pick up another task",
        "Stop working"
       ],
       "correct_index": 1,
       "explanation": "Report it as agreed and keep working on something else."
      },
      {
       "question": "What is in a good blocker message?",
       "options": [
        "What you do, what you tried, what you need, what you do meanwhile",
        "Only \"I am stuck\"",
        "An apology"
       ],
       "correct_index": 0,
       "explanation": "With this information someone can help you right away."
      },
      {
       "question": "You do not know if you may decide something yourself. What do you do?",
       "options": [
        "Decide and hope it is fine",
        "Ask your manager which level applies",
        "Wait until someone notices"
       ],
       "correct_index": 1,
       "explanation": "Ask. Over time your manager will give you more room."
      }
     ]
    }
   ]
  },
  {
   "key": "developer-3.4",
   "module": "developer-3",
   "position": 4,
   "title": "Escalating: when and how",
   "summary": "When to go to your manager, when to go to Nordavo, and how to write an escalation message.",
   "language": "en",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: The escalation matrix: what you solve yourself, what you raise with your manager and what you raise with Nordavo. An example escalation message."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Escalating means bringing in someone who can help when you cannot solve something yourself. It is not complaining and it is not a failure. In a Dutch team, raising a problem early is seen as professional.</p><h2>Three levels</h2><ol><li><strong>Solve it yourself or with your buddy.</strong> Technical problems, small misunderstandings, a question about a task.</li><li><strong>Raise it with your manager.</strong> A blocker you cannot solve, a deadline that will not be met, unclear priorities, a risk for the product.</li><li><strong>Raise it with Nordavo.</strong> Something about the collaboration that you cannot solve with your manager: you do not get enough information or access, you feel treated unfairly, you are asked to work far outside your hours, or something happened that makes you uncomfortable. Also anything about leave, pay or your contract.</li></ol><p>Something serious, such as a security incident or a suspected data leak: tell your manager and Nordavo immediately.</p><h2>How to escalate</h2><p>A good escalation message is calm, factual and specific:</p><ul><li><strong>What is the situation?</strong> Facts, with examples and dates.</li><li><strong>What is the impact?</strong> For the work, the client or you.</li><li><strong>What have you already done?</strong></li><li><strong>What do you need or propose?</strong></li></ul><h2>Example (to your manager)</h2><blockquote><p>Hi Mark, I want to raise a risk about the export (ticket 231). Since Monday I have been waiting for staging database access. I asked in the channel on Monday and Tuesday. Without access I cannot test, so Thursday's first version will slip. Could you help me get access today? If not, I propose to test with a local copy of the data, which takes one extra day.</p></blockquote><h2>Example (to Nordavo)</h2><blockquote><p>Hi, I would like to talk about my workload. For the last three weeks I have been asked to join calls at 21:00 IST several times a week, outside the overlap window. I mentioned it to my manager once, but it continues. Could we discuss how to raise this?</p></blockquote><h2>The escalation matrix</h2><p>Fill in the worksheet below with your own examples, so you know what to do before it happens.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "You are asked several times a week to join calls late at night, outside the overlap window, and talking to your manager did not help. Who do you go to?",
       "options": [
        "Nobody, it is part of the job",
        "Nordavo",
        "Another client"
       ],
       "correct_index": 1,
       "explanation": "This is about the collaboration and your working hours. Nordavo helps you solve it."
      },
      {
       "question": "You suspect a data leak. What do you do?",
       "options": [
        "Wait to be sure",
        "Tell your manager and Nordavo immediately",
        "Fix it quietly"
       ],
       "correct_index": 1,
       "explanation": "Serious incidents are raised immediately, even if you are not sure yet."
      },
      {
       "question": "Which is part of a good escalation message?",
       "options": [
        "Emotions and blame",
        "Facts, impact, what you did and what you need",
        "Only the problem"
       ],
       "correct_index": 1,
       "explanation": "Calm, factual and specific: that makes it easy to help."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Worksheet: Escalation matrix",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-dev-escalation"
    },
    {
     "type": "assignment",
     "title": "Write an escalation message",
     "required": true,
     "completion": {
      "require": "submitted"
     },
     "content": {
      "prompt": "Write an escalation message for a realistic situation: either a blocker you would raise with your manager, or a concern you would raise with Nordavo. Use the four parts: situation, impact, what you already did, what you need or propose. Nordavo gives you feedback.",
      "formats": [
       "text",
       "file",
       "link"
      ]
     }
    }
   ]
  },
  {
   "key": "developer-4.1",
   "module": "developer-4",
   "position": 1,
   "title": "Quality you can show",
   "summary": "Definition of done, tests, pull requests and code reviews in a Dutch team.",
   "language": "en",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: What clients mean by quality: definition of done, tests, a good pull request and how to handle review comments."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Your client judges your work on what they can see: does it work, is it easy to review, does it stay working. Quality you can show builds trust faster than speed.</p><h2>Definition of done</h2><p>Ask your team what \"done\" means for them. Usually something like:</p><ul><li>the code works for the described cases, including edge cases;</li><li>there are tests;</li><li>the pull request is reviewed and approved;</li><li>it is deployed to the test or production environment;</li><li>documentation is updated where needed.</li></ul><p>\"It works on my machine\" is not done.</p><h2>A good pull request</h2><ul><li><strong>Small.</strong> One change per pull request. Big pull requests wait longer for review and hide mistakes.</li><li><strong>A clear description.</strong> What does it change, why, and how did you test it? Add a screenshot for visual changes.</li><li><strong>Linked to the ticket.</strong></li><li><strong>Checked by yourself first.</strong> Read your own diff before you ask for review. Remove debug code and commented-out code.</li></ul><h2>Code reviews</h2><p>When you receive comments:</p><ul><li>Thank the reviewer and answer every comment, even with \"done\".</li><li>If you disagree, explain why. A discussion is fine.</li><li>Do not take it personally (module 2).</li></ul><p>When you review others:</p><ul><li>Be specific and kind: \"Could we extract this into a function? It would make the test easier.\"</li><li>Explain why, not only what.</li><li>Approve when it is good enough, not only when it is perfect.</li></ul><h2>Tests</h2><p>Write tests for what you build and for bugs you fix: a test that fails before your fix and passes after. It shows your client that the bug will not come back.</p><h2>Own your mistakes</h2><p>Everyone makes mistakes. If something you built breaks, say so immediately, help fix it and suggest how to prevent it next time. That is what a Dutch team expects from a senior colleague.</p><h2>In short</h2><ul><li>Ask what \"done\" means in your team.</li><li>Small pull requests, clear descriptions, checked by yourself first.</li><li>Test what you build and the bugs you fix.</li><li>Own your mistakes.</li></ul>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "Which pull request gets reviewed fastest?",
       "options": [
        "A big one with many changes",
        "A small one with a clear description",
        "One without a description"
       ],
       "correct_index": 1,
       "explanation": "Small pull requests with a clear description are easy to review."
      },
      {
       "question": "You fixed a bug. What do you add?",
       "options": [
        "Nothing",
        "A test that fails before the fix and passes after",
        "A comment in the code"
       ],
       "correct_index": 1,
       "explanation": "A test shows the bug will not come back."
      },
      {
       "question": "Something you built breaks in production. What do you do?",
       "options": [
        "Wait until someone notices",
        "Say so immediately and help fix it",
        "Blame the reviewer"
       ],
       "correct_index": 1,
       "explanation": "Owning your mistakes builds trust."
      }
     ]
    }
   ]
  },
  {
   "key": "developer-4.2",
   "module": "developer-4",
   "position": 2,
   "title": "Security and client data",
   "summary": "How to keep your client's code, data and accounts safe when you work remotely.",
   "language": "en",
   "minutes": 12,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: Security basics for remote work: accounts, devices, client data, AI tools and what to do in an incident."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Your client trusts you with their code, their systems and often their customers' data. One mistake can be very expensive for them, and in Europe there are strict rules about personal data (the GDPR, in Dutch \"AVG\"). Security is part of your job.</p><h2>Accounts and passwords</h2><ul><li>Use a password manager and a different password for every account.</li><li>Turn on two-factor authentication everywhere you can, starting with your mail, code hosting and the Academy.</li><li>Never share your accounts, not even with a colleague.</li></ul><h2>Your device and workplace</h2><ul><li>Keep your operating system and software up to date.</li><li>Lock your screen when you walk away.</li><li>Use the client's VPN when they ask you to.</li><li>Do not work on client code on a shared or public computer.</li><li>Be careful on public Wi-Fi.</li></ul><p>[Nordavo to fill in: Nordavo's rules for devices and workplaces, if any, or a reference to the Work From Home Policy.]</p><h2>Client code and data</h2><ul><li>Keep client code in the client's systems. Do not copy it to personal accounts, personal repositories or a USB stick.</li><li>Use test data where you can. Do not download production data unless your client asks you to and it is necessary.</li><li>Do not paste client code or data into AI tools or online services unless your client has said which tools are allowed.</li><li>Secrets (keys, passwords, tokens) never go into code or chat. Use the client's secret management.</li></ul><h2>Personal data</h2><p>Personal data is anything about a person: names, mail addresses, phone numbers, IP addresses. Only look at what you need for your task, and never share it outside the client's systems.</p><h2>Incidents</h2><p>If you think something went wrong (a lost laptop, a leaked password, a secret in a public repository, a suspected hack): tell your client and Nordavo <strong>immediately</strong>. Do not wait until you are sure and do not try to hide it. Fast reporting limits the damage.</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "May you paste client code into an AI tool?",
       "options": [
        "Yes, always",
        "Only if your client has said which tools are allowed",
        "Only for small pieces"
       ],
       "correct_index": 1,
       "explanation": "Client code and data go only into tools your client has approved."
      },
      {
       "question": "You accidentally pushed a secret to a public repository. What do you do?",
       "options": [
        "Delete the commit and say nothing",
        "Tell your client and Nordavo immediately",
        "Wait to see if anyone notices"
       ],
       "correct_index": 1,
       "explanation": "Report it immediately: the secret must be rotated and fast reporting limits the damage."
      },
      {
       "question": "Which of these is personal data?",
       "options": [
        "A customer's mail address",
        "The name of a function",
        "A product price"
       ],
       "correct_index": 0,
       "explanation": "Personal data is anything about a person, such as a mail address."
      }
     ]
    },
    {
     "type": "tasks",
     "title": "Tasks",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Turn on two-factor authentication for your mail, code hosting and the Academy",
       "description": null,
       "deadline_offset_days": 0,
       "shared": false,
       "placement_only": false,
       "required": true
      },
      {
       "title": "Ask your manager which AI tools and online services you may use with client code",
       "description": null,
       "deadline_offset_days": 4,
       "shared": false,
       "placement_only": true,
       "required": true
      }
     ]
    }
   ]
  },
  {
   "key": "developer-4.3",
   "module": "developer-4",
   "position": 3,
   "title": "Growing in your role: feedback and the 90-day review",
   "summary": "How to grow from doing tasks to owning part of the product, and how to prepare your 90-day review.",
   "language": "en",
   "minutes": 10,
   "blocks": [
    {
     "type": "video",
     "title": "Video",
     "required": true,
     "completion": {
      "min_percent": 90
     },
     "content": {
      "transcript": true,
      "recording_note": "Draft: Julius and Floris check the text and record this video. Content: Growth paths for Nordavo developers and how to prepare the 90-day review."
     }
    },
    {
     "type": "explanation",
     "title": "Explanation",
     "required": true,
     "completion": {},
     "content": {
      "html": "<p>Nordavo places you for the long term. That means you can grow: from doing tasks, to owning a part of the product, to helping new colleagues. Growth does not happen by itself. You can steer it.</p><h2>From tasks to ownership</h2><ul><li><strong>Understand the why.</strong> Ask who uses what you build and what problem it solves.</li><li><strong>Propose improvements.</strong> If you see something that can be better, write it down and propose it.</li><li><strong>Take ownership.</strong> Ask your manager if you can become the owner of a part you know well.</li><li><strong>Help others.</strong> Review code, document what you learn, help the next new developer.</li></ul><h2>Asking for feedback</h2><p>Do not wait for the review. Ask regularly, for example in the Friday review:</p><ul><li>\"What is one thing I could do better?\"</li><li>\"Was my update this week clear enough?\"</li><li>\"Is there anything you would like me to take more ownership of?\"</li></ul><h2>The pulse</h2><p>Every two weeks Nordavo asks you in the Academy how it is going. Only Nordavo sees your answers. Be honest: it helps us notice early if something needs attention, and it is not shared with your client without your permission.</p><h2>The 90-day review</h2><p>After 90 days you, your client and Nordavo look back and ahead. Prepare it with the worksheet below:</p><ol><li>What went well in the first three months?</li><li>What did you find difficult, and what did you learn?</li><li>What would you like to do more of, or take ownership of?</li><li>What do you need from your client or from Nordavo?</li><li>What are your goals for the next three months?</li></ol><h2>Long term</h2><p>Growth can also mean new skills, a bigger role or a different kind of work. Talk to Nordavo about where you want to go. [Nordavo to fill in: how Nordavo supports growth, such as training or a learning budget, if applicable.]</p>"
     }
    },
    {
     "type": "knowledge_check",
     "title": "Knowledge check",
     "required": true,
     "completion": {
      "min_percent": 0
     },
     "content": {},
     "questions": [
      {
       "question": "When do you ask for feedback?",
       "options": [
        "Only at the 90-day review",
        "Regularly, for example in the Friday review",
        "Never, you wait until it is given"
       ],
       "correct_index": 1,
       "explanation": "Asking regularly helps you grow faster."
      },
      {
       "question": "Who sees your pulse answers?",
       "options": [
        "Your client",
        "Only Nordavo",
        "The whole team"
       ],
       "correct_index": 1,
       "explanation": "Only Nordavo sees your answers."
      },
      {
       "question": "Which is a step towards ownership?",
       "options": [
        "Only doing the tasks you get",
        "Proposing improvements and helping others",
        "Working longer hours"
       ],
       "correct_index": 1,
       "explanation": "Ownership grows by thinking along, proposing and helping others."
      }
     ]
    },
    {
     "type": "worksheet",
     "title": "Worksheet: 90-day review: preparation",
     "required": true,
     "completion": {},
     "content": {},
     "document": "ws-dev-growth"
    },
    {
     "type": "tasks",
     "title": "Tasks",
     "required": true,
     "completion": {},
     "content": {},
     "tasks": [
      {
       "title": "Fill in the 90-day review worksheet, at least a week before the review",
       "description": null,
       "deadline_offset_days": 82,
       "shared": false,
       "placement_only": true,
       "required": true
      }
     ]
    },
    {
     "type": "notes",
     "title": "Notes",
     "required": false,
     "completion": {},
     "content": {
      "scope": "lesson",
      "prompt": "What would you like to be able to do in a year from now?"
     }
    }
   ]
  }
 ]
}
$seed$::jsonb;
  v_lesson jsonb;
  v_block jsonb;
  v_item jsonb;
  v_doc jsonb;
  v_module_id uuid;
  v_lesson_id uuid;
  v_block_id uuid;
  v_doc_id uuid;
  v_block_key text;
  v_rows integer;
  v_added integer := 0;
  v_b integer;
  v_i integer;
begin
  for v_lesson in select value from jsonb_array_elements(v_data -> 'lessons') loop
    select m.id into v_module_id from public.academy_modules m where m.seed_key = v_lesson ->> 'module';
    continue when v_module_id is null;

    v_lesson_id := md5('nordavo-academy-start:' || (v_lesson ->> 'key'))::uuid;
    insert into public.academy_lessons (id, title, summary, language, status, duration_minutes, created_by)
    values (
      v_lesson_id, v_lesson ->> 'title', v_lesson ->> 'summary', v_lesson ->> 'language', 'published',
      (v_lesson ->> 'minutes')::integer, null
    )
    on conflict (id) do nothing;
    get diagnostics v_rows = row_count;
    -- Already there (possibly edited): leave the lesson and its blocks alone.
    continue when v_rows = 0;
    v_added := v_added + 1;

    insert into public.academy_module_lessons (module_id, lesson_id, position)
    values (v_module_id, v_lesson_id, (v_lesson ->> 'position')::double precision)
    on conflict do nothing;

    v_b := 0;
    for v_block in select value from jsonb_array_elements(v_lesson -> 'blocks') loop
      v_b := v_b + 1;
      v_block_key := (v_lesson ->> 'key') || ':block:' || v_b;
      v_block_id := md5('nordavo-academy-start:' || v_block_key)::uuid;

      -- Shared document (worksheet or download): created once, reused.
      v_doc_id := null;
      if v_block ? 'document' then
        v_doc := v_data -> 'documents' -> (v_block ->> 'document');
        v_doc_id := md5('nordavo-academy-start:document:' || (v_block ->> 'document'))::uuid;
        insert into public.academy_documents (id, title, description, kind, scope, category, worksheet_fields, created_by)
        values (
          v_doc_id, v_doc ->> 'title', v_doc ->> 'description', v_doc ->> 'kind', 'global', v_doc ->> 'category',
          coalesce(v_doc -> 'fields', '[]'::jsonb), null
        )
        on conflict (id) do nothing;
      end if;

      insert into public.academy_lesson_blocks (id, lesson_id, type, position, title, content, required, completion, document_id)
      values (
        v_block_id, v_lesson_id, v_block ->> 'type', v_b, v_block ->> 'title',
        coalesce(v_block -> 'content', '{}'::jsonb), (v_block ->> 'required')::boolean,
        coalesce(v_block -> 'completion', '{}'::jsonb), v_doc_id
      )
      on conflict (id) do nothing;

      v_i := 0;
      for v_item in select value from jsonb_array_elements(coalesce(v_block -> 'tasks', '[]'::jsonb)) loop
        v_i := v_i + 1;
        insert into public.academy_tasks (id, block_id, title, description, position, deadline_offset_days, shared, placement_only, required)
        values (
          md5('nordavo-academy-start:' || v_block_key || ':task:' || v_i)::uuid, v_block_id,
          v_item ->> 'title', v_item ->> 'description', v_i, (v_item ->> 'deadline_offset_days')::integer,
          (v_item ->> 'shared')::boolean, (v_item ->> 'placement_only')::boolean, (v_item ->> 'required')::boolean
        )
        on conflict (id) do nothing;
      end loop;

      v_i := 0;
      for v_item in select value from jsonb_array_elements(coalesce(v_block -> 'questions', '[]'::jsonb)) loop
        v_i := v_i + 1;
        insert into public.academy_check_questions (id, block_id, position, question, options, correct_index, explanation)
        values (
          md5('nordavo-academy-start:' || v_block_key || ':question:' || v_i)::uuid, v_block_id, v_i,
          v_item ->> 'question', v_item -> 'options', (v_item ->> 'correct_index')::integer, v_item ->> 'explanation'
        )
        on conflict (id) do nothing;
      end loop;
    end loop;
  end loop;

  return v_added;
end;
$fn$;

comment on function public.academy_seed_start_curriculum() is
  'Adds the lessons of the start curriculum that are missing (stable ids); never changes existing lessons. Returns the number added.';

revoke execute on function public.academy_seed_start_curriculum() from public, anon, authenticated;
grant execute on function public.academy_seed_start_curriculum() to service_role;

select public.academy_seed_start_curriculum();

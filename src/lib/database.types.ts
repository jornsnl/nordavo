// Hand-written to match supabase/migrations. Regenerate with
// `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`
// once the project exists, then keep the aliases at the bottom.

import type { WorkFunctions, WorkTables } from "@/lib/work/database";
import type { FormsFunctions, FormsTables } from "@/lib/forms/database";
import type { AcademyFunctions, AcademyTables } from "@/lib/academy/database";
import type { AcademyAtsFunctions, AcademyAtsTables } from "@/lib/academy/ats/database";
import type {
  ActivityDirection,
  ActivityType,
  CompanyCategory,
  ContactRole,
  LeadStatus,
  PipelineStage,
  ReviewStatus,
  SalesFunctions,
  SalesTables,
} from "@/lib/sales/database";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * "member" is shown as Internal user. "external": only uses the task tool
 * (/work). "caller": an external caller, sees only the call screen (2.10).
 * "developer" and "candidate": Academy only (/academy), see docs/academy.md.
 */
export type ProfileRole = "admin" | "member" | "client" | "external" | "caller" | "developer" | "candidate";
export type ClientStatus = "lead" | "active" | "inactive";
export type Seniority = "medior" | "senior" | "lead";
export type VacancyStatus = "open" | "on_hold" | "filled" | "closed";
export type CandidateStatus = "available" | "in_process" | "parked" | "placed" | "unavailable";
export type CandidateSeniority = "junior" | "medior" | "senior" | "lead";
/** Pipeline flow, in order (recruitment brief 2.1). */
export type FlowStage =
  | "sourced"
  | "techstack_check"
  | "fill_out"
  | "video_review"
  | "technical_test"
  | "interview"
  | "matched"
  | "client_interview"
  | "final_screening";
/** Flow stages plus placed, and parked / rejected apart from the flow. */
export type ApplicationStage = FlowStage | "placed" | "parked" | "rejected";
/** Channel a candidate came through. */
export type CandidateSource =
  | "linkedin"
  | "naukri"
  | "manatal"
  | "indeed"
  | "monster"
  | "instagram"
  | "referral"
  | "website"
  | "headhunted"
  | "other";
/** applied: came in by themselves; headhunted: approached by Nordavo. */
export type CandidateOrigin = "applied" | "headhunted";
export type CvVerdict = "fit" | "maybe" | "no_fit";
export type BackgroundCheckStatus = "not_started" | "requested" | "passed" | "failed";
export type NoteKind =
  | "note"
  | "call"
  | "screening_call"
  | "video_review"
  | "interview"
  | "client_feedback"
  | "background_check";
/** One row of a screening call: years of experience with a tool (2.12). */
export type ScreeningTool = { tool: string; years: number };
/** Screening (recruitment brief 2.7, 2.11). */
export type ScreeningModel = "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5";
export type CvTextStatus = "pending" | "read" | "failed";
export type RequirementKind = "must_have" | "alternative" | "nice_to_have";
export type TechstackResult = "pass" | "fail" | "unclear";
export type CvScorePurpose = "score" | "compare";
export type AttachmentKind = "cv" | "payslip" | "background_check" | "video" | "test_result" | "other";
export type ClientDecision = "pending" | "approved" | "rejected";
export type PlacementStatus = "active" | "notice" | "ended";
export type TaskStatus = "todo" | "in_progress" | "done";
export type EntityType = "client" | "vacancy" | "candidate" | "application" | "placement" | "company";
/** Portal modules a team member sees (recruitment planning, 2.5). Admins see all. */
export type PortalModule = "sales" | "recruitment" | "clients" | "report" | "academy";
export type InterviewKind = "interview" | "english_interview" | "client_interview";
export type InterviewStatus = "invited" | "scheduled" | "rescheduled" | "cancelled" | "done" | "no_show";
// Account security
export type PasskeyDeviceType = "singleDevice" | "multiDevice";
export type WebauthnChallengeKind = "registration" | "authentication";
export type McpTokenAccess = "read" | "write";
// Custom fields (20261108050000_custom_fields_and_extras.sql)
export type CustomFieldEntity = "candidate" | "vacancy" | "application";
export type CustomFieldType =
  | "text"
  | "long_text"
  | "number"
  | "date"
  | "boolean"
  | "single_choice"
  | "multi_choice"
  | "url";
/** Values by field key: string (text, long_text, date, single_choice, url), number, boolean or string[] (multi_choice). */
export type CustomFieldValues = { [key: string]: string | number | boolean | string[] };

export type ActivityAction = "created" | "updated" | "deleted" | "stage_changed" | "status_changed";

// GTM
export type Segment = "saas" | "productie" | "agency_automation" | "agency_overig";
export type IcpDecision = "GO" | "NO_GO" | "REVIEW";
export type CompanyStatus = "nieuw" | "actief" | "klant" | "verloren" | "uitgesloten";
export type EmailStatus = "valid" | "invalid" | "catch_all" | "unknown";
export type PhoneType = "mobiel" | "vast";
/** Cleaned contact statuses (section 2.6). Meeting, Opportunity, Client and Lost are pipeline stages now. */
export type ContactStatus =
  | "new"
  | "qualified"
  | "enrich"
  | "enriched"
  | "in_outreach"
  | "reached"
  | "not_reached"
  | "not_interested"
  | "do_not_contact";
export type SignalType =
  | "vacature"
  | "lang_open"
  | "meerdere_rollen"
  | "remote_extern"
  | "freelance"
  | "funding"
  | "nieuwe_cto"
  | "overig";
export type SignalSource = "linkedin" | "indeed" | "overig" | "import" | "apify" | "prospeo";
export type CampaignChannel = "bellen" | "mail" | "linkedin";
export type ActivityChannel = "bellen" | "mail" | "linkedin" | "meeting" | "system";
export type ActivityOutcome =
  | "verstuurd"
  | "geen_gehoor"
  | "bereikt"
  | "terugbellen"
  | "afspraak"
  | "afspraak_goedgekeurd"
  | "afspraak_afgekeurd"
  | "niet_geinteresseerd"
  | "reply_positief"
  | "reply_neutraal"
  | "reply_negatief"
  | "bounce"
  | "afgemeld"
  | "gesprek_gehad"
  | "gewonnen"
  | "verloren"
  | "notitie"
  | "no_answer"
  | "call_back"
  | "reached_interested"
  | "meeting_planned"
  | "reached_not_interested"
  | "referred"
  | "wrong_person"
  | "wrong_number"
  | "meeting_held"
  | "meeting_no_show"
  | "meeting_cancelled";
export type ActivitySource =
  | "handmatig"
  | "instantly"
  | "webpartners"
  | "calcom"
  | "onepage"
  | "import"
  | "seleqt"
  | "system"
  | "claude"
  | "apify"
  | "prospeo";
export type SuppressionReason = "afgemeld" | "bezwaar" | "klant" | "lopend_gesprek" | "niet_bellen";
export type SuppressionScope = "alle_kanalen" | "alleen_bellen" | "alleen_mail";
export type ListExportType = "bellijst" | "mailcampagne" | "max_verrijking";
export type JobStatus = "running" | "success" | "failed";
export type MailLogStatus = "sent" | "failed" | "not_configured";
export type VacancySource = "klant_eigen" | "samen_opgesteld" | "gescrapet";
export type TalentStage = "intake" | "zoeken" | "profielen_verstuurd" | "gesprekken" | "geplaatst" | "gesloten";
export type MatchSource = "eigen_pool" | "linkedin" | "naukri";
export type MatchStatus = "voorgesteld" | "goedgekeurd" | "verstuurd" | "gesprek" | "aangenomen" | "afgewezen";

type ListCandidateBase = {
  contact_id: string;
  company_id: string;
  company_name: string;
  domain: string;
  segment: Segment | null;
  icp_score: number | null;
  opening_line: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  tier: number | null;
  signal_id: string | null;
  signal_title: string | null;
  signal_type: SignalType | null;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          role: ProfileRole;
          client_id: string | null;
          email: string | null;
          time_zone: string;
          created_at: string;
          updated_at: string;
          modules: PortalModule[];
          booking_url: string | null;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: ProfileRole;
          client_id?: string | null;
          email?: string | null;
          time_zone?: string;
          created_at?: string;
          updated_at?: string;
          modules?: PortalModule[];
          booking_url?: string | null;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: ProfileRole;
          client_id?: string | null;
          email?: string | null;
          time_zone?: string;
          created_at?: string;
          updated_at?: string;
          modules?: PortalModule[];
          booking_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          id: string;
          name: string;
          website: string | null;
          industry: string | null;
          city: string | null;
          status: ClientStatus;
          notes: string | null;
          owner_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          website?: string | null;
          industry?: string | null;
          city?: string | null;
          status?: ClientStatus;
          notes?: string | null;
          owner_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          website?: string | null;
          industry?: string | null;
          city?: string | null;
          status?: ClientStatus;
          notes?: string | null;
          owner_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clients_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      client_contacts: {
        Row: {
          id: string;
          client_id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          job_title: string | null;
          linkedin_url: string | null;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          job_title?: string | null;
          linkedin_url?: string | null;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          job_title?: string | null;
          linkedin_url?: string | null;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      vacancies: {
        Row: {
          id: string;
          client_id: string | null;
          title: string;
          description: string | null;
          stack: string[];
          seniority: Seniority;
          status: VacancyStatus;
          monthly_budget: number | null;
          desired_start_date: string | null;
          opened_at: string;
          closed_at: string | null;
          owner_id: string | null;
          created_at: string;
          updated_at: string;
          company_id: string | null;
          onepage_deal_id: string | null;
          source: VacancySource | null;
          raw_text: string | null;
          hours: number | null;
          timezone_overlap: string | null;
          budget_min: number | null;
          budget_max: number | null;
          client_contact_required: boolean | null;
          must_haves: string[];
          nice_to_haves: string[];
          unclear: string[];
          search_brief: Json | null;
          talent_stage: TalentStage;
          intake_at: string | null;
          profiles_sent_at: string | null;
          first_interview_at: string | null;
          start_at: string | null;
          is_talent_pool: boolean;
          park_reason: string | null;
          parked_at: string | null;
          custom_fields: CustomFieldValues;
          excluded_profiles: string[];
          techstack_min_hits: number | null;
          screening_model: ScreeningModel | null;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          title: string;
          description?: string | null;
          stack?: string[];
          seniority?: Seniority;
          status?: VacancyStatus;
          monthly_budget?: number | null;
          desired_start_date?: string | null;
          opened_at?: string;
          closed_at?: string | null;
          owner_id?: string | null;
          created_at?: string;
          updated_at?: string;
          company_id?: string | null;
          onepage_deal_id?: string | null;
          source?: VacancySource | null;
          raw_text?: string | null;
          hours?: number | null;
          timezone_overlap?: string | null;
          budget_min?: number | null;
          budget_max?: number | null;
          client_contact_required?: boolean | null;
          must_haves?: string[];
          nice_to_haves?: string[];
          unclear?: string[];
          search_brief?: Json | null;
          talent_stage?: TalentStage;
          intake_at?: string | null;
          profiles_sent_at?: string | null;
          first_interview_at?: string | null;
          start_at?: string | null;
          is_talent_pool?: boolean;
          park_reason?: string | null;
          parked_at?: string | null;
          custom_fields?: CustomFieldValues;
          excluded_profiles?: string[];
          techstack_min_hits?: number | null;
          screening_model?: ScreeningModel | null;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          title?: string;
          description?: string | null;
          stack?: string[];
          seniority?: Seniority;
          status?: VacancyStatus;
          monthly_budget?: number | null;
          desired_start_date?: string | null;
          opened_at?: string;
          closed_at?: string | null;
          owner_id?: string | null;
          created_at?: string;
          updated_at?: string;
          company_id?: string | null;
          onepage_deal_id?: string | null;
          source?: VacancySource | null;
          raw_text?: string | null;
          hours?: number | null;
          timezone_overlap?: string | null;
          budget_min?: number | null;
          budget_max?: number | null;
          client_contact_required?: boolean | null;
          must_haves?: string[];
          nice_to_haves?: string[];
          unclear?: string[];
          search_brief?: Json | null;
          talent_stage?: TalentStage;
          intake_at?: string | null;
          profiles_sent_at?: string | null;
          first_interview_at?: string | null;
          start_at?: string | null;
          is_talent_pool?: boolean;
          park_reason?: string | null;
          parked_at?: string | null;
          custom_fields?: CustomFieldValues;
          excluded_profiles?: string[];
          techstack_min_hits?: number | null;
          screening_model?: ScreeningModel | null;
        };
        Relationships: [
          {
            foreignKeyName: "vacancies_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vacancies_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vacancies_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      candidates: {
        Row: {
          id: string;
          full_name: string;
          email: string | null;
          phone: string | null;
          location: string;
          current_title: string | null;
          years_experience: number | null;
          skills: string[];
          linkedin_url: string | null;
          video_url: string | null;
          cv_path: string | null;
          summary: string | null;
          status: CandidateStatus;
          owner_id: string | null;
          seniority: CandidateSeniority | null;
          employers: string[];
          project_types: string[];
          sectors: string[];
          cv_text: string | null;
          english_level: string | null;
          availability: string | null;
          profile_consent: boolean | null;
          created_at: string;
          updated_at: string;
          park_reason: string | null;
          parked_at: string | null;
          source: CandidateSource | null;
          origin: CandidateOrigin;
          custom_fields: CustomFieldValues;
          is_topper: boolean;
          top_candidate: boolean;
          top_candidate_at: string | null;
          topper_reason: string | null;
          topper_by: string | null;
          topper_at: string | null;
          current_company: string | null;
          notice_period: string | null;
          willing_to_relocate: boolean | null;
          cv_text_status: CvTextStatus | null;
          cv_read_at: string | null;
          has_cv_text: boolean;
        };
        Insert: {
          id?: string;
          full_name: string;
          email?: string | null;
          phone?: string | null;
          location?: string;
          current_title?: string | null;
          years_experience?: number | null;
          skills?: string[];
          linkedin_url?: string | null;
          video_url?: string | null;
          cv_path?: string | null;
          summary?: string | null;
          status?: CandidateStatus;
          owner_id?: string | null;
          seniority?: CandidateSeniority | null;
          employers?: string[];
          project_types?: string[];
          sectors?: string[];
          cv_text?: string | null;
          english_level?: string | null;
          availability?: string | null;
          profile_consent?: boolean | null;
          created_at?: string;
          updated_at?: string;
          park_reason?: string | null;
          parked_at?: string | null;
          source?: CandidateSource | null;
          origin?: CandidateOrigin;
          custom_fields?: CustomFieldValues;
          is_topper?: boolean;
          top_candidate?: boolean;
          top_candidate_at?: string | null;
          topper_reason?: string | null;
          topper_by?: string | null;
          topper_at?: string | null;
          current_company?: string | null;
          notice_period?: string | null;
          willing_to_relocate?: boolean | null;
          cv_text_status?: CvTextStatus | null;
          cv_read_at?: string | null;
          has_cv_text?: boolean;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string | null;
          phone?: string | null;
          location?: string;
          current_title?: string | null;
          years_experience?: number | null;
          skills?: string[];
          linkedin_url?: string | null;
          video_url?: string | null;
          cv_path?: string | null;
          summary?: string | null;
          status?: CandidateStatus;
          owner_id?: string | null;
          seniority?: CandidateSeniority | null;
          employers?: string[];
          project_types?: string[];
          sectors?: string[];
          cv_text?: string | null;
          english_level?: string | null;
          availability?: string | null;
          profile_consent?: boolean | null;
          created_at?: string;
          updated_at?: string;
          park_reason?: string | null;
          parked_at?: string | null;
          source?: CandidateSource | null;
          origin?: CandidateOrigin;
          custom_fields?: CustomFieldValues;
          is_topper?: boolean;
          top_candidate?: boolean;
          top_candidate_at?: string | null;
          topper_reason?: string | null;
          topper_by?: string | null;
          topper_at?: string | null;
          current_company?: string | null;
          notice_period?: string | null;
          willing_to_relocate?: boolean | null;
          cv_text_status?: CvTextStatus | null;
          cv_read_at?: string | null;
          has_cv_text?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "candidates_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      applications: {
        Row: {
          id: string;
          vacancy_id: string;
          candidate_id: string;
          stage: ApplicationStage;
          position: number;
          technical_score: number | null;
          english_score: number | null;
          assessment_notes: string | null;
          presented_at: string | null;
          client_decision: ClientDecision;
          client_feedback: string | null;
          client_decided_at: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
          exit_from_stage: FlowStage | null;
          parked_at: string | null;
          park_reason: string | null;
          park_until: string | null;
          rejected_at: string | null;
          source: CandidateSource | null;
          origin: CandidateOrigin;
          form_sent_at: string | null;
          form_completed_at: string | null;
          form_reminded_at: string | null;
          cv_score: number | null;
          cv_verdict: CvVerdict | null;
          cv_scored_at: string | null;
          video_score: number | null;
          video_notes: string | null;
          interview_at: string | null;
          shortlisted_at: string | null;
          background_check_status: BackgroundCheckStatus;
          background_check_notes: string | null;
          custom_fields: CustomFieldValues;
        };
        Insert: {
          id?: string;
          vacancy_id: string;
          candidate_id: string;
          stage?: ApplicationStage;
          position?: number;
          technical_score?: number | null;
          english_score?: number | null;
          assessment_notes?: string | null;
          presented_at?: string | null;
          client_decision?: ClientDecision;
          client_feedback?: string | null;
          client_decided_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
          exit_from_stage?: FlowStage | null;
          parked_at?: string | null;
          park_reason?: string | null;
          park_until?: string | null;
          rejected_at?: string | null;
          source?: CandidateSource | null;
          origin?: CandidateOrigin;
          form_sent_at?: string | null;
          form_completed_at?: string | null;
          form_reminded_at?: string | null;
          cv_score?: number | null;
          cv_verdict?: CvVerdict | null;
          cv_scored_at?: string | null;
          video_score?: number | null;
          video_notes?: string | null;
          interview_at?: string | null;
          shortlisted_at?: string | null;
          background_check_status?: BackgroundCheckStatus;
          background_check_notes?: string | null;
          custom_fields?: CustomFieldValues;
        };
        Update: {
          id?: string;
          vacancy_id?: string;
          candidate_id?: string;
          stage?: ApplicationStage;
          position?: number;
          technical_score?: number | null;
          english_score?: number | null;
          assessment_notes?: string | null;
          presented_at?: string | null;
          client_decision?: ClientDecision;
          client_feedback?: string | null;
          client_decided_at?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
          exit_from_stage?: FlowStage | null;
          parked_at?: string | null;
          park_reason?: string | null;
          park_until?: string | null;
          rejected_at?: string | null;
          source?: CandidateSource | null;
          origin?: CandidateOrigin;
          form_sent_at?: string | null;
          form_completed_at?: string | null;
          form_reminded_at?: string | null;
          cv_score?: number | null;
          cv_verdict?: CvVerdict | null;
          cv_scored_at?: string | null;
          video_score?: number | null;
          video_notes?: string | null;
          interview_at?: string | null;
          shortlisted_at?: string | null;
          background_check_status?: BackgroundCheckStatus;
          background_check_notes?: string | null;
          custom_fields?: CustomFieldValues;
        };
        Relationships: [
          {
            foreignKeyName: "applications_vacancy_id_fkey";
            columns: ["vacancy_id"];
            isOneToOne: false;
            referencedRelation: "vacancies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "applications_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
        ];
      };
      placements: {
        Row: {
          id: string;
          client_id: string;
          candidate_id: string;
          vacancy_id: string | null;
          application_id: string | null;
          start_date: string;
          end_date: string | null;
          monthly_rate: number | null;
          hours_per_week: number | null;
          overlap_start: string | null;
          overlap_end: string | null;
          overlap_time_zone: string;
          probation_end_date: string | null;
          nordavo_contact_id: string | null;
          status: PlacementStatus;
          notice_given_at: string | null;
          guarantee_until: string | null;
          next_checkin_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          candidate_id: string;
          vacancy_id?: string | null;
          application_id?: string | null;
          start_date: string;
          end_date?: string | null;
          monthly_rate?: number | null;
          hours_per_week?: number | null;
          overlap_start?: string | null;
          overlap_end?: string | null;
          overlap_time_zone?: string;
          probation_end_date?: string | null;
          nordavo_contact_id?: string | null;
          status?: PlacementStatus;
          notice_given_at?: string | null;
          next_checkin_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          candidate_id?: string;
          vacancy_id?: string | null;
          application_id?: string | null;
          start_date?: string;
          end_date?: string | null;
          monthly_rate?: number | null;
          hours_per_week?: number | null;
          overlap_start?: string | null;
          overlap_end?: string | null;
          overlap_time_zone?: string;
          probation_end_date?: string | null;
          nordavo_contact_id?: string | null;
          status?: PlacementStatus;
          notice_given_at?: string | null;
          next_checkin_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "placements_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placements_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placements_vacancy_id_fkey";
            columns: ["vacancy_id"];
            isOneToOne: false;
            referencedRelation: "vacancies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placements_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      placement_checkins: {
        Row: {
          id: string;
          placement_id: string;
          checkin_date: string;
          rating: number | null;
          notes: string | null;
          author_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          placement_id: string;
          checkin_date?: string;
          rating?: number | null;
          notes?: string | null;
          author_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          placement_id?: string;
          checkin_date?: string;
          rating?: number | null;
          notes?: string | null;
          author_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "placement_checkins_placement_id_fkey";
            columns: ["placement_id"];
            isOneToOne: false;
            referencedRelation: "placements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "placement_checkins_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          id: string;
          entity_type: EntityType;
          entity_id: string;
          body: string;
          author_id: string | null;
          created_at: string;
          updated_at: string;
          stage: ApplicationStage | null;
          kind: NoteKind;
        };
        Insert: {
          id?: string;
          entity_type: EntityType;
          entity_id: string;
          body: string;
          author_id?: string | null;
          created_at?: string;
          updated_at?: string;
          stage?: ApplicationStage | null;
          kind?: NoteKind;
        };
        Update: {
          id?: string;
          entity_type?: EntityType;
          entity_id?: string;
          body?: string;
          author_id?: string | null;
          created_at?: string;
          updated_at?: string;
          stage?: ApplicationStage | null;
          kind?: NoteKind;
        };
        Relationships: [
          {
            foreignKeyName: "notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      attachments: {
        Row: {
          id: string;
          entity_type: EntityType;
          entity_id: string;
          storage_path: string;
          file_name: string;
          mime_type: string | null;
          size_bytes: number | null;
          uploaded_by: string | null;
          created_at: string;
          kind: AttachmentKind;
        };
        Insert: {
          id?: string;
          entity_type: EntityType;
          entity_id: string;
          storage_path: string;
          file_name: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          uploaded_by?: string | null;
          created_at?: string;
          kind?: AttachmentKind;
        };
        Update: {
          id?: string;
          entity_type?: EntityType;
          entity_id?: string;
          storage_path?: string;
          file_name?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          uploaded_by?: string | null;
          created_at?: string;
          kind?: AttachmentKind;
        };
        Relationships: [
          {
            foreignKeyName: "attachments_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      interviews: {
        Row: {
          id: string;
          application_id: string;
          interviewer_id: string | null;
          kind: InterviewKind;
          status: InterviewStatus;
          invite_url: string | null;
          invite_mailed_at: string | null;
          starts_at: string | null;
          ends_at: string | null;
          cal_uid: string | null;
          previous_cal_uids: string[];
          cancellation_reason: string | null;
          reminder_sent_at: string | null;
          rating: number | null;
          communication: number | null;
          feedback: string | null;
          feedback_at: string | null;
          feedback_by: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          interviewer_id?: string | null;
          kind?: InterviewKind;
          status?: InterviewStatus;
          invite_url?: string | null;
          invite_mailed_at?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          cal_uid?: string | null;
          previous_cal_uids?: string[];
          cancellation_reason?: string | null;
          reminder_sent_at?: string | null;
          rating?: number | null;
          communication?: number | null;
          feedback?: string | null;
          feedback_at?: string | null;
          feedback_by?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          application_id?: string;
          interviewer_id?: string | null;
          kind?: InterviewKind;
          status?: InterviewStatus;
          invite_url?: string | null;
          invite_mailed_at?: string | null;
          starts_at?: string | null;
          ends_at?: string | null;
          cal_uid?: string | null;
          previous_cal_uids?: string[];
          cancellation_reason?: string | null;
          reminder_sent_at?: string | null;
          rating?: number | null;
          communication?: number | null;
          feedback?: string | null;
          feedback_at?: string | null;
          feedback_by?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "interviews_interviewer_id_fkey";
            columns: ["interviewer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      application_assessments: {
        Row: {
          application_id: string;
          video_reviewed_by: string | null;
          video_reviewed_at: string | null;
          screening_tools: ScreeningTool[];
          screening_communication_score: number | null;
          screening_notes: string | null;
          screened_by: string | null;
          screened_at: string | null;
          interview_rating: number | null;
          interview_communication_feedback: string | null;
          interview_linkedin_feedback: string | null;
          interviewer_id: string | null;
          interviewer_name: string | null;
          interviewed_at: string | null;
          test_score: number | null;
          test_notes: string | null;
          test_url: string | null;
          test_completed_at: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          application_id: string;
          video_reviewed_by?: string | null;
          video_reviewed_at?: string | null;
          screening_tools?: ScreeningTool[];
          screening_communication_score?: number | null;
          screening_notes?: string | null;
          screened_by?: string | null;
          screened_at?: string | null;
          interview_rating?: number | null;
          interview_communication_feedback?: string | null;
          interview_linkedin_feedback?: string | null;
          interviewer_id?: string | null;
          interviewer_name?: string | null;
          interviewed_at?: string | null;
          test_score?: number | null;
          test_notes?: string | null;
          test_url?: string | null;
          test_completed_at?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          application_id?: string;
          video_reviewed_by?: string | null;
          video_reviewed_at?: string | null;
          screening_tools?: ScreeningTool[];
          screening_communication_score?: number | null;
          screening_notes?: string | null;
          screened_by?: string | null;
          screened_at?: string | null;
          interview_rating?: number | null;
          interview_communication_feedback?: string | null;
          interview_linkedin_feedback?: string | null;
          interviewer_id?: string | null;
          interviewer_name?: string | null;
          interviewed_at?: string | null;
          test_score?: number | null;
          test_notes?: string | null;
          test_url?: string | null;
          test_completed_at?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_assessments_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: true;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      application_stage_events: {
        Row: {
          id: number;
          application_id: string;
          vacancy_id: string;
          from_stage: ApplicationStage | null;
          to_stage: ApplicationStage;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: never;
          application_id: string;
          vacancy_id: string;
          from_stage?: ApplicationStage | null;
          to_stage: ApplicationStage;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: never;
          application_id?: string;
          vacancy_id?: string;
          from_stage?: ApplicationStage | null;
          to_stage?: ApplicationStage;
          actor_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "application_stage_events_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_log: {
        Row: {
          id: number;
          entity_type: string;
          entity_id: string;
          action: ActivityAction;
          summary: string;
          changes: Json;
          actor_id: string | null;
          created_at: string;
        };
        Insert: {
          entity_type: string;
          entity_id: string;
          action: ActivityAction;
          summary: string;
          changes?: Json;
          actor_id?: string | null;
          created_at?: string;
        };
        Update: {
          entity_type?: string;
          entity_id?: string;
          action?: ActivityAction;
          summary?: string;
          changes?: Json;
          actor_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          id: string;
          domain: string;
          name: string;
          website: string | null;
          legal_form: string | null;
          employees: number | null;
          sector: string | null;
          segment: Segment | null;
          kvk_number: string | null;
          linkedin_url: string | null;
          city: string | null;
          icp_decision: IcpDecision | null;
          icp_score: number | null;
          icp_reason: string | null;
          red_flags: string[];
          opening_line: string | null;
          client_contact_risk: boolean;
          qualified_at: string | null;
          reviewed_by: string | null;
          status: CompanyStatus;
          source: string | null;
          sources: string[];
          client_id: string | null;
          prio: number | null;
          category: CompanyCategory | null;
          description: string | null;
          general_phone: string | null;
          source_note: string | null;
          lead_status: LeadStatus;
          lead_status_changed_at: string;
          pipeline_stage: PipelineStage | null;
          pipeline_stage_changed_at: string | null;
          pipeline_entered_at: string | null;
          lost_reason: string | null;
          owner_id: string | null;
          partner_id: string | null;
          next_action: string | null;
          next_action_date: string | null;
          pinned_at: string | null;
          manual_position: number | null;
          sequence_paused_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          domain: string;
          name: string;
          website?: string | null;
          legal_form?: string | null;
          employees?: number | null;
          sector?: string | null;
          segment?: Segment | null;
          kvk_number?: string | null;
          linkedin_url?: string | null;
          city?: string | null;
          icp_decision?: IcpDecision | null;
          icp_score?: number | null;
          icp_reason?: string | null;
          red_flags?: string[];
          opening_line?: string | null;
          client_contact_risk?: boolean;
          qualified_at?: string | null;
          reviewed_by?: string | null;
          status?: CompanyStatus;
          source?: string | null;
          sources?: string[];
          client_id?: string | null;
          prio?: number | null;
          category?: CompanyCategory | null;
          description?: string | null;
          general_phone?: string | null;
          source_note?: string | null;
          lead_status?: LeadStatus;
          lead_status_changed_at?: string;
          pipeline_stage?: PipelineStage | null;
          pipeline_stage_changed_at?: string | null;
          pipeline_entered_at?: string | null;
          lost_reason?: string | null;
          owner_id?: string | null;
          partner_id?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          pinned_at?: string | null;
          manual_position?: number | null;
          sequence_paused_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          domain?: string;
          name?: string;
          website?: string | null;
          legal_form?: string | null;
          employees?: number | null;
          sector?: string | null;
          segment?: Segment | null;
          kvk_number?: string | null;
          linkedin_url?: string | null;
          city?: string | null;
          icp_decision?: IcpDecision | null;
          icp_score?: number | null;
          icp_reason?: string | null;
          red_flags?: string[];
          opening_line?: string | null;
          client_contact_risk?: boolean;
          qualified_at?: string | null;
          reviewed_by?: string | null;
          status?: CompanyStatus;
          source?: string | null;
          sources?: string[];
          client_id?: string | null;
          prio?: number | null;
          category?: CompanyCategory | null;
          description?: string | null;
          general_phone?: string | null;
          source_note?: string | null;
          lead_status?: LeadStatus;
          lead_status_changed_at?: string;
          pipeline_stage?: PipelineStage | null;
          pipeline_stage_changed_at?: string | null;
          pipeline_entered_at?: string | null;
          lost_reason?: string | null;
          owner_id?: string | null;
          partner_id?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          pinned_at?: string | null;
          manual_position?: number | null;
          sequence_paused_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "companies_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "companies_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "companies_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "companies_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          id: string;
          company_id: string;
          first_name: string | null;
          last_name: string | null;
          title: string | null;
          tier: number | null;
          linkedin_url: string | null;
          email: string | null;
          email_source: string | null;
          email_status: EmailStatus | null;
          email_found_at: string | null;
          phone: string | null;
          phone_type: PhoneType | null;
          phone_source: string | null;
          phone_found_at: string | null;
          status: ContactStatus;
          onepage_id: string | null;
          last_contacted_at: string | null;
          source: string | null;
          sources: string[];
          role: ContactRole;
          is_primary: boolean;
          route: string | null;
          attempts: number;
          last_attempt_at: string | null;
          referred_to: string | null;
          caller_note: string | null;
          callback_at: string | null;
          assigned_caller_id: string | null;
          assigned_until: string | null;
          claimed_by: string | null;
          claimed_at: string | null;
          status_changed_at: string;
          pinned_at: string | null;
          manual_position: number | null;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id: string;
          first_name?: string | null;
          last_name?: string | null;
          title?: string | null;
          tier?: number | null;
          linkedin_url?: string | null;
          email?: string | null;
          email_source?: string | null;
          email_status?: EmailStatus | null;
          email_found_at?: string | null;
          phone?: string | null;
          phone_type?: PhoneType | null;
          phone_source?: string | null;
          phone_found_at?: string | null;
          status?: ContactStatus;
          onepage_id?: string | null;
          last_contacted_at?: string | null;
          source?: string | null;
          sources?: string[];
          role?: ContactRole;
          is_primary?: boolean;
          route?: string | null;
          attempts?: number;
          last_attempt_at?: string | null;
          referred_to?: string | null;
          caller_note?: string | null;
          callback_at?: string | null;
          assigned_caller_id?: string | null;
          assigned_until?: string | null;
          claimed_by?: string | null;
          claimed_at?: string | null;
          status_changed_at?: string;
          pinned_at?: string | null;
          manual_position?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          first_name?: string | null;
          last_name?: string | null;
          title?: string | null;
          tier?: number | null;
          linkedin_url?: string | null;
          email?: string | null;
          email_source?: string | null;
          email_status?: EmailStatus | null;
          email_found_at?: string | null;
          phone?: string | null;
          phone_type?: PhoneType | null;
          phone_source?: string | null;
          phone_found_at?: string | null;
          status?: ContactStatus;
          onepage_id?: string | null;
          last_contacted_at?: string | null;
          source?: string | null;
          sources?: string[];
          role?: ContactRole;
          is_primary?: boolean;
          route?: string | null;
          attempts?: number;
          last_attempt_at?: string | null;
          referred_to?: string | null;
          caller_note?: string | null;
          callback_at?: string | null;
          assigned_caller_id?: string | null;
          assigned_until?: string | null;
          claimed_by?: string | null;
          claimed_at?: string | null;
          status_changed_at?: string;
          pinned_at?: string | null;
          manual_position?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_assigned_caller_id_fkey";
            columns: ["assigned_caller_id"];
            isOneToOne: false;
            referencedRelation: "callers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contacts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      signals: {
        Row: {
          id: string;
          company_id: string;
          type: SignalType;
          title: string | null;
          source_url: string | null;
          source: SignalSource;
          dedupe_key: string;
          first_seen_at: string;
          last_seen_at: string;
          raw_json: Json | null;
          role_group: string | null;
          posted_at: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          type: SignalType;
          title?: string | null;
          source_url?: string | null;
          source?: SignalSource;
          dedupe_key: string;
          first_seen_at?: string;
          last_seen_at?: string;
          raw_json?: Json | null;
          role_group?: string | null;
          posted_at?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string;
          type?: SignalType;
          title?: string | null;
          source_url?: string | null;
          source?: SignalSource;
          dedupe_key?: string;
          first_seen_at?: string;
          last_seen_at?: string;
          raw_json?: Json | null;
          role_group?: string | null;
          posted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "signals_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      campaigns: {
        Row: {
          id: string;
          name: string;
          channel: CampaignChannel;
          signal_type: string | null;
          segment: string | null;
          message_variant: string | null;
          external_id: string | null;
          started_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          channel: CampaignChannel;
          signal_type?: string | null;
          segment?: string | null;
          message_variant?: string | null;
          external_id?: string | null;
          started_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          channel?: CampaignChannel;
          signal_type?: string | null;
          segment?: string | null;
          message_variant?: string | null;
          external_id?: string | null;
          started_at?: string | null;
          created_at?: string;
        };
        Relationships: [
        ];
      };
      activities: {
        Row: {
          id: string;
          contact_id: string | null;
          company_id: string | null;
          channel: ActivityChannel;
          campaign_id: string | null;
          signal_id: string | null;
          date: string;
          outcome: ActivityOutcome | null;
          notes: string | null;
          next_action: string | null;
          next_action_date: string | null;
          source: ActivitySource;
          external_id: string | null;
          created_by: string | null;
          type: ActivityType;
          direction: ActivityDirection | null;
          field: string | null;
          old_value: Json | null;
          new_value: Json | null;
          partner_id: string | null;
          sequence_id: string | null;
          caller_id: string | null;
          meeting_id: string | null;
          review_status: ReviewStatus | null;
          suggestion: Json | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          contact_id?: string | null;
          company_id?: string | null;
          channel: ActivityChannel;
          campaign_id?: string | null;
          signal_id?: string | null;
          date?: string;
          outcome?: ActivityOutcome | null;
          notes?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          source?: ActivitySource;
          external_id?: string | null;
          created_by?: string | null;
          type?: ActivityType;
          direction?: ActivityDirection | null;
          field?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          partner_id?: string | null;
          sequence_id?: string | null;
          caller_id?: string | null;
          meeting_id?: string | null;
          review_status?: ReviewStatus | null;
          suggestion?: Json | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          contact_id?: string | null;
          company_id?: string | null;
          channel?: ActivityChannel;
          campaign_id?: string | null;
          signal_id?: string | null;
          date?: string;
          outcome?: ActivityOutcome | null;
          notes?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          source?: ActivitySource;
          external_id?: string | null;
          created_by?: string | null;
          type?: ActivityType;
          direction?: ActivityDirection | null;
          field?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          partner_id?: string | null;
          sequence_id?: string | null;
          caller_id?: string | null;
          meeting_id?: string | null;
          review_status?: ReviewStatus | null;
          suggestion?: Json | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activities_partner_id_fkey";
            columns: ["partner_id"];
            isOneToOne: false;
            referencedRelation: "partners";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_caller_id_fkey";
            columns: ["caller_id"];
            isOneToOne: false;
            referencedRelation: "callers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_meeting_fkey";
            columns: ["meeting_id"];
            isOneToOne: false;
            referencedRelation: "meetings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_signal_id_fkey";
            columns: ["signal_id"];
            isOneToOne: false;
            referencedRelation: "signals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      suppression: {
        Row: {
          id: string;
          company_id: string | null;
          contact_id: string | null;
          email: string | null;
          reason: SuppressionReason;
          scope: SuppressionScope;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string | null;
          contact_id?: string | null;
          email?: string | null;
          reason: SuppressionReason;
          scope?: SuppressionScope;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string | null;
          contact_id?: string | null;
          email?: string | null;
          reason?: SuppressionReason;
          scope?: SuppressionScope;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppression_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "suppression_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "suppression_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      list_exports: {
        Row: {
          id: string;
          type: ListExportType;
          filter_used: Json;
          record_ids: string[];
          record_count: number;
          destination: string | null;
          campaign_id: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          type: ListExportType;
          filter_used?: Json;
          record_ids?: string[];
          record_count?: number;
          destination?: string | null;
          campaign_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          type?: ListExportType;
          filter_used?: Json;
          record_ids?: string[];
          record_count?: number;
          destination?: string | null;
          campaign_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "list_exports_campaign_id_fkey";
            columns: ["campaign_id"];
            isOneToOne: false;
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "list_exports_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      job_runs: {
        Row: {
          id: string;
          job_name: string;
          started_at: string;
          finished_at: string | null;
          status: JobStatus;
          records_in: number;
          records_out: number;
          error: string | null;
          meta: Json;
          triggered_by: string;
        };
        Insert: {
          id?: string;
          job_name: string;
          started_at?: string;
          finished_at?: string | null;
          status?: JobStatus;
          records_in?: number;
          records_out?: number;
          error?: string | null;
          meta?: Json;
          triggered_by?: string;
        };
        Update: {
          id?: string;
          job_name?: string;
          started_at?: string;
          finished_at?: string | null;
          status?: JobStatus;
          records_in?: number;
          records_out?: number;
          error?: string | null;
          meta?: Json;
          triggered_by?: string;
        };
        Relationships: [
        ];
      };
      mail_log: {
        Row: {
          id: string;
          created_at: string;
          category: string;
          status: MailLogStatus;
          from_address: string | null;
          to_addresses: string[];
          cc_addresses: string[];
          reply_to: string | null;
          subject: string;
          html: string | null;
          text_body: string | null;
          resend_id: string | null;
          error: string | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          category?: string;
          status: MailLogStatus;
          from_address?: string | null;
          to_addresses?: string[];
          cc_addresses?: string[];
          reply_to?: string | null;
          subject: string;
          html?: string | null;
          text_body?: string | null;
          resend_id?: string | null;
          error?: string | null;
        };
        Update: {
          id?: string;
          created_at?: string;
          category?: string;
          status?: MailLogStatus;
          from_address?: string | null;
          to_addresses?: string[];
          cc_addresses?: string[];
          reply_to?: string | null;
          subject?: string;
          html?: string | null;
          text_body?: string | null;
          resend_id?: string | null;
          error?: string | null;
        };
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          vacancy_id: string;
          candidate_id: string;
          score: number | null;
          reason: string | null;
          risks: string[];
          missing: string[];
          source: MatchSource;
          status: MatchStatus;
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vacancy_id: string;
          candidate_id: string;
          score?: number | null;
          reason?: string | null;
          risks?: string[];
          missing?: string[];
          source?: MatchSource;
          status?: MatchStatus;
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vacancy_id?: string;
          candidate_id?: string;
          score?: number | null;
          reason?: string | null;
          risks?: string[];
          missing?: string[];
          source?: MatchSource;
          status?: MatchStatus;
          approved_by?: string | null;
          approved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "matches_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_vacancy_id_fkey";
            columns: ["vacancy_id"];
            isOneToOne: false;
            referencedRelation: "vacancies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      anonymous_profiles: {
        Row: {
          id: string;
          match_id: string;
          file_url: string | null;
          content: Json;
          consent_confirmed: boolean;
          created_by: string | null;
          created_at: string;
          approved_by: string | null;
          approved_at: string | null;
          sent_at: string | null;
        };
        Insert: {
          id?: string;
          match_id: string;
          file_url?: string | null;
          content?: Json;
          consent_confirmed?: boolean;
          created_by?: string | null;
          created_at?: string;
          approved_by?: string | null;
          approved_at?: string | null;
          sent_at?: string | null;
        };
        Update: {
          id?: string;
          match_id?: string;
          file_url?: string | null;
          content?: Json;
          consent_confirmed?: boolean;
          created_by?: string | null;
          created_at?: string;
          approved_by?: string | null;
          approved_at?: string | null;
          sent_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "anonymous_profiles_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "anonymous_profiles_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "anonymous_profiles_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      vacancy_requirements: {
        Row: {
          id: string;
          vacancy_id: string;
          label: string;
          kind: RequirementKind;
          alternatives: string[];
          position: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          vacancy_id: string;
          label: string;
          kind?: RequirementKind;
          alternatives?: string[];
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          vacancy_id?: string;
          label?: string;
          kind?: RequirementKind;
          alternatives?: string[];
          position?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vacancy_requirements_vacancy_id_fkey";
            columns: ["vacancy_id"];
            isOneToOne: false;
            referencedRelation: "vacancies";
            referencedColumns: ["id"];
          },
        ];
      };
      techstack_checks: {
        Row: {
          application_id: string;
          vacancy_id: string;
          result: TechstackResult;
          reason: string;
          hits: string[];
          method: "rules" | "ai";
          model: string | null;
          checked_by: string | null;
          checked_at: string;
        };
        Insert: {
          application_id: string;
          vacancy_id: string;
          result: TechstackResult;
          reason: string;
          hits?: string[];
          method?: "rules" | "ai";
          model?: string | null;
          checked_by?: string | null;
          checked_at?: string;
        };
        Update: {
          application_id?: string;
          vacancy_id?: string;
          result?: TechstackResult;
          reason?: string;
          hits?: string[];
          method?: "rules" | "ai";
          model?: string | null;
          checked_by?: string | null;
          checked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "techstack_checks_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "techstack_checks_vacancy_id_fkey";
            columns: ["vacancy_id"];
            isOneToOne: false;
            referencedRelation: "vacancies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "techstack_checks_checked_by_fkey";
            columns: ["checked_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      screening_prompts: {
        Row: {
          id: string;
          version: number;
          instructions: string;
          notes: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          activated_at: string | null;
        };
        Insert: {
          id?: string;
          version?: number;
          instructions: string;
          notes?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          activated_at?: string | null;
        };
        Update: {
          id?: string;
          version?: number;
          instructions?: string;
          notes?: string | null;
          is_active?: boolean;
          created_by?: string | null;
          created_at?: string;
          activated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "screening_prompts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      cv_scores: {
        Row: {
          id: string;
          application_id: string;
          vacancy_id: string;
          candidate_id: string;
          purpose: CvScorePurpose;
          score: number;
          verdict: CvVerdict;
          summary: string | null;
          breakdown: Json;
          must_have_missing: number;
          model: string;
          prompt_id: string | null;
          prompt_version: number;
          effort: "low" | "medium" | "high" | null;
          input_tokens: number | null;
          output_tokens: number | null;
          cache_read_tokens: number | null;
          cache_write_tokens: number | null;
          cost_usd: number | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          vacancy_id: string;
          candidate_id: string;
          purpose?: CvScorePurpose;
          score: number;
          verdict: CvVerdict;
          summary?: string | null;
          breakdown?: Json;
          must_have_missing?: number;
          model: string;
          prompt_id?: string | null;
          prompt_version?: number;
          effort?: "low" | "medium" | "high" | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          cache_read_tokens?: number | null;
          cache_write_tokens?: number | null;
          cost_usd?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          application_id?: string;
          vacancy_id?: string;
          candidate_id?: string;
          purpose?: CvScorePurpose;
          score?: number;
          verdict?: CvVerdict;
          summary?: string | null;
          breakdown?: Json;
          must_have_missing?: number;
          model?: string;
          prompt_id?: string | null;
          prompt_version?: number;
          effort?: "low" | "medium" | "high" | null;
          input_tokens?: number | null;
          output_tokens?: number | null;
          cache_read_tokens?: number | null;
          cache_write_tokens?: number | null;
          cost_usd?: number | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cv_scores_application_id_fkey";
            columns: ["application_id"];
            isOneToOne: false;
            referencedRelation: "applications";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cv_scores_vacancy_id_fkey";
            columns: ["vacancy_id"];
            isOneToOne: false;
            referencedRelation: "vacancies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cv_scores_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cv_scores_prompt_id_fkey";
            columns: ["prompt_id"];
            isOneToOne: false;
            referencedRelation: "screening_prompts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cv_scores_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      passkeys: {
        Row: {
          id: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter: number;
          transports: string[];
          device_type: PasskeyDeviceType;
          backed_up: boolean;
          aaguid: string | null;
          name: string;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter?: number;
          transports?: string[];
          device_type?: PasskeyDeviceType;
          backed_up?: boolean;
          aaguid?: string | null;
          name: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          transports?: string[];
          device_type?: PasskeyDeviceType;
          backed_up?: boolean;
          aaguid?: string | null;
          name?: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      webauthn_challenges: {
        Row: {
          id: string;
          user_id: string | null;
          challenge: string;
          kind: WebauthnChallengeKind;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          challenge: string;
          kind: WebauthnChallengeKind;
          created_at?: string;
          expires_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          challenge?: string;
          kind?: WebauthnChallengeKind;
          created_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      mcp_tokens: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          token_hash: string;
          token_prefix: string;
          access: McpTokenAccess;
          created_at: string;
          expires_at: string | null;
          last_used_at: string | null;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          token_hash: string;
          token_prefix: string;
          access?: McpTokenAccess;
          created_at?: string;
          expires_at?: string | null;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          token_hash?: string;
          token_prefix?: string;
          access?: McpTokenAccess;
          created_at?: string;
          expires_at?: string | null;
          last_used_at?: string | null;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      custom_field_definitions: {
        Row: {
          id: string;
          entity: CustomFieldEntity;
          key: string;
          label: string;
          field_type: CustomFieldType;
          options: string[];
          help_text: string | null;
          position: number;
          show_in_list: boolean;
          archived_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          entity: CustomFieldEntity;
          key: string;
          label: string;
          field_type: CustomFieldType;
          options?: string[];
          help_text?: string | null;
          position?: number;
          show_in_list?: boolean;
          archived_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          label?: string;
          field_type?: CustomFieldType;
          options?: string[];
          help_text?: string | null;
          position?: number;
          show_in_list?: boolean;
          archived_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
    } & WorkTables & FormsTables & SalesTables & AcademyTables & AcademyAtsTables;
    Views: {
      call_list_candidates: { Row: ListCandidateBase & { phone: string; linkedin_url: string | null }; Relationships: [] };
      mail_list_candidates: { Row: ListCandidateBase & { email: string }; Relationships: [] };
      appointment_attribution: {
        Row: {
          activity_id: string;
          date: string;
          outcome: ActivityOutcome;
          contact_id: string | null;
          company_id: string | null;
          company_name: string | null;
          segment: Segment | null;
          channel: ActivityChannel;
          signal_type: string | null;
          campaign_name: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      current_client_id: { Args: Record<string, never>; Returns: string | null };
      client_review_application: {
        Args: { p_application_id: string; p_decision: string; p_feedback: string };
        Returns: undefined;
      };
      normalize_domain: { Args: { p_value: string }; Returns: string | null };
      normalize_linkedin: { Args: { p_value: string }; Returns: string | null };
      is_suppressed: { Args: { p_contact_id: string; p_channel: string }; Returns: boolean };
      is_contactable: { Args: { p_contact_id: string; p_channel: string }; Returns: boolean };
      admin_update_profile: {
        Args: { p_user_id: string; p_role: string; p_client_id: string | null };
        Returns: undefined;
      };
      has_module: { Args: { p_module: PortalModule }; Returns: boolean };
      can_access_entity: { Args: { p_entity_type: string | null }; Returns: boolean };
      can_see_job: { Args: { p_job_name: string }; Returns: boolean };
      admin_set_profile_modules: { Args: { p_user_id: string; p_modules: PortalModule[] }; Returns: undefined };
      interview_from_booking: {
        Args: {
          p_trigger: string;
          p_uid: string;
          p_previous_uid?: string | null;
          p_interview_id?: string | null;
          p_attendee_email?: string | null;
          p_starts_at?: string | null;
          p_ends_at?: string | null;
          p_reason?: string | null;
        };
        Returns: Json;
      };
      portal_company: {
        Args: Record<PropertyKey, never>;
        Returns: { id: string; name: string; city: string | null }[];
      };
      portal_vacancies: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          title: string;
          status: VacancyStatus;
          seniority: Seniority;
          stack: string[];
          opened_at: string;
          closed_at: string | null;
          presented_count: number;
          pending_count: number;
        }[];
      };
      portal_vacancy: {
        Args: { p_vacancy_id: string };
        Returns: {
          id: string;
          title: string;
          description: string | null;
          stack: string[];
          seniority: Seniority;
          status: VacancyStatus;
          opened_at: string;
          closed_at: string | null;
          desired_start_date: string | null;
        }[];
      };
      portal_candidates: {
        Args: { p_vacancy_id?: string | null; p_pending_only?: boolean };
        Returns: {
          application_id: string;
          vacancy_id: string;
          vacancy_title: string;
          stage: ApplicationStage;
          technical_score: number | null;
          english_score: number | null;
          presented_at: string | null;
          client_decision: ClientDecision;
          client_feedback: string | null;
          client_decided_at: string | null;
          candidate_id: string;
          full_name: string;
          current_title: string | null;
          location: string;
          years_experience: number | null;
          skills: string[];
          video_url: string | null;
          summary: string | null;
          has_cv: boolean;
        }[];
      };
      portal_cv_path: {
        Args: { p_application_id: string };
        Returns: string | null;
      };
      portal_placements: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          start_date: string;
          end_date: string | null;
          status: PlacementStatus;
          notice_given_at: string | null;
          guarantee_until: string | null;
          monthly_rate: number | null;
          candidate_name: string | null;
          candidate_title: string | null;
          vacancy_title: string | null;
        }[];
      };
      client_can_open_file: {
        Args: { p_path: string };
        Returns: boolean;
      };
      move_applications: {
        Args: { p_application_ids: string[]; p_stage: ApplicationStage | "resume"; p_reason?: string | null; p_park_until?: string | null };
        Returns: number;
      };
      move_applications_as: {
        Args: {
          p_actor: string;
          p_application_ids: string[];
          p_stage: ApplicationStage | "resume";
          p_reason?: string | null;
          p_park_until?: string | null;
        };
        Returns: number;
      };
      valid_screening_tools: {
        Args: { p_tools: Json };
        Returns: boolean;
      };
      is_restricted_attachment: {
        Args: { p_path: string };
        Returns: boolean;
      };
      screening_find_candidates: {
        Args: { p_emails?: string[]; p_phone_keys?: string[]; p_linkedins?: string[] };
        Returns: PublicTables["candidates"]["Row"][];
      };
      activate_screening_prompt: { Args: { p_prompt_id: string | null }; Returns: undefined };
      t2_candidate_pool: {
        Args: { p_vacancy_id: string; p_patterns?: string[]; p_weights?: number[]; p_require_hit?: boolean; p_limit?: number };
        Returns: PublicTables["candidates"]["Row"][];
      };
      set_custom_field: {
        Args: { p_entity: CustomFieldEntity; p_id: string; p_key: string; p_value: Json | null };
        Returns: CustomFieldValues;
      };
      validate_custom_fields: {
        Args: { p_entity: CustomFieldEntity; p_new: Json; p_old?: Json };
        Returns: CustomFieldValues;
      };
    } & WorkFunctions & FormsFunctions & SalesFunctions & AcademyFunctions & AcademyAtsFunctions;
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type PublicTables = Database["public"]["Tables"];
export type Tables<T extends keyof PublicTables> = PublicTables[T]["Row"];
export type TablesInsert<T extends keyof PublicTables> = PublicTables[T]["Insert"];
export type TablesUpdate<T extends keyof PublicTables> = PublicTables[T]["Update"];

export type Profile = Tables<"profiles">;
export type Client = Tables<"clients">;
export type ClientContact = Tables<"client_contacts">;
export type Vacancy = Tables<"vacancies">;
export type Candidate = Tables<"candidates">;
export type Application = Tables<"applications">;
export type Placement = Tables<"placements">;
export type PlacementCheckin = Tables<"placement_checkins">;
export type Note = Tables<"notes">;
export type Attachment = Tables<"attachments">;
export type ActivityEntry = Tables<"activity_log">;
export type ApplicationStageEvent = Tables<"application_stage_events">;
export type ApplicationAssessment = Tables<"application_assessments">;
export type Interview = Tables<"interviews">;
export type Company = Tables<"companies">;
export type Contact = Tables<"contacts">;
export type Signal = Tables<"signals">;
export type Campaign = Tables<"campaigns">;
export type Activity = Tables<"activities">;
export type Suppression = Tables<"suppression">;
export type ListExport = Tables<"list_exports">;
export type JobRun = Tables<"job_runs">;
export type Match = Tables<"matches">;
export type AnonymousProfile = Tables<"anonymous_profiles">;
export type Passkey = Tables<"passkeys">;
export type McpToken = Tables<"mcp_tokens">;
export type VacancyRequirement = Tables<"vacancy_requirements">;
export type TechstackCheck = Tables<"techstack_checks">;
export type ScreeningPrompt = Tables<"screening_prompts">;
export type CvScore = Tables<"cv_scores">;
export type CallListCandidate = Database["public"]["Views"]["call_list_candidates"]["Row"];
export type MailListCandidate = Database["public"]["Views"]["mail_list_candidates"]["Row"];

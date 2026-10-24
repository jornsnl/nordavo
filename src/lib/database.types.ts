// Hand-written to match supabase/migrations. Regenerate with
// `npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts`
// once the project exists, then keep the aliases at the bottom.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type ProfileRole = "admin" | "member" | "client";
export type ClientStatus = "lead" | "active" | "inactive";
export type Seniority = "medior" | "senior" | "lead";
export type VacancyStatus = "open" | "on_hold" | "filled" | "closed";
export type CandidateStatus = "available" | "in_process" | "placed" | "unavailable";
export type ApplicationStage =
  | "sourced"
  | "screening"
  | "technical_test"
  | "english_interview"
  | "presented"
  | "final_interview"
  | "placed"
  | "rejected";
export type ClientDecision = "pending" | "approved" | "rejected";
export type PlacementStatus = "active" | "notice" | "ended";
export type TaskStatus = "todo" | "in_progress" | "done";
export type TaskPriority = "low" | "normal" | "high";
export type EntityType = "client" | "vacancy" | "candidate" | "application" | "placement";
export type ActivityAction = "created" | "updated" | "deleted" | "stage_changed" | "status_changed";

// GTM
export type Segment = "saas" | "productie" | "agency_automation" | "agency_overig";
export type IcpDecision = "GO" | "NO_GO" | "REVIEW";
export type CompanyStatus = "nieuw" | "actief" | "klant" | "verloren" | "uitgesloten";
export type EmailStatus = "valid" | "invalid" | "catch_all" | "unknown";
export type PhoneType = "mobiel" | "vast";
export type ContactStatus =
  | "nieuw"
  | "gekwalificeerd"
  | "verrijkt"
  | "op_bellijst"
  | "in_mailcampagne"
  | "bereikt"
  | "afspraak"
  | "kans"
  | "klant"
  | "verloren"
  | "uitgesloten";
export type SignalType =
  | "vacature"
  | "lang_open"
  | "meerdere_rollen"
  | "remote_extern"
  | "freelance"
  | "funding"
  | "nieuwe_cto"
  | "overig";
export type SignalSource = "linkedin" | "indeed" | "overig";
export type CampaignChannel = "bellen" | "mail" | "linkedin";
export type ActivityChannel = "bellen" | "mail" | "linkedin" | "meeting";
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
  | "notitie";
export type ActivitySource = "handmatig" | "instantly" | "webpartners" | "calcom" | "onepage" | "import";
export type SuppressionReason = "afgemeld" | "bezwaar" | "klant" | "lopend_gesprek" | "niet_bellen";
export type SuppressionScope = "alle_kanalen" | "alleen_bellen" | "alleen_mail";
export type ListExportType = "bellijst" | "mailcampagne" | "max_verrijking";
export type JobStatus = "running" | "success" | "failed";
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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          role?: ProfileRole;
          client_id?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          role?: ProfileRole;
          client_id?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
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
          created_at: string;
          updated_at: string;
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
          created_at?: string;
          updated_at?: string;
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
          created_at?: string;
          updated_at?: string;
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
      tasks: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          status: TaskStatus;
          priority: TaskPriority;
          due_date: string | null;
          assignee_id: string | null;
          created_by: string | null;
          entity_type: EntityType | null;
          entity_id: string | null;
          position: number;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          due_date?: string | null;
          assignee_id?: string | null;
          created_by?: string | null;
          entity_type?: EntityType | null;
          entity_id?: string | null;
          position?: number;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          description?: string | null;
          status?: TaskStatus;
          priority?: TaskPriority;
          due_date?: string | null;
          assignee_id?: string | null;
          created_by?: string | null;
          entity_type?: EntityType | null;
          entity_id?: string | null;
          position?: number;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_created_by_fkey";
            columns: ["created_by"];
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
        };
        Insert: {
          id?: string;
          entity_type: EntityType;
          entity_id: string;
          body: string;
          author_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          entity_type?: EntityType;
          entity_id?: string;
          body?: string;
          author_id?: string | null;
          created_at?: string;
          updated_at?: string;
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
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
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
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
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
          outcome: ActivityOutcome;
          notes: string | null;
          next_action: string | null;
          next_action_date: string | null;
          source: ActivitySource;
          external_id: string | null;
          created_by: string | null;
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
          outcome: ActivityOutcome;
          notes?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          source?: ActivitySource;
          external_id?: string | null;
          created_by?: string | null;
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
          outcome?: ActivityOutcome;
          notes?: string | null;
          next_action?: string | null;
          next_action_date?: string | null;
          source?: ActivitySource;
          external_id?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
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
      matches: {
        Row: {
          id: string;
          vacancy_id: string;
          airtable_candidate_id: string;
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
          airtable_candidate_id: string;
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
          airtable_candidate_id?: string;
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
    };
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
    };
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
export type Task = Tables<"tasks">;
export type Note = Tables<"notes">;
export type Attachment = Tables<"attachments">;
export type ActivityEntry = Tables<"activity_log">;
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
export type CallListCandidate = Database["public"]["Views"]["call_list_candidates"]["Row"];
export type MailListCandidate = Database["public"]["Views"]["mail_list_candidates"]["Row"];

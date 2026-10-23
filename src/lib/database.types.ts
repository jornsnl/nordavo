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
          client_id: string;
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
        };
        Insert: {
          id?: string;
          client_id: string;
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
        };
        Update: {
          id?: string;
          client_id?: string;
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
    };
    Views: { [_ in never]: never };
    Functions: {
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      current_client_id: { Args: Record<string, never>; Returns: string | null };
      client_review_application: {
        Args: { p_application_id: string; p_decision: string; p_feedback: string };
        Returns: undefined;
      };
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

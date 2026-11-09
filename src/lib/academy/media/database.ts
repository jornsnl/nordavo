// Types of the tables and functions of the Academy media migration
// (supabase/migrations/20261113000000_academy_media.sql), merged into
// Database in src/lib/database.types.ts.

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type AcademyWatchRangesRow = {
  profile_id: string;
  video_id: string;
  version_id: string | null;
  /** Merged [start, end] seconds of the version last watched. */
  ranges: [number, number][];
  updated_at: string;
};

export type AcademyMediaTables = {
  academy_watch_ranges: {
    Row: AcademyWatchRangesRow;
    Insert: Partial<AcademyWatchRangesRow> & Pick<AcademyWatchRangesRow, "profile_id" | "video_id">;
    Update: Partial<AcademyWatchRangesRow>;
    Relationships: [];
  };
};

export type AcademyMediaFunctions = {
  /** Service role only: issues the certificate when the course is completed; the id when issued now. */
  academy_issue_certificate: Fn<{ p_course_id: string; p_profile_id: string }, string | null>;
};

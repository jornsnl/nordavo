import { defineJob } from "@/lib/gtm/jobs";
import { cvsToRead, readStoredCv } from "@/lib/screening/cv-read";

/**
 * Recruitment: read the CVs that have a file but no text yet into cv_text,
 * oldest first. New applications are read right after the form is sent;
 * this job catches up on CVs from before that and on reads that failed
 * (feedback Julius: the CVs of LinkedIn and Naukri candidates only come in
 * through the application form).
 *
 *   npm run job -- cv-read [--limit=50]
 *
 * DOCX and simple PDFs are read in code. Other PDFs go to Claude: with
 * ANTHROPIC_API_KEY directly, otherwise as a request for claude-requests.
 */
export const cvRead = defineJob({
  name: "cv-read",
  description: "Recruitment: read uploaded CVs without text into text (catches up on the application form)",
  run: async (ctx) => {
    const limit = Math.min(200, Math.max(1, Number(ctx.params.limit) || 50));
    const ids = await cvsToRead(ctx.db, limit);
    ctx.countIn(ids.length);
    let read = 0;
    let pending = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        const result = await readStoredCv(ctx.db, id);
        if (result.status === "read") read++;
        else if (result.status === "pending") pending++;
        else failed++;
      } catch (error) {
        failed++;
        console.error(`[cv-read] ${id}: ${error instanceof Error ? error.message : error}`);
      }
    }
    ctx.countOut(read);
    ctx.meta.read = read;
    ctx.meta.pending = pending;
    ctx.meta.failed = failed;
  },
});

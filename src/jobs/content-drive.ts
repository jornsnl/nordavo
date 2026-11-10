import "server-only";
import { defineJob } from "@/lib/gtm/jobs";
import { DRIVE_SETUP_HELP, hasGoogleDrive, syncDriveFolder } from "@/lib/content/drive";

/**
 * Content: import new files from the Google Drive folders of the media
 * libraries (docs/content.md). Safe to run often: known files are skipped.
 * --folder=<content_drive_folders id> syncs one folder.
 */
export const contentDriveSync = defineJob({
  name: "content-drive-sync",
  description: "Content: import new photos, PDFs and videos from the linked Google Drive folders",
  async run(ctx) {
    if (!hasGoogleDrive()) throw new Error(DRIVE_SETUP_HELP);
    let query = ctx.db.from("content_drive_folders").select("id, workspace_id, folder_id, name, created_by").order("created_at");
    if (ctx.params.folder) query = query.eq("id", ctx.params.folder);
    const { data: folders, error } = await query;
    if (error) throw new Error(`content_drive_folders: ${error.message}`);
    let failedFolders = 0;
    for (const folder of folders ?? []) {
      try {
        const summary = await syncDriveFolder(ctx.db, folder, ctx.log);
        ctx.countIn(summary.imported + summary.known + summary.skipped + summary.failed);
        ctx.countOut(summary.imported);
        ctx.log(`${folder.name ?? folder.folder_id}: ${summary.imported} new, ${summary.known} known, ${summary.skipped} skipped, ${summary.failed} failed`);
      } catch (e) {
        failedFolders++;
        ctx.log(`${folder.name ?? folder.folder_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    ctx.meta.folders = (folders ?? []).length;
    if (failedFolders > 0) {
      ctx.meta.failed_folders = failedFolders;
      if (failedFolders === (folders ?? []).length) throw new Error("No folder could be synced");
    }
  },
});

// ---------------------------------------------------------------------------
// Housekeeping: a finished report lets go of its pictures.
//
// Clips are the only thing this site stores that grows without limit, and a
// twenty-megabyte video of a crash from three seasons ago is costing storage
// to settle an argument that ended. Once a report has been DECIDED and left
// alone for longer than the league's chosen window, the file comes off disk.
//
// The conversation stays. So does the attachment ROW, marked as removed, so a
// thread says "a picture was here" instead of a message that used to be a clip
// quietly becoming empty.
//
// Off by default (0 = keep forever). Throwing away evidence is not a thing to
// start doing because nobody chose a setting.
// ---------------------------------------------------------------------------
import { readFileRetentionDays, dbExpiredAttachments, dbMarkAttachmentRemoved } from "../lib/reports.js";
import { removeAttachmentFiles } from "../lib/reportFiles.js";

export async function sweepReportFiles(prisma) {
  const days = await readFileRetentionDays(prisma);
  if (!days) return { days: 0, removed: 0 };
  const rows = await dbExpiredAttachments(prisma, days);
  for (const r of rows) {
    removeAttachmentFiles(r.reportId, [r.storedName]);
    await dbMarkAttachmentRemoved(prisma, r.id);
  }
  if (rows.length) console.log(`[reports] removed ${rows.length} attachment(s) from reports decided over ${days} day(s) ago`);
  return { days, removed: rows.length };
}

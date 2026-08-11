// ---------------------------------------------------------------------------
// The bytes behind a report's attachments.
//
// Two rules hold this together and both are load-bearing:
//
//   1. The files do NOT live under uploads/. That folder is mounted with
//      express.static, so anybody with a URL can read anything in it. A report
//      is a private conversation between two drivers and the stewards, and a
//      clip of somebody being punted is exactly the thing that must not leak
//      out of it. They live in report-files/ and come back only through a route
//      that has already run canRead().
//
//   2. The name on disk is ours, never theirs. An uploader's filename never
//      touches the filesystem: the row keeps what they called it (for the
//      download), and the file is a random id plus an extension picked from a
//      closed list of types. Path traversal, double extensions and a .exe
//      called .png all stop at that door rather than being filtered out of a
//      string.
//
// Shared by the member routes and the admin ones, because both halves of a
// thread put pictures in it and there is no version of this worth having twice.
// ---------------------------------------------------------------------------
import multer from "multer";
import { randomUUID } from "crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { REPORT_FILES_DIR } from "./dataDirs.js";
import { dbAddAttachment, dbGetAttachment, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "./reports.js";

// In memory, then written by hand: multer's disk storage would name the file
// before anything has checked what it is.
export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 4 },
  fileFilter: (req, file, cb) => {
    if (!ATTACHMENT_TYPES[file.mimetype]) {
      return cb(Object.assign(new Error(`${file.mimetype} is not a kind of file this takes`), { status: 400 }));
    }
    cb(null, true);
  },
});

// One directory per report, so deleting a thread is a directory nobody has to
// search for, and so a folder listing never runs to tens of thousands of files.
function dirFor(reportId) {
  const dir = join(REPORT_FILES_DIR, reportId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function saveAttachment(prisma, { report, messageId, file, uploaderDiscordId }) {
  const ext = ATTACHMENT_TYPES[file.mimetype];
  if (!ext) throw Object.assign(new Error("Not a kind of file this takes"), { status: 400 });
  const storedName = `${randomUUID()}${ext}`;
  writeFileSync(join(dirFor(report.id), storedName), file.buffer);
  return dbAddAttachment(prisma, {
    reportId: report.id,
    messageId,
    storedName,
    name: file.originalname || `file${ext}`,
    mime: file.mimetype,
    size: file.size,
    uploaderDiscordId,
  });
}

// Streams the file to a caller the ROUTE has already decided may read it.
// Nothing in here checks permissions — that is the caller's job, and it is
// written that way so the check cannot be accidentally satisfied by this
// function looking like it does one.
export async function serveAttachment(prisma, res, reportId, attachmentId) {
  const row = await dbGetAttachment(prisma, reportId, attachmentId);
  if (!row) return res.status(404).json({ error: "Not found" });
  const path = join(dirFor(reportId), row.storedName);
  if (!existsSync(path)) return res.status(404).json({ error: "Not found" });

  res.setHeader("Content-Type", row.mime);
  res.setHeader("Content-Length", String(row.size));
  // Never inline for anything but a picture or a clip: a PDF rendered in the
  // tab is a document from our own origin, and this is a file a stranger
  // uploaded. Images and video are decoded, not executed, so they can play in
  // the thread where they are useful.
  const inline = row.mime.startsWith("image/") || row.mime.startsWith("video/");
  const safeName = String(row.name).replace(/[^\w.\- ]+/g, "_");
  res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeName}"`);
  // Not stored at all. The URL is the same for everybody and the permission
  // behind it is not, so anything the browser keeps is a copy of a private
  // conversation that outlives the session that was allowed to see it — the
  // next person to use that machine would be served it from disk without the
  // server ever being asked. Caught exactly that way while testing: a request
  // with no session at all came back 200 from the browser's own cache.
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  createReadStream(path).pipe(res);
}

// Takes files off disk after their report has gone. Best-effort: a file that
// will not delete is not a reason to fail the deletion the admin asked for,
// and the row it belonged to is already gone.
export function removeAttachmentFiles(reportId, storedNames) {
  for (const n of storedNames || []) {
    try {
      unlinkSync(join(REPORT_FILES_DIR, reportId, n));
    } catch {
      /* already gone, or never written */
    }
  }
  // And the folder, which is named after a report that no longer exists.
  // rmSync with force+recursive rather than rmdir: a directory left behind by
  // an older delete may still hold a file nobody has a row for any more, and
  // leaving it is how a data directory fills up with things nothing can name.
  try {
    rmSync(join(REPORT_FILES_DIR, reportId), { recursive: true, force: true });
  } catch {
    /* never existed */
  }
}

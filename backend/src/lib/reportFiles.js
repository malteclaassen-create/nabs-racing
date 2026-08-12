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
//   3. The bytes never sit in memory. Four files of twenty megabytes is eighty
//      megabytes of heap per request, and the route cannot even say who is
//      sending them until the last one has arrived. They are streamed to a
//      staging folder instead and moved into the thread's folder once the
//      route has said they belong there.
//
// Shared by the member routes and the admin ones, because both halves of a
// thread put pictures in it and there is no version of this worth having twice.
// ---------------------------------------------------------------------------
import multer from "multer";
import { randomUUID } from "crypto";
import {
  copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync,
} from "fs";
import { join } from "path";
import { REPORT_FILES_DIR } from "./dataDirs.js";
import { dbAddAttachment, dbGetAttachment, ATTACHMENT_TYPES, MAX_ATTACHMENT_BYTES } from "./reports.js";

// Everything arrives here first, under a name of ours, and is moved into the
// report's own folder by saveAttachment. One staging folder rather than
// straight into the thread's, because the report id is still just a string out
// of the URL while multer is writing: it has no business being part of a path
// before the route has looked it up.
const STAGING_DIR = join(REPORT_FILES_DIR, "_incoming");

// The staging paths multer created for THIS request. Anything still listed when
// the response is over was never moved into a report and is rubbish: a rejected
// upload, a handler that threw, or a client that hung up mid-file (multer only
// deletes the files it had already finished writing).
const PENDING = Symbol("staged report attachments");

// A crash between multer writing and saveAttachment moving would leave a file
// nothing will ever come back for. The folder is empty almost all the time, so
// glancing at it when an upload starts costs nothing and keeps that from piling
// up. An hour old is far longer than any upload this accepts can take.
let lastSweep = 0;
function stagingDir() {
  mkdirSync(STAGING_DIR, { recursive: true });
  if (Date.now() - lastSweep > 10 * 60 * 1000) {
    lastSweep = Date.now();
    try {
      for (const name of readdirSync(STAGING_DIR)) {
        const p = join(STAGING_DIR, name);
        // Per file: one that will not budge (still being written on Windows)
        // must not stop the rest from going.
        try {
          if (Date.now() - statSync(p).mtimeMs > 60 * 60 * 1000) unlinkSync(p);
        } catch {
          /* busy, or gone between the listing and now */
        }
      }
    } catch {
      /* nothing to sweep */
    }
  }
  return STAGING_DIR;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, stagingDir());
      } catch (e) {
        cb(e);
      }
    },
    filename: (req, file, cb) => {
      // fileFilter has already run, so the type is one from the closed list.
      const name = `${randomUUID()}${ATTACHMENT_TYPES[file.mimetype] || ""}`;
      if (!req[PENDING]) req[PENDING] = [];
      req[PENDING].push(join(STAGING_DIR, name));
      cb(null, name);
    },
  }),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 4 },
  fileFilter: (req, file, cb) => {
    if (!ATTACHMENT_TYPES[file.mimetype]) {
      return cb(Object.assign(new Error(`${file.mimetype} is not a kind of file this takes`), { status: 400 }));
    }
    cb(null, true);
  },
});

function binStaged(req) {
  const paths = req[PENDING] || [];
  req[PENDING] = [];
  for (const p of paths) {
    try {
      unlinkSync(p);
    } catch {
      /* moved into a report already, or never finished */
    }
  }
}

// The same `.array("files", 4)` the routes have always mounted, wrapped so the
// staging folder cannot fill up with files nobody claimed. The hook goes on
// BEFORE multer runs, because the case that needs it most is a client hanging
// up mid-upload: multer never calls back then, and the part-written file is
// ours to take away.
//
// Only until the route has them, though. Once multer has handed the files on,
// the handler is the one moving them into the thread, and it does that a few
// awaits after it has already written the message. A browser that goes away in
// between (a phone locking the screen after "send", a tab closed while the
// reply is being filed) closes the response right then, and taking the file
// away at that moment would leave the message standing in the thread with its
// picture missing — which is worse than the file it was meant to save. From
// that point on the sweep above is what catches anything the handler failed to
// move.
export const attachmentUpload = {
  array(field, maxCount) {
    const inner = upload.array(field, maxCount);
    return (req, res, next) => {
      let routeHasThem = false;
      res.on("close", () => {
        if (!routeHasThem) binStaged(req);
      });
      inner(req, res, (err) => {
        routeHasThem = !err;
        next(err);
      });
    };
  },
};

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
  const target = join(dirFor(report.id), storedName);
  // A move, not a re-read: the bytes are already on disk in the staging folder
  // and this is the moment they become part of the thread. Either they are
  // there or they are here, never half in both.
  try {
    renameSync(file.path, target);
  } catch (e) {
    // Both folders sit under the same data directory, so this is the same
    // volume everywhere it runs; a staging folder mounted separately would make
    // the rename cross-device, and that is worth a copy rather than a 500.
    if (e.code !== "EXDEV") throw e;
    copyFileSync(file.path, target);
    try {
      unlinkSync(file.path);
    } catch {
      /* the sweep will get it */
    }
  }
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

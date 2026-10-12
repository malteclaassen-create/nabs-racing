// ---------------------------------------------------------------------------
// Pictures in a feedback conversation: a screenshot of the bug, a mock-up of the
// idea, or the admins showing what they changed.
//
// The same rules as a report's attachments (lib/reportFiles.js), cut down to
// what a feedback thread needs:
//
//   1. NOT under uploads/. That folder is served statically to anybody with a
//      URL, and a feedback thread is private between one member and the
//      admins. The files live in feedback-files/<feedbackId>/ and come back
//      only through a route that has already checked whose thread it is.
//
//   2. The name on disk is ours: a random id plus an extension picked from
//      what the BYTES are, never from what the upload claimed. The uploader's
//      own filename is only kept for the alt text.
//
//   3. Pictures only — PNG, JPEG, WEBP, GIF. No SVG: that is a document that
//      can carry script, and these are served from our own origin.
//
// Kept in memory rather than streamed to a staging folder like a report's
// clips: four pictures of ten megabytes is the most one request can carry, and
// the member route checks the thread is theirs before multer reads a byte.
// ---------------------------------------------------------------------------
import multer from "multer";
import { randomUUID } from "crypto";
import { createReadStream, existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { FEEDBACK_FILES_DIR } from "./dataDirs.js";
import { sniffImageType, checkImageUpload } from "./imageIntegrity.js";

export const FEEDBACK_IMAGE_TYPES = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};
export const MAX_FEEDBACK_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_FEEDBACK_IMAGES = 4;

// What the bytes are. imageIntegrity knows PNG, JPEG and WEBP; GIF is added
// here, and SVG (which it also recognises) is deliberately not let through.
function sniff(buf) {
  const head = Buffer.isBuffer(buf) ? buf.subarray(0, 6).toString("latin1") : "";
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  const kind = sniffImageType(buf);
  return FEEDBACK_IMAGE_TYPES[kind] ? kind : null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FEEDBACK_IMAGE_BYTES, files: MAX_FEEDBACK_IMAGES },
  // A first cut on the CLAIMED type, so a video does not get read into memory
  // only to be refused. The bytes decide for real in checkFeedbackImages.
  fileFilter: (req, file, cb) => {
    if (!String(file.mimetype || "").startsWith("image/")) {
      return cb(Object.assign(new Error("Only pictures can be attached here (PNG, JPEG, WEBP or GIF)."), { status: 400 }));
    }
    cb(null, true);
  },
});

const sizeLabel = `${MAX_FEEDBACK_IMAGE_BYTES / (1024 * 1024)} MB`;

// `.array("images")`, with multer's codes turned into sentences here rather
// than in the app-wide handler, whose size message is about a report's 20 MB.
// A plain JSON body passes straight through — multer only touches multipart.
export function feedbackImageUpload(req, res, next) {
  upload.array("images", MAX_FEEDBACK_IMAGES)(req, res, (err) => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `That picture is too big. The limit is ${sizeLabel} per picture.` });
    }
    if (err?.code === "LIMIT_FILE_COUNT" || err?.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: `Up to ${MAX_FEEDBACK_IMAGES} pictures per message.` });
    }
    next(err);
  });
}

// Every picture of the message is judged BEFORE any of them is written, so a
// message never goes out with three of its four pictures. Throws a 400 with the
// sentence to show; returns what saveFeedbackImages needs.
export function checkFeedbackImages(files) {
  const out = [];
  for (const f of files || []) {
    const mime = sniff(f.buffer);
    if (!mime) {
      throw Object.assign(
        new Error(`${f.originalname || "That file"} is not a PNG, JPEG, WEBP or GIF picture.`),
        { status: 400 }
      );
    }
    const whole = checkImageUpload(f.buffer, mime);
    if (!whole.ok) throw Object.assign(new Error(whole.error), { status: 400 });
    out.push({ buffer: f.buffer, mime, name: String(f.originalname || "picture").slice(0, 120) });
  }
  return out;
}

function dirFor(feedbackId) {
  return join(FEEDBACK_FILES_DIR, feedbackId);
}

// Writes the checked pictures into the thread's folder and returns what the
// reply row keeps about each: our id, the type, the size and the name it came
// with. The path on disk is never part of it.
export function saveFeedbackImages(feedbackId, checked) {
  if (!checked.length) return [];
  const dir = dirFor(feedbackId);
  mkdirSync(dir, { recursive: true });
  const saved = [];
  try {
    for (const c of checked) {
      const id = randomUUID();
      writeFileSync(join(dir, `${id}${FEEDBACK_IMAGE_TYPES[c.mime]}`), c.buffer);
      saved.push({ id, mime: c.mime, size: c.buffer.length, name: c.name });
    }
  } catch (e) {
    discardFeedbackImages(feedbackId, saved);
    throw e;
  }
  return saved;
}

// Undo for saveFeedbackImages, when the reply they belong to could not be
// written after all.
export function discardFeedbackImages(feedbackId, images) {
  for (const img of images || []) {
    try {
      unlinkSync(join(dirFor(feedbackId), `${img.id}${FEEDBACK_IMAGE_TYPES[img.mime] || ""}`));
    } catch {
      /* never written */
    }
  }
}

// The picture with this id somewhere in the thread, or null. Looked up in the
// thread's own replies, so an id from another thread is simply not found.
export function findFeedbackImage(entry, imageId) {
  for (const r of entry?.replies || []) {
    const img = (r.images || []).find((i) => i.id === imageId);
    if (img) return img;
  }
  return null;
}

// Streams a picture to a caller the ROUTE has already decided may see it.
export function serveFeedbackImage(res, entry, imageId) {
  const img = findFeedbackImage(entry, String(imageId || ""));
  const ext = img && FEEDBACK_IMAGE_TYPES[img.mime];
  const path = ext && join(dirFor(entry.id), `${img.id}${ext}`);
  if (!path || !existsSync(path)) return res.status(404).json({ error: "Not found" });
  res.setHeader("Content-Type", img.mime);
  res.setHeader("Content-Disposition", "inline");
  // Same as a report's files: the URL is the same for everybody and the
  // permission behind it is not, so the browser keeps no copy.
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  createReadStream(path).pipe(res);
}

// The thread's whole folder, once the thread itself is gone.
export function removeFeedbackFiles(feedbackId) {
  if (!feedbackId) return;
  try {
    rmSync(dirFor(feedbackId), { recursive: true, force: true });
  } catch {
    /* never had any */
  }
}

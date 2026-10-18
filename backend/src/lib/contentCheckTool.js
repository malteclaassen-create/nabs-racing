// ---------------------------------------------------------------------------
// The Content Check as a download: contentCheckTool.bat, a double-click tool
// for Windows that finds the driver's Assetto Corsa folder by itself (Steam's
// registry entry and library list) and runs the same comparison as the
// /content-check page against /api/content-check. For the drivers the page
// cannot reach: Firefox users without the folder picker, and anybody who
// would rather not hunt for steamapps\common\assettocorsa.
//
// The file is a template: the site's own address goes in where it says
// __NABS_SITE__, so a copy downloaded from a tunnel or a new domain asks that
// same site. Served with CRLF line endings, because cmd.exe misreads a batch
// file with bare LFs (labels and long lines break) and the repo stores LF.
// ---------------------------------------------------------------------------
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

export const CONTENT_CHECK_TOOL_NAME = "NABS-Content-Check.bat";

let template = null;

// An origin fit to be pasted into a PowerShell string: scheme, host, optional
// port, nothing else. The address comes from the request's Host header, which
// the caller controls, so anything that could close the quote is refused
// rather than escaped.
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

export function contentCheckTool(origin) {
  if (!ORIGIN_RE.test(String(origin || ""))) return null;
  if (template == null) template = readFileSync(join(__dir, "contentCheckTool.bat"), "utf8");
  return template.replace("__NABS_SITE__", origin).replace(/\r?\n/g, "\r\n");
}

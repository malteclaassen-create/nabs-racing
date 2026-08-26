// The handful of facts on the privacy page that only the league can supply:
// who is legally responsible for the site, how to reach them, and what the
// Android app is called once there is one.
//
// They live here rather than in the page's source because the person who has
// to answer for them is not the person who edits code. Everything else on
// /privacy is a description of what the software does and belongs with the
// software; these four fields are a decision, and decisions get an admin form.
//
// Stored as one JSON blob in the Setting table, same pattern as raceInfo.js and
// welcomeFaq.js. Nothing saved = every field empty, and the public page then
// says the contact is still being settled instead of inventing one.

export const PRIVACY_INFO_KEY = "privacy_info";

export const PRIVACY_INFO_EMPTY = {
  controllerName: "",
  controllerAddress: "",
  controllerEmail: "",
  appName: "",
};

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Lenient, like the other blob editors: trim and cap, never reject. The email
// is not pattern-checked on purpose — a league that wants to publish a contact
// form address or a role account with an unusual shape should not be argued
// with by a regular expression. The page decides how to render what it gets.
export function sanitizePrivacyInfo(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  return {
    controllerName: str(input.controllerName, 160),
    controllerAddress: str(input.controllerAddress, 300),
    controllerEmail: str(input.controllerEmail, 160),
    appName: str(input.appName, 60),
  };
}

export async function readPrivacyInfo(prisma) {
  const row = await prisma.setting.findUnique({ where: { key: PRIVACY_INFO_KEY } });
  if (!row) return { ...PRIVACY_INFO_EMPTY };
  try {
    return sanitizePrivacyInfo(JSON.parse(row.value)) || { ...PRIVACY_INFO_EMPTY };
  } catch {
    return { ...PRIVACY_INFO_EMPTY };
  }
}

// info = null clears the whole blob (page goes back to "still being settled").
export async function writePrivacyInfo(prisma, info) {
  if (info == null) {
    await prisma.setting.deleteMany({ where: { key: PRIVACY_INFO_KEY } });
    return { ...PRIVACY_INFO_EMPTY };
  }
  const clean = sanitizePrivacyInfo(info);
  if (!clean) throw Object.assign(new Error("Invalid privacy info"), { status: 400 });
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({
    where: { key: PRIVACY_INFO_KEY },
    update: { value },
    create: { key: PRIVACY_INFO_KEY, value },
  });
  return clean;
}

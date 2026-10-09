// The sign-up answers members can give, as words for a sentence:
// "Accepted or Declined". Which ones exist is an admin setting (Admin ->
// Notifications, "Answers members can give"); the server sends it along with
// the page texts that talk about signing up (/api/settings/help, /race-info,
// /welcome-faq), so no page names a button that was switched off.
//
// Follows the order of the buttons on the Attendance page. Unknown (request
// not back yet, or failed) = all three, the shipped default.
const ANSWER_LABELS = [
  ["ACCEPTED", "Accepted"],
  ["TENTATIVE", "Tentative"],
  ["DECLINED", "Declined"],
];

// bold: true wraps each one in **...** for the pages that render that markup.
export function answerWords(statuses, { bold = true } = {}) {
  const on = Array.isArray(statuses) ? statuses : ANSWER_LABELS.map(([k]) => k);
  const words = ANSWER_LABELS.filter(([k]) => on.includes(k)).map(([, l]) => (bold ? `**${l}**` : l));
  if (words.length <= 1) return words[0] || (bold ? "**Accepted**" : "Accepted");
  return `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

// Texts admins saved before {answers} existed spell the list out, in any of
// the usual shapes: "Accepted, Tentative or Declined", bold or not, with or
// without the comma before "or". Shown as written, that names a button which
// may be switched off, so the spelled-out list is read as {answers}. The saved
// text itself is not touched.
const SPELLED_OUT =
  /(\*\*)?Accepted(\*\*)?,\s*(\*\*)?Tentative(\*\*)?,?\s+(or|and)\s+(\*\*)?Declined(\*\*)?/gi;
export function withLiveAnswers(s) {
  return String(s ?? "").replace(SPELLED_OUT, "{answers}");
}

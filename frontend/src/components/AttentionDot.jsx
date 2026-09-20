// The "there is work waiting" dot, for admins, outside the admin area.
//
// Deliberately a dot and not a number: it hangs on a profile chip and on a menu
// row, where a figure would be read as something about the driver rather than
// about the league's paperwork. The count is written out for anyone who cannot
// see the dot, and shown on hover for anyone who can.
//
// The ring is the card colour rather than a border so the dot still separates
// from whatever it sits on, including an avatar photo.
//
// Where the number comes from: hooks/useAdminAttention.js.
export default function AttentionDot({ total, summary = "", className = "" }) {
  if (!total) return null;
  // `summary` is the breakdown in words ("1 seat waiting · 2 logins without a
  // driver"). Without it the dot is a red spot that says "something, somewhere",
  // and an admin who opens the admin area still has to go looking.
  const said = summary || `${total} ${total === 1 ? "thing is" : "things are"} waiting on an admin`;
  return (
    <span
      className={`pointer-events-none block h-2 w-2 rounded-full bg-bad ring-2 ring-card ${className}`}
      role="status"
      aria-label={summary ? `Waiting on an admin: ${summary}` : `${total} ${total === 1 ? "thing needs" : "things need"} an admin`}
      title={said}
    />
  );
}

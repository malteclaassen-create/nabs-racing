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
export default function AttentionDot({ total, className = "" }) {
  if (!total) return null;
  return (
    <span
      className={`pointer-events-none block h-2 w-2 rounded-full bg-bad ring-2 ring-card ${className}`}
      role="status"
      aria-label={`${total} ${total === 1 ? "thing needs" : "things need"} an admin`}
      title={`${total} ${total === 1 ? "thing is" : "things are"} waiting on an admin`}
    />
  );
}

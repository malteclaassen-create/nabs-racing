// Real flag image (flagcdn.com) — works on Windows, unlike emoji flags.
// `code` is an ISO 3166-1 alpha-2 code (e.g. "de"). Renders nothing if empty
// or if the image fails to load.
export default function Flag({ code, title, className = "", w = 20, h = 15 }) {
  if (!code) return null;
  const c = String(code).toLowerCase();
  return (
    <img
      src={`https://flagcdn.com/w40/${c}.png`}
      srcSet={`https://flagcdn.com/w80/${c}.png 2x`}
      width={w}
      height={h}
      alt={title || c.toUpperCase()}
      title={title || c.toUpperCase()}
      loading="lazy"
      onError={(e) => (e.currentTarget.style.display = "none")}
      className={`inline-block shrink-0 rounded-[2px] object-cover ring-1 ring-black/15 ${className}`}
    />
  );
}

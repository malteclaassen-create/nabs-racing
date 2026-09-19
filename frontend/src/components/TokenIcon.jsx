// The NABS Points mark. One image for every size it appears in: the nav bar
// pill, the price tags in the shop, the balance card. Kept square by the
// className (h-4 w-4 and the like), so the callers did not change.
//
// A new file name rather than a new file under the old one: everything in
// public/ is served at its own path with no hash on it, so re-using the name
// would have left the old coin in people's browser caches for days.
export default function TokenIcon({ className = "h-4 w-4", cyan = false }) {
  return (
    <img
      src={cyan ? "/nabs-star-cyan.webp" : "/nabs-star.webp"}
      alt=""
      aria-hidden="true"
      draggable="false"
      className={`inline-block shrink-0 select-none object-contain ${className}`}
    />
  );
}


// The NABS Points coin. One image for every size it appears in: the nav bar
// pill, the price tags in the shop, the balance card. Kept square by the
// className (h-4 w-4 and the like), so the callers did not change.
export default function TokenIcon({ className = "h-4 w-4" }) {
  return (
    <img
      src="/nabs-points.webp"
      alt=""
      aria-hidden="true"
      draggable="false"
      className={`inline-block shrink-0 select-none object-contain ${className}`}
    />
  );
}


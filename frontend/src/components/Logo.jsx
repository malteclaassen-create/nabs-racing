// NABS logo — uses the real logo images. Two versions swap by theme:
//   logo-light.png (black mark) on light mode, logo-dark.png (pink mark) on dark.
// The `dark` class lives on <html>, so Tailwind's dark: variants do the swap.
// Pass `size` (px) and optional `className`.
export default function Logo({ size = 40, className = "" }) {
  return (
    <>
      <img
        src="/logo-light.png"
        width={size}
        height={size}
        alt="NABS Racing"
        className={`block dark:hidden ${className}`}
      />
      <img
        src="/logo-dark.png"
        width={size}
        height={size}
        alt="NABS Racing"
        className={`hidden dark:block ${className}`}
      />
    </>
  );
}

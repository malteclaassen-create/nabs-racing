// How the phone is held, for the scenes that lean with it (-1..1 each way).
// Pointer position stands in on a computer.
export const tilt = { x: 0, y: 0 };
window.addEventListener("deviceorientation", (e) => {
  if (e.gamma == null) return;
  tilt.x = Math.max(-1, Math.min(1, e.gamma / 30));
  tilt.y = Math.max(-1, Math.min(1, (e.beta - 45) / 30));
});
window.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  tilt.x = (e.clientX / innerWidth) * 2 - 1;
  tilt.y = (e.clientY / innerHeight) * 2 - 1;
});

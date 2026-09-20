function makeShell(seed, count, palette) {
  let state = seed;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count + (random() - .5) * .025) * Math.PI * 2;
    // Mix a dense inner bloom with longer, irregular outer sparks.
    const radius = (i % 4 === 0 ? 42 : 85) + random() * (i % 4 === 0 ? 35 : 65);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * (.8 + random() * .2);
    return { x, y, fall: 28 + random() * 44, radius: .9 + random() * 1.25, color: palette[i % palette.length] };
  });
}
const SHELLS = [
  { x: 18, y: 25, cycle: 7.3, phase: -1.8, size: 1, colors: ["#ffd58b", "#ffeccc", "#efa859"] },
  { x: 74, y: 21, cycle: 9.1, phase: -5.2, size: .83, colors: ["#9de7ff", "#d0dcff", "#8ea8ff"] },
  { x: 47, y: 53, cycle: 10.7, phase: -7.7, size: 1.2, colors: ["#f5a9d5", "#ffe4cf", "#d39df8"] },
  { x: 83, y: 76, cycle: 8.3, phase: -3.7, size: .94, colors: ["#ffd58b", "#f4efcf", "#ffa97c"] },
  { x: 24, y: 83, cycle: 11.3, phase: -8.5, size: .76, colors: ["#9de7ff", "#b9f4e3", "#ffeccc"] },
].map((shell, i) => ({ ...shell, particles: makeShell(8731 + i * 9319, 48 + i * 4, shell.colors) }));

export default function ProfileFireworks() {
  return <>{SHELLS.map((shell, i) => <svg key={i} className={`premium-fx-art fx-firework fx-firework--${i}`} viewBox="-180 -200 360 400" style={{ "--firework-x": `${shell.x}%`, "--firework-y": `${shell.y}%`, "--firework-cycle": `${shell.cycle}s`, "--firework-delay": `${shell.phase}s`, "--firework-size": shell.size, "--spark-color": shell.colors[0] }}>
    <path className="fx-launch fx-firework-motion" d="M-22 185C-12 95 16 40 0 0" pathLength="1" />
    <path className="fx-flare fx-firework-motion" d="M-3 0H3M0-3V3" />
    {shell.particles.map((p, ray) => <g key={ray} className="fx-particle fx-firework-motion" style={{ "--spark-x": `${p.x}px`, "--spark-y": `${p.y}px`, "--spark-fall": `${p.fall}px`, "--particle-color": p.color }}>
      <path className="fx-particle-trail fx-firework-motion" d={`M${-p.x * .13} ${-p.y * .13 - 3}Q${-p.x * .05} ${-p.y * .04 - 2} 0 0`} />
      {/* Only the outer sparks sputter. Keep the shell clock shared so the
          shimmer starts during burnout, never during launch or expansion. */}
      <g className={ray % 4 === 0 ? "fx-spark-inner fx-firework-motion" : `fx-spark-burn fx-spark-burn--${ray % 3} fx-firework-motion`} style={{ "--spark-burn-shift": `${((ray * 17) % 19) / 50}s` }}>
        <circle className="fx-particle-glow" r={p.radius * 2.6} />
        <circle className="fx-spark-tip" r={p.radius} />
        {ray % 4 !== 0 && <circle className="fx-spark-hot-core" r={p.radius * .45} />}
      </g>
    </g>)}
  </svg>)}</>;
}

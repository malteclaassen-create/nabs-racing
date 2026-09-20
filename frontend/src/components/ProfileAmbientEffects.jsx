const noise = (i, salt = 0) => {
  const value = Math.sin((i + 1) * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};

/** Independent particle clocks, with a bounded density in document coordinates. */
export default function ProfileAmbientEffects({ finish, id, width = 540, height = 220 }) {
  const area = width * height;
  const limits = { embers: [22, 140, 26000], rain: [9, 65, 65000], prism: [5, 32, 120000], orbits: [2, 10, 450000], bubbles: [6, 38, 100000] };
  const [min, max, spacing] = limits[finish];
  const count = Math.min(max, Math.max(min, Math.round(area / spacing)));
  const items = Array.from({ length: count }, (_, i) => ({
    x: (i * .61803398875 + .13) % 1 * width,
    y: (i + .5) / count * height,
    size: .65 + noise(i, 2) * .85,
    cycle: (finish === "rain" ? 3 : 12) + noise(i, 3) * (finish === "rain" ? 4 : 15),
    phase: -noise(i, 4) * 30,
  }));
  return <svg className={`premium-fx-art fx-atmosphere fx-${finish}-art`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    <defs>
      <radialGradient id={`${id}-ember`}><stop stopColor="#fff5c5" /><stop offset=".2" stopColor="#ffc166" /><stop offset=".55" stopColor="#ff631b" stopOpacity=".5" /><stop offset="1" stopColor="#ff4816" stopOpacity="0" /></radialGradient>
      <linearGradient id={`${id}-rain`} x1="0" y1="-65" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop stopColor="#8bafff" stopOpacity="0" /><stop offset="1" stopColor="#c9efff" /></linearGradient>
      <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#83e9ff" stopOpacity=".65" /><stop offset=".45" stopColor="#9671ed" stopOpacity=".15" /><stop offset="1" stopColor="#ffc0dd" stopOpacity=".7" /></linearGradient>
      <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c9fdff" /><stop offset=".3" stopColor="#9faaff" stopOpacity=".35" /><stop offset=".62" stopColor="#f6b3ec" /><stop offset="1" stopColor="#76eadc" stopOpacity=".55" /></linearGradient>
      <radialGradient id={`${id}-bubble`} cx="35%" cy="25%" r="80%"><stop stopColor="#d1faff" stopOpacity=".07" /><stop offset=".68" stopColor="#aa8bd8" stopOpacity=".01" /><stop offset=".9" stopColor="#879cdb" stopOpacity=".12" /><stop offset="1" stopColor="#b4eee8" stopOpacity=".22" /></radialGradient>
      <radialGradient id={`${id}-core`}><stop stopColor="#edfbff" /><stop offset=".12" stopColor="#bcbdff" /><stop offset=".35" stopColor="#877bee" stopOpacity=".35" /><stop offset="1" stopColor="#568bd6" stopOpacity="0" /></radialGradient>
    </defs>
    {items.map((item, i) => <g key={i} transform={`translate(${item.x} ${item.y})`} style={{ "--ambient-cycle": `${item.cycle}s`, "--ambient-phase": `${item.phase}s`, "--ambient-drift": `${(noise(i, 6) - .5) * 120}px`, "--ambient-rise": `${-160 - noise(i, 7) * 200}px`, "--ambient-turn": `${(noise(i, 8) - .5) * 80}deg` }}>
      {finish === "embers" && <g className="fx-ember-rise fx-ambient-clock">
        <g transform={`scale(${item.size}) rotate(${noise(i) * 120})`}>
          <circle r={i % 4 === 0 ? 13 : 7} fill={`url(#${id}-ember)`} />
          <path className="fx-ember-core" d={i % 3 === 0 ? "M-1 4Q-3 0 0-6Q3 0 1 3Z" : "M0-2 1 0 0 3-1 0Z"} />
        </g>
      </g>}
      {finish === "rain" && <>
        <g transform="rotate(12)"><path className="fx-rain-drop fx-ambient-clock" d="M0-65V0" stroke={`url(#${id}-rain)`} /></g>
        <g transform={`scale(${item.size} ${item.size * .32})`}>
          <circle className="fx-rain-ring fx-ambient-clock" r="19" />
          <circle className="fx-rain-ring fx-rain-ring-inner fx-ambient-clock" r="12" />
        </g>
      </>}
      {finish === "prism" && <g className="fx-prism-drift fx-ambient-clock">
        <g transform={`scale(${item.size}) rotate(${i * 53 % 180})`}>
          <g className="fx-prism-turn fx-ambient-clock">
            <path d="M0-48 28-12 20 32-8 48-29 8Z" fill={`url(#${id}-glass)`} stroke={`url(#${id}-rim)`} strokeWidth=".9" />
            <path d="M0-48 4-4-29 8Z" fill="#a4efff" opacity=".17" />
            <path d="M4-4 28-12 20 32Z" fill="#ddd0ff" opacity=".23" />
            <path d="M4-4 20 32-8 48Z" fill="#c790db" opacity=".14" />
            <path d="M0-48 4-4-8 48M-29 8 4-4 28-12" fill="none" stroke="#d9e6ff" strokeWidth=".65" opacity=".4" />
            <path className="fx-prism-glint fx-ambient-clock" d="M-6-31H6M0-37V-25" fill="none" stroke="#f3fcff" strokeWidth="1.2" />
          </g>
        </g>
      </g>}
      {finish === "orbits" && <g transform={`scale(${item.size})`}>
        <circle r="34" fill={`url(#${id}-core)`} />
        {[0, 1, 2].map(plane => <g key={plane} transform={`rotate(${plane * 61 - 32}) scale(1 ${.32 + plane * .08})`}>
          <circle className="fx-orbit-ring" r={86 + plane * 12} />
          <g className="fx-orbit-runner fx-ambient-clock" style={{ animationDirection: plane === 1 ? "reverse" : "normal", animationDelay: `${item.phase - plane * 5}s` }}>
            <path d={`M${(86 + plane * 12) * .5} ${-(86 + plane * 12) * .866}A${86 + plane * 12} ${86 + plane * 12} 0 0 1 ${86 + plane * 12} 0`} fill="none" stroke={["#97dfff", "#c2adff", "#f5bee2"][plane]} strokeWidth="2" opacity=".75" />
            <circle cx={86 + plane * 12} r="4" fill="#e1f7ff" className="fx-orbit-head" />
          </g>
        </g>)}
      </g>}
      {finish === "bubbles" && <g className="fx-bubble-rise fx-ambient-clock">
        <g className="fx-bubble-sway fx-ambient-clock"><g transform={`scale(${item.size * (i % 3 === 0 ? .55 : 1)})`}>
          <circle r="38" fill={`url(#${id}-bubble)`} stroke={`url(#${id}-rim)`} strokeWidth="1.1" />
          <path d="M-29-8A30 30 0 0 1-7-29" fill="none" stroke="#e5fbff" strokeWidth="2.5" strokeLinecap="round" opacity=".75" />
          <path d="M10 32A34 34 0 0 0 31 13" fill="none" stroke="#f6b3ea" strokeWidth="1.5" strokeLinecap="round" opacity=".65" />
          <ellipse cx="-17" cy="-22" rx="7" ry="3" transform="rotate(-35 -17 -22)" fill="#efffff" opacity=".3" />
        </g></g>
      </g>}
    </g>)}
  </svg>;
}

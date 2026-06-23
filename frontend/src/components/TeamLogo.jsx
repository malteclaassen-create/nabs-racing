import { useState } from "react";

// Teams that have a logo file in /public/teams/<id>.png
const HAS_LOGO = new Set([
  "porsche", "mclaren", "ferrari", "williams", "honda", "renault", "super_aguri",
  "spyker", "torro_rosso", "redbull", "toyota", "bmw", "jaguar", "fiat",
  "lamborghini", "ncb_mugen",
]);

// Short monogram for teams without a logo file (fallback badge).
const ABBR = {
  porsche: "POR", mclaren: "MCL", ferrari: "FER", williams: "WIL",
  honda: "HON", renault: "REN", super_aguri: "SAG", spyker: "SPY",
  torro_rosso: "TR", redbull: "RB", toyota: "TOY", bmw: "BMW",
  jaguar: "JAG", fiat: "FIA", lamborghini: "LAM", ncb_mugen: "NCB",
  lotus: "LOT", reserve: "RES",
};

// Map team name -> id, so callers that only have a name still resolve a logo.
const NAME_TO_ID = {
  "Porsche Martini": "porsche", "McLaren": "mclaren", "Ferrari": "ferrari",
  "Williams": "williams", "Honda": "honda", "Renault": "renault",
  "Super Aguri": "super_aguri", "Spyker": "spyker", "Torro Rosso": "torro_rosso",
  "Red Bull": "redbull", "Toyota": "toyota", "BMW Sauber": "bmw",
  "Jaguar": "jaguar", "Fiat": "fiat", "Lamborghini": "lamborghini",
  "NCB Mugen": "ncb_mugen", "Lotus": "lotus", "Reserve": "reserve",
};

function monogram(id, name) {
  if (id && ABBR[id]) return ABBR[id];
  return (name || "?").slice(0, 3).toUpperCase();
}

/**
 * Team mark. Renders the team logo image, falling back to a colour-tinted
 * monogram badge when no logo file exists (or the image fails to load).
 *
 * Props: id, name, color, size (px), showName, nameClassName, className.
 */
export default function TeamLogo({
  id,
  name,
  color = "#888",
  size = 22,
  showName = false,
  className = "",
  nameClassName = "",
}) {
  const [errored, setErrored] = useState(false);
  const teamId = id || NAME_TO_ID[name];
  const useImg = teamId && HAS_LOGO.has(teamId) && !errored;

  const mark = useImg ? (
    <img
      src={`/teams/${teamId}.png`}
      alt={name || teamId}
      title={name}
      onError={() => setErrored(true)}
      style={{ width: size, height: size }}
      className="shrink-0 object-contain"
    />
  ) : (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        fontSize: Math.max(8, Math.round(size * 0.34)),
      }}
      className="flex shrink-0 items-center justify-center rounded-md font-mono font-bold leading-none text-white ring-1 ring-black/10"
    >
      {monogram(teamId, name)}
    </span>
  );

  if (!showName) return <span className={className}>{mark}</span>;

  return (
    <span className={`flex items-center gap-2 ${className}`}>
      {mark}
      <span className={nameClassName || "truncate"}>{name}</span>
    </span>
  );
}

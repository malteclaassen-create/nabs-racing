// ---------------------------------------------------------------------------
// Season awards look "plaques" (Hall of Fame preview, ?look=plaques). Every
// award is the engraved nameplate off a trophy base: a plate of dark brushed
// metal with a bevelled edge and a brass screw in each corner, the award and
// the winner cut into it, and the winner set into a round, brass-rimmed
// medallion at its left (portrait or initials, team logo, the circuit, or a
// laurel for a typed name). The season is stamped into the frame at the foot
// of every plate, the way a trophy plate carries its year. The plates hang two
// across, one on a phone, an odd last one centred under the rest the way you
// would hang them on a wall. The metal stays dark on the light theme too, like
// the WINS panel further down the page; it is all in lookPlaques.css.
// ---------------------------------------------------------------------------
import { useState } from "react";
import { Link } from "react-router-dom";
import { Flag as FlagIcon } from "lucide-react";
import { readableInkOn, sizedAvatarUrl } from "../ui.jsx";
import Flag from "../Flag.jsx";
import CircuitMap from "../CircuitMap.jsx";
import SlidingTabs from "../SlidingTabs.jsx";
import { hasOutline, useTrackOutlines } from "../../data/trackOutlines.js";
import { useSwapClass } from "../../hooks/motion.js";
import { winnerOf } from "./shared.js";
import "./lookPlaques.css";

// Four screws never line up on a real plate, so each corner gets its own turn.
const SCREWS = [
  ["tl", -32],
  ["tr", 58],
  ["bl", 14],
  ["br", -71],
];

// winnerOf hands a driver's flag over as a code but a race's as the whole
// flagFor() record ({ country, countryName, ... }); both become a code here.
const flagCode = (flag) => (typeof flag === "string" ? flag : flag?.country) || null;

const initialsOf = (name) =>
  (name || "?")
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

// The logos that ship with the site in /public/teams, and the team names they
// belong to: a copy of HAS_LOGO and NAME_TO_ID in TeamLogo.jsx, which does not
// export them, so keep the two in step. Only these files are ever asked for. A
// missing /teams/<id>.png is no cheap 404 in production: /teams is a page of
// the site, so the server answers with the whole app page, and the service
// worker then keeps that page as the "image".
const BUNDLED_LOGOS = new Set([
  "porsche", "mclaren", "ferrari", "williams", "honda", "renault", "super_aguri",
  "spyker", "torro_rosso", "redbull", "toyota", "bmw", "jaguar", "fiat",
  "lamborghini", "ncb_mugen", "lotus",
]);
const BUNDLED_BY_NAME = {
  "Porsche Martini": "porsche", "McLaren": "mclaren", "Ferrari": "ferrari",
  "Williams": "williams", "Honda": "honda", "Renault": "renault",
  "Super Aguri": "super_aguri", "Spyker": "spyker", "Torro Rosso": "torro_rosso",
  "Red Bull": "redbull", "Toyota": "toyota", "BMW Sauber": "bmw",
  "Jaguar": "jaguar", "Fiat": "fiat", "Lamborghini": "lamborghini",
  "NCB Mugen": "ncb_mugen", "Lotus": "lotus",
};

// The pictures to try for a team, best first: its own upload, then the logo
// bundled for it, by id or else by name (a season's copy of a team has an id
// with a suffix, such as porsche_s6).
function teamPictures(team) {
  const id = [team.id, BUNDLED_BY_NAME[team.name]].find((x) => x && BUNDLED_LOGOS.has(x));
  return [...new Set([team.logoUrl, id && `/teams/${id}.png`])].filter(Boolean);
}

// Wider than this and a logo is a wordmark (Toro Rosso's is 5 to 1): in a
// round medallion or at 14px it shrinks to a thin line, so the plate shows the
// team's initials or colour instead.
const WORDMARK = 3.2;

// The part of a logo file that is actually drawn, as shares of the file (x, y,
// w, h), and that part's own shape (aspect). Many logos sit in a square file
// with empty space above and below them (Jaguar, Super Aguri, NCB), which
// would otherwise shrink them for nothing. Read off the pixels; a file the
// browser will not let a page read (served from another site) counts as drawn
// edge to edge.
function drawnBox(img) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const whole = { x: 0, y: 0, w: 1, h: 1, aspect: nw / nh };
  try {
    const k = Math.min(1, 128 / Math.max(nw, nh));
    const cw = Math.max(1, Math.round(nw * k));
    const ch = Math.max(1, Math.round(nh * k));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, cw, ch);
    const px = ctx.getImageData(0, 0, cw, ch).data;
    let [x0, y0, x1, y1] = [cw, ch, -1, -1];
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (px[(y * cw + x) * 4 + 3] <= 24) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) return whole;
    const w = (x1 + 1 - x0) / cw;
    const h = (y1 + 1 - y0) / ch;
    return { x: x0 / cw, y: y0 / ch, w, h, aspect: (w * nw) / (h * nh) };
  } catch {
    return whole;
  }
}

// Where a logo goes on the disc, in shares of the disc: the drawn part is
// centred and sized until the corners of its box meet a circle 0.92 of the
// disc across, so a wide logo grows along the middle and a tall one up and
// down, never into the rim; no wider than 0.86 nor taller than 0.78 of it.
function crestPlacement(box, nw, nh) {
  let wide = Math.min(0.86, 0.92 / Math.sqrt(1 + 1 / (box.aspect * box.aspect)));
  if (wide / box.aspect > 0.78) wide = 0.78 * box.aspect;
  const imgW = wide / box.w;
  const imgH = (imgW * nh) / nw;
  const pct = (n) => `${(n * 100).toFixed(2)}%`;
  return {
    width: pct(imgW),
    height: pct(imgH),
    left: pct(0.5 - (box.x + box.w / 2) * imgW),
    top: pct(0.5 - (box.y + box.h / 2) * imgH),
  };
}

// How wide each capital of Archivo at weight 900 is, in em, measured in the
// browser. A name is cut in capitals, and these run from 0.37 (I) to 1 (W), so
// counting letters would size "WILLIAMS" and "IIIIIIII" alike.
const GLYPH_EM = new Map(
  [
    [1, "W"],
    [0.97, "M"],
    [0.89, "&"],
    [0.83, "GHKNOQU"],
    [0.78, "ABCDRVXY"],
    [0.72, "EPSTZ"],
    [0.67, "FJL0123456789+#"],
    [0.61, "?"],
    [0.56, "_"],
    [0.39, "()"],
    [0.37, "I"],
    [0.33, ".,:;!-"],
    [0.31, "/"],
    [0.28, "'"],
  ].flatMap(([em, chars]) => [...chars].map((c) => [c, em]))
);
// The name's letter-spacing, and a word space with it.
const TRACK = -0.015;
const SPACE_EM = 0.18 + TRACK;

// A name breaks only at its spaces and after a hyphen. This works out, in em,
// how wide the name is on one line (w1), and how wide the longer line is when
// it is split over two as evenly as its breaks allow (w2). The CSS cuts the
// name from these: on one line where a slightly smaller cut fits it, else on
// two, so names side by side stay close in height and a long one steps down in
// size instead of running to three or four lines. long: on a narrow phone
// even the two-line cut would be small beside the medallion (see the CSS).
function nameFit(name) {
  const pieces = [];
  String(name || "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word) => {
      const parts = word.replace(/-/g, "- ").split(" ").filter(Boolean);
      parts.forEach((part, i) =>
        pieces.push({
          // Anything not in the table counts as a wide capital.
          em: [...part].reduce((em, c) => em + (GLYPH_EM.get(c) ?? 0.83) + TRACK, 0),
          gap: i === parts.length - 1 ? SPACE_EM : 0,
        })
      );
    });
  // A line's width: its pieces and the spaces between them, not the one after.
  const width = (from, to) =>
    pieces.slice(from, to).reduce((em, p, i, line) => em + p.em + (i < line.length - 1 ? p.gap : 0), 0);
  const w1 = Math.max(1, width(0, pieces.length));
  let w2 = w1;
  for (let k = 1; k < pieces.length; k++) w2 = Math.min(w2, Math.max(width(0, k), width(k, pieces.length)));
  w2 = Math.max(1, w2);
  return { w1, w2, long: w2 > 13 };
}

// The mark for a typed winner (a pair of drivers, a whole grid): a laurel, two
// branches curving up from the bottom and open at the top. Worked out once, in
// a 40 x 40 box, as one path for the leaves and one for the stems.
const LAUREL = (() => {
  const cx = 20;
  const cy = 21;
  const R = 12;
  const r2 = (n) => Math.round(n * 100) / 100;
  const rad = (deg) => (deg * Math.PI) / 180;
  const at = (dir, theta) => [cx + dir * R * Math.sin(rad(theta)), cy + R * Math.cos(rad(theta))];
  const leaves = [];
  const leaf = ([x, y], deg, len, wide) => {
    const c = Math.cos(rad(deg));
    const s = Math.sin(rad(deg));
    const tip = [x + c * len, y + s * len];
    const mid = [x + c * len * 0.5, y + s * len * 0.5];
    const a = [mid[0] - s * wide, mid[1] + c * wide];
    const b = [mid[0] + s * wide, mid[1] - c * wide];
    leaves.push(
      `M${r2(x)} ${r2(y)}Q${r2(a[0])} ${r2(a[1])} ${r2(tip[0])} ${r2(tip[1])}Q${r2(b[0])} ${r2(b[1])} ${r2(x)} ${r2(y)}Z`
    );
  };
  const stems = [];
  for (const dir of [-1, 1]) {
    // theta: degrees up the circle from its bottom point.
    for (let i = 0; i < 6; i++) {
      const theta = 30 + i * 22;
      const k = 1 - i * 0.06;
      const p = at(dir, theta);
      // The direction the branch grows in at this point (up and round).
      const grow = (Math.atan2(-Math.sin(rad(theta)), dir * Math.cos(rad(theta))) * 180) / Math.PI;
      leaf(p, grow + dir * 42, 6 * k, 1.9 * k);
      leaf(p, grow - dir * 40, 4.6 * k, 1.5 * k);
    }
    const top = at(dir, 150);
    leaf(top, (Math.atan2(-Math.sin(rad(150)), dir * Math.cos(rad(150))) * 180) / Math.PI, 5, 1.6);
    const [x0, y0] = at(dir, 20);
    stems.push(`M${r2(x0)} ${r2(y0)}A${R} ${R} 0 0 ${dir === 1 ? 0 : 1} ${r2(top[0])} ${r2(top[1])}`);
  }
  return { leaves: leaves.join(""), stems: stems.join("") };
})();

function Laurel() {
  return (
    <svg viewBox="0 0 40 40" className="aw-plaques-mark" aria-hidden="true">
      <path d={LAUREL.stems} fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d={LAUREL.leaves} fill="currentColor" />
    </svg>
  );
}

// Photo or initials on the team colour (a driver's, or a team's that has no
// usable logo). Not DriverAvatar: that one is drawn at a fixed pixel size, and
// the medallion changes size with the screen. A photo that fails to load (a
// Discord avatar is gone once its owner changes it) falls back to the initials
// rather than leaving an empty disc.
function Portrait({ name, photoUrl, color }) {
  const [dead, setDead] = useState(null);
  const bg = color || "#64748b";
  if (photoUrl && dead !== photoUrl)
    return (
      <img
        src={sizedAvatarUrl(photoUrl, 64)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setDead(photoUrl)}
        className="aw-plaques-photo"
        style={{ backgroundColor: bg }}
      />
    );
  return (
    <span className="aw-plaques-initials" style={{ backgroundColor: bg, color: readableInkOn(bg) }}>
      {initialsOf(name)}
    </span>
  );
}

// A team under the glass: its logo on the enamel, sized by the part of the
// file that is drawn (see drawnBox), else its initials on its colour. Not
// TeamLogo itself, whose last resort is a square badge with white letters:
// square in a round medallion, and lost on a white team. A logo that fails to
// load, or turns out to be a wordmark, moves on to the next picture. The logo
// stays hidden until it is placed, so it never shows at a passing size.
function TeamCrest({ team }) {
  const [dead, setDead] = useState([]);
  const [placed, setPlaced] = useState(null);
  const src = teamPictures(team).find((s) => !dead.includes(s));
  if (!src) return <Portrait name={team.name} color={team.color} />;
  const style = placed?.src === src ? placed.style : { visibility: "hidden" };
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      onError={() => setDead((d) => [...d, src])}
      onLoad={(e) => {
        const img = e.currentTarget;
        const box = drawnBox(img);
        if (box.aspect > WORDMARK) setDead((d) => [...d, src]);
        else setPlaced({ src, style: crestPlacement(box, img.naturalWidth, img.naturalHeight) });
      }}
      className="aw-plaques-crest"
      style={style}
    />
  );
}

// The team's mark before its name under a driver: the logo while it reads at
// this size, else a dot of the team colour (TeamLogo would put a monogram
// badge here, which is a blob of white or yellow on a white or yellow team).
function TeamMark({ team }) {
  const [dead, setDead] = useState([]);
  const src = teamPictures(team).find((s) => !dead.includes(s));
  if (!src) return <span className="aw-plaques-swatch" style={{ backgroundColor: team.color || "#64748b" }} />;
  return (
    <img
      src={src}
      alt=""
      decoding="async"
      onError={() => setDead((d) => [...d, src])}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth / img.naturalHeight > WORDMARK) setDead((d) => [...d, src]);
      }}
      className="aw-plaques-sublogo"
    />
  );
}

// The round medallion set into the plate: a recess, a brass rim, and what sits
// under the glass. The flag rides on the rim as a small pin.
function Medallion({ w }) {
  // Uploaded circuit outlines arrive after the first render; this re-renders
  // the race medallion when they do.
  useTrackOutlines();
  const code = flagCode(w.flag);
  let face;
  if (w.kind === "driver") {
    face = <Portrait name={w.name} photoUrl={w.driver.photoUrl} color={w.color} />;
  } else if (w.kind === "team") {
    face = <TeamCrest team={w.team} />;
  } else if (w.kind === "race" && hasOutline(w.race.track)) {
    face = <CircuitMap track={w.race.track} className="aw-plaques-circuit" strokeWidth={1.6} />;
  } else if (w.kind === "race") {
    // No outline of this circuit: a flag mark on the enamel, and the country
    // on the pin as for any race. The flag files are 80px at most, so a flag
    // filling the disc would be blown up and soft next to the sharp brass.
    face = <FlagIcon className="aw-plaques-mark aw-plaques-mark-icon" strokeWidth={1.75} aria-hidden="true" />;
  } else {
    face = <Laurel />;
  }
  return (
    <span className="aw-plaques-medal" aria-hidden="true">
      <span className="aw-plaques-bezel">
        <span className="aw-plaques-disc">{face}</span>
      </span>
      {code && (
        <span className="aw-plaques-pin">
          <Flag code={code} w={40} h={24} />
        </span>
      )}
    </span>
  );
}

// pairSub / pairNote: whether the plate beside this one, where they hang in
// twos, has a line under its name / a note. A plate without one then keeps the
// room for it (an empty line, the rule on its own), so the two plates are cut
// alike and their lines run level instead of one of them opening a gap.
function Plaque({ award, seasonNumber, pairSub, pairNote }) {
  const w = winnerOf(award, seasonNumber);
  const fit = nameFit(w.name);
  const inner = (
    <>
      {SCREWS.map(([corner, turn]) => (
        <span
          key={corner}
          aria-hidden="true"
          className={`aw-plaques-screw aw-plaques-screw-${corner}`}
          style={{ "--aw-plaques-turn": `${turn}deg` }}
        />
      ))}
      <div className="aw-plaques-face">
        <span className="aw-plaques-frame" aria-hidden="true" />
        {/* The medallion and the lines beside it are one piece, centred on
            each other, whatever the plate next door has. */}
        <div className={`aw-plaques-head${fit.long ? " aw-plaques-long" : ""}`}>
          <Medallion w={w} />
          <div className="aw-plaques-text">
            {/* The inner spans carry the engraved fill, one shading per line. */}
            <h3 className="aw-plaques-title">
              <span>{award.title}</span>
            </h3>
            <div className="aw-plaques-who">
              <div
                className="aw-plaques-name"
                style={{
                  "--aw-plaques-w1": fit.w1.toFixed(2),
                  "--aw-plaques-w2": fit.w2.toFixed(2),
                  // Only for browsers without container units (see the CSS).
                  "--aw-plaques-fit": Math.min(1, Math.max(0.72, 10.5 / fit.w2)).toFixed(3),
                }}
              >
                <span>{w.name}</span>
              </div>
              {w.sub ? (
                <div className="aw-plaques-sub">
                  {/* The team's name follows in words; its logo is only the mark. */}
                  {w.kind === "driver" && w.team && (
                    <span className="aw-plaques-submark" aria-hidden="true">
                      <TeamMark team={w.team} />
                    </span>
                  )}
                  <span className="min-w-0">{w.sub}</span>
                </div>
              ) : (
                pairSub && (
                  <div className="aw-plaques-sub aw-plaques-blank" aria-hidden="true">
                    {" "}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
        {award.note ? (
          <p className="aw-plaques-note">{award.note}</p>
        ) : (
          // Without a note there is still an item in the note's row, which
          // carries the face's bottom margin (see .aw-plaques-face).
          <span className={pairNote ? "aw-plaques-note aw-plaques-blank" : "aw-plaques-end"} aria-hidden="true" />
        )}
        {/* The season, stamped into the frame; it repeats the heading, so
            screen readers skip it. */}
        <span className="aw-plaques-hallmark" aria-hidden="true">
          <span>Season {seasonNumber}</span>
        </span>
      </div>
    </>
  );
  return w.to ? (
    <Link to={w.to} className="aw-plaques-plate aw-plaques-plate-link">
      {inner}
    </Link>
  ) : (
    <div className="aw-plaques-plate">{inner}</div>
  );
}

export default function LookPlaques({ seasons }) {
  const [picked, setPicked] = useState(seasons[0]?.seasonNumber);
  const season = seasons.find((s) => s.seasonNumber === picked) || seasons[0];
  // After the first pick the wall fades over as a whole instead of dealing
  // its plates in again (see .swap-in in index.css).
  const swap = useSwapClass(season?.seasonNumber);
  if (!season) return null;
  const name = season.seasonName || `Season ${season.seasonNumber}`;
  const awards = season.awards;
  return (
    <section data-awards-look="plaques" className="aw-plaques reveal">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-eyebrow sm:text-[11px] sm:tracking-[0.2em]">
            {name}
          </div>
          <h2 className="mt-1 font-display text-2xl font-extrabold uppercase tracking-tight text-dark sm:text-3xl">
            Season awards
          </h2>
        </div>
        {seasons.length > 1 && (
          <SlidingTabs
            items={seasons.map((s) => ({
              key: s.seasonNumber,
              label: <span data-awards-season={s.seasonNumber}>S{s.seasonNumber}</span>,
              title: s.seasonName || `Season ${s.seasonNumber}`,
            }))}
            value={season.seasonNumber}
            onChange={setPicked}
          />
        )}
      </div>
      <div key={season.seasonNumber} className={swap}>
        {/* "dark": the plates are gunmetal on either theme, so the text cut
            into them takes the dark theme's inks, as in the WINS panel. */}
        <ul className="aw-plaques-wall dark cascade" aria-label={`Awards, ${name}`}>
          {awards.map((a, i) => {
            // The plate it hangs beside from 768px up, where they go in twos.
            const pair = awards[i % 2 ? i - 1 : i + 1];
            return (
              <li key={a.id} className="aw-plaques-slot" style={{ "--i": Math.min(i, 12) }}>
                <Plaque
                  award={a}
                  seasonNumber={season.seasonNumber}
                  pairSub={!!(pair && winnerOf(pair, season.seasonNumber).sub)}
                  pairNote={!!pair?.note}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

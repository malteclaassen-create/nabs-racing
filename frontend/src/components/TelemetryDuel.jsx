import { ArrowLeftRight } from "lucide-react";
import TeamLogo from "./TeamLogo.jsx";
import { readableInkOn } from "./ui.jsx";
import { formatLapTime } from "../utils/telemetryAnalysis.js";

// ---------------------------------------------------------------------------
// The head of the comparison, laid out the way a broadcast puts two drivers
// against each other: lap A on the left, lap B on the right, each in its
// team's colour and with its own picker, and the gap between them in the
// middle. Picking a lap happens where the lap is shown, so there is no doubt
// which dropdown changes which side.
// ---------------------------------------------------------------------------

// " · recorded 3 Sep" — which of a driver's laps this is, in a form that
// tells them apart when the times do not.
function recordedOn(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return ` · recorded ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(d)}`;
}

// `action` is a control about THIS lap — the admin's "Remove lap" today. It
// sits inside the coloured card rather than beside it so there is no doubt
// which of the two laps it acts on.
function DuelCard({ side, lap, color, picker, action, placeholder }) {
  // Flat, the way the rest of the site draws a lap: the team colour is the
  // stripe down the side and the letter's tile, nothing washed across the card.
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <span className={`absolute inset-y-0 left-0 w-1 ${lap ? "" : "opacity-40"}`} style={{ background: color }} aria-hidden="true" />
      <div className="p-3 pl-4 sm:p-4 sm:pl-5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-black" style={{ background: color, color: readableInkOn(color) }} aria-hidden="true">{side}</span>
          <div className="min-w-0 flex-1">{picker}</div>
        </div>
        {lap ? <>
          <div className="mt-3 font-display text-3xl font-bold tabular-nums text-dark sm:text-4xl">{formatLapTime(lap.lapTimeMs)}</div>
          <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-light">
            {lap.team && <TeamLogo key={lap.team.id} id={lap.team.id} name={lap.team.name} color={color} logoUrl={lap.team.logoUrl} size={20} />}
            <span className="truncate">{lap.team ? lap.team.name : String(lap.car || "Unknown car").replaceAll("_", " ")}</span>
          </div>
          <p className="mt-1 text-[11px] text-light">
            {lap.team && <span className="block truncate" title={lap.car}>{String(lap.car || "Unknown car").replaceAll("_", " ")}</span>}
            <span className="block">{Math.round(Math.max(...lap.speed))} km/h peak{recordedOn(lap.recordedAt)}</span>
          </p>
          {action && <div className="mt-2">{action}</div>}
        </> : <p className="mt-3 text-xs text-light">{placeholder}</p>}
      </div>
    </div>
  );
}

// The middle column: the finish-line gap in the quicker lap's colour, what the
// two could do together, and the swap.
function GapColumn({ lapA, lapB, colorA, colorB, idealMs, onSwap }) {
  const gap = lapA && lapB ? (lapB.lapTimeMs - lapA.lapTimeMs) / 1000 : null;
  const color = gap == null || gap === 0 ? "var(--c-text)" : gap > 0 ? colorA : colorB;
  const best = lapA && lapB ? Math.min(lapA.lapTimeMs, lapB.lapTimeMs) : null;
  return (
    <div className="flex w-full min-w-0 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 sm:w-48 sm:flex-col sm:justify-center sm:text-center">
      <div>
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-light">Finish-line gap</p>
        <p className="font-display text-3xl font-extrabold tabular-nums" style={{ color }}>{gap == null ? "—" : `${Math.abs(gap).toFixed(3)} s`}</p>
        <p className="text-xs text-light">{gap == null ? "Choose lap B to see the difference." : gap === 0 ? "Same recorded lap time" : `Lap ${gap > 0 ? "A" : "B"} is quicker`}</p>
      </div>
      {idealMs != null && best != null && idealMs < best - 1 && (
        <p className="text-[11px] text-light" title="The quicker of the two through each sector, added up">
          Best of both<br className="hidden sm:inline" /> <span className="font-mono font-semibold tabular-nums text-dark">{formatLapTime(idealMs)}</span>{" "}
          <span className="font-mono tabular-nums">(−{((best - idealMs) / 1000).toFixed(3)} s)</span>
        </p>
      )}
      {lapA && lapB && (
        <button type="button" onClick={onSwap} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-medium transition hover:bg-surface2 hover:text-dark">
          <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />Swap A / B
        </button>
      )}
    </div>
  );
}

export default function TelemetryDuel({ lapA, lapB, colorA, colorB, pickerA, pickerB, actionA, actionB, placeholderA, placeholderB, idealMs, onSwap }) {
  return (
    // One column on a phone, A over the gap over B: side by side, the pickers
    // had room for "Malte ·" and nothing of the lap time that tells a
    // driver's laps apart.
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
      <DuelCard side="A" lap={lapA} color={colorA} picker={pickerA} action={actionA} placeholder={placeholderA} />
      <div className="flex">
        <GapColumn lapA={lapA} lapB={lapB} colorA={colorA} colorB={colorB} idealMs={idealMs} onSwap={onSwap} />
      </div>
      <DuelCard side="B" lap={lapB} color={colorB} picker={pickerB} action={actionB} placeholder={placeholderB} />
    </div>
  );
}

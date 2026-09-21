import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ChevronDown,
  Coins,
  MessageSquare,
  Shield,
  SlidersHorizontal,
  TrendingUp,
  Trophy,
  TriangleAlert,
  User,
} from "lucide-react";
import { Modal } from "./overlay.jsx";
import AttentionDot from "./AttentionDot.jsx";

// ---------------------------------------------------------------------------
// The profile page's navigation: a column beside the content on desktop, and
// on phones one button that says where you are, opening a sheet.
//
// It replaces a nine-item sliding tab bar that scrolled sideways on a phone
// with four items showing — and that drew a page section, a drawer, a panel
// and a link to another page as four identical pills. Here the sections are
// the list, and the rest sits under "Elsewhere" saying what it opens. See
// pages/profileNav.mjs for the list itself.
// ---------------------------------------------------------------------------

const ICONS = {
  profile: User,
  achievements: Trophy,
  rating: TrendingUp,
  tokens: Coins,
  tools: Activity,
  settings: SlidersHorizontal,
  feedback: MessageSquare,
  reports: TriangleAlert,
  admin: Shield,
};

function Icon({ name, className = "h-[17px] w-[17px]" }) {
  const C = ICONS[name] || User;
  return <C className={`shrink-0 ${className}`} strokeWidth={2} aria-hidden="true" />;
}

const ROW = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-semibold transition";
const IDLE = "text-medium hover:bg-surface2 hover:text-dark";
// `eyebrow`/`accent`, not `brand`: the raw brand pink is a pale rose that
// fills buttons carrying dark ink. As TEXT on a white card in light mode it is
// barely there, so the active row borrows the two theme-aware tokens that
// deepen themselves (see --c-eyebrow / --c-accent in index.css).
const ON = "bg-accent/10 font-bold text-eyebrow";

// One entry, wherever it is drawn. `page` items are real links so they can be
// middle-clicked, opened in a new tab, and announced as navigation; everything
// else acts on this page and stays a button.
function NavRow({ item, active, onPick, attention, attentionSummary }) {
  const inner = (
    <>
      <Icon name={item.icon} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.key === "admin" && <AttentionDot total={attention} summary={attentionSummary} />}
      {item.count != null && (
        <span className="font-mono text-xs font-bold tabular-nums text-light">{item.count}</span>
      )}
      {/* An arrow only where one is earned: these two really do leave. */}
      {item.kind === "page" && <span aria-hidden="true" className="text-xs text-faint">↗</span>}
    </>
  );
  const className = `${ROW} ${active ? ON : IDLE}`;

  if (item.kind === "page") {
    return (
      <Link to={item.to} className={className} onClick={onPick}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      data-tour={item.dataTour}
      onClick={() => onPick(item.key)}
      // Only a section is somewhere you ARE. The drawer and the panel are
      // things you open, and saying "current" about them would be a lie to
      // anyone listening rather than looking.
      aria-current={item.kind === "section" && active ? "page" : undefined}
      className={className}
    >
      {inner}
    </button>
  );
}

function Group({ items, value, onPick, attention, attentionSummary }) {
  return items.map((item) => (
    <NavRow
      key={item.key}
      item={item}
      active={item.key === value}
      onPick={onPick}
      attention={attention}
      attentionSummary={attentionSummary}
    />
  ));
}

const ELSEWHERE_LABEL = "font-mono text-[10.5px] font-bold uppercase tracking-[0.16em] text-light";

export default function ProfileNav({ nav, value, onSelect, attention = 0, attentionSummary = "" }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const here = nav.sections.find((s) => s.key === value);

  // The sheet closes on any choice — including a link, which is leaving anyway.
  const pick = (key) => {
    setSheetOpen(false);
    if (key) onSelect(key);
  };

  const groups = (onPick) => (
    <>
      <Group items={nav.sections} value={value} onPick={onPick} />
      <div className={`${ELSEWHERE_LABEL} px-3 pb-1 pt-4`} id="profile-nav-elsewhere">
        Elsewhere
      </div>
      <div role="group" aria-labelledby="profile-nav-elsewhere">
        <Group items={nav.elsewhere} value={value} onPick={onPick} attention={attention} attentionSummary={attentionSummary} />
      </div>
    </>
  );

  return (
    <>
      {/* Phones: where you are, and a way to go elsewhere. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        className="transition flex w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left font-bold text-dark hover:border-accent/60 lg:hidden"
      >
        <Icon name={here?.icon || "profile"} className="h-[18px] w-[18px] text-eyebrow" />
        <span className="min-w-0 flex-1 truncate">{here?.label || "Sections"}</span>
        {attention > 0 && <AttentionDot total={attention} summary={attentionSummary} />}
        <ChevronDown className="h-4 w-4 shrink-0 text-light" aria-hidden="true" />
      </button>

      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="My Profile" variant="sheet" closeLabel="Close sections">
        <nav aria-label="Profile sections" className="-mx-1 py-1">
          {groups(pick)}
        </nav>
      </Modal>

      {/* Desktop: the same list, open. Sticky clears the 80px nav bar, the way
          the races rail does. */}
      <nav
        aria-label="Profile sections"
        className="hidden lg:sticky lg:top-28 lg:block lg:w-[236px] lg:flex-none lg:self-start"
      >
        {groups(onSelect)}
      </nav>
    </>
  );
}

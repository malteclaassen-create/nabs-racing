// The footnotes under a standings table, shared by the driver standings board
// (DriverStandingsBoard.jsx) and the constructors table, plus the two small
// rules both of them read: which rounds pay by their own points table, and
// which driver totals were set by hand.

// A round paying by its own points table, or null.
export function customTableOf(customPoints, n) {
  return Array.isArray(customPoints?.[n]) && customPoints[n].length ? customPoints[n] : null;
}

// Hand-set points: only the driver table can carry them (a season figure
// cannot be traced to the round a team scored it in).
export function manualOfRow(isDriver, manualPoints, row) {
  return isDriver && manualPoints && (row.pointsAdjust || row.pointsOverride != null)
    ? { adjust: row.pointsAdjust || 0, override: row.pointsOverride ?? null }
    : null;
}

// The footnotes under a standings table: which drop rule is in force, sprint
// weekends, the fastest-lap bonus, own points tables, official totals. Its own
// component so the constructors page's table carries exactly the same notes.
// `className` replaces the default top rule and padding.
export function StandingsNotes({ variant, raceNumbers, rows = [], dropWorst = 3, officialTotals = false, dropMode = "driver", teamDropWorst = null, sprintRounds = [], fastestLapPoints = 0, customPoints = {}, championOverride = null, manualPoints = false, className = "border-t border-border px-4 py-2.5" }) {
  const isDriver = variant === "driver";
  const sprintSet = new Set(sprintRounds || []);
  const showSprintNote = raceNumbers.some((n) => sprintSet.has(n));
  const showFlNote = fastestLapPoints > 0 && raceNumbers.length > 0;
  const customOf = (n) => customTableOf(customPoints, n);
  const customRounds = raceNumbers.filter((n) => customOf(n));
  const showCustomNote = customRounds.length > 0;
  const tableText = (t) => (t.length > 6 ? `${t.slice(0, 6).join(", ")}, …` : t.join(", "));
  const showChampionNote = isDriver && !!championOverride;
  const showManualNote = isDriver && manualPoints && rows.some((r) => manualOfRow(isDriver, manualPoints, r));
  // Constructor tables can use a team-level drop rule instead of inheriting
  // each driver's dropped rounds — the footnote must match whichever is in
  // force: "team" counts single-driver round scores, "teamRounds" counts whole
  // team rounds (the official sheet's style).
  const teamDrop = !isDriver && (dropMode === "team" || dropMode === "teamRounds");
  const showDropNote = isDriver
    ? dropWorst > 0 && raceNumbers.length > 0
    : teamDrop
      ? teamDropWorst > 0 && raceNumbers.length > 0
      : dropWorst > 0 && raceNumbers.length > 0;
  // Archive seasons: totals are the league's official final sheet, while the
  // round columns are reconstructed from the era's result posts — the two can
  // legitimately differ (penalties, bonus points, gaps in the old data).
  const showOfficialNote = officialTotals && raceNumbers.length > 0;
  if (!(showOfficialNote || showDropNote || showSprintNote || showFlNote || showCustomNote || showChampionNote || showManualNote)) return null;
  return (
    <div className={`space-y-1 font-mono text-[11px] leading-relaxed text-light ${className}`}>
      {showChampionNote && (
        <p>
          <span className="font-bold uppercase text-medium">Champion by the league&rsquo;s rule.</span> {championOverride.name} is
          champion without the most points: the title was decided by the league&rsquo;s own rule for that season, and the
          table shows the season that way.
        </p>
      )}
      {showManualNote && (
        <p>
          <span className="font-bold text-warn">M</span> marks points the league set by hand: a bonus the results
          cannot show on their own, a deduction, or a total taken straight from the league&rsquo;s own sheet. The round
          columns stay as they were scored, so they may not add up to the total.
        </p>
      )}
      {showCustomNote && (
        <p>
          <span className="font-bold text-warn">*</span> marks a round with its own points table:{" "}
          {customRounds.map((n, i) => (
            <span key={n}>
              {i > 0 && "; "}R{n}: {tableText(customOf(n))}
            </span>
          ))}
          {" "}(P1, P2, …).
        </p>
      )}
      {showFlNote && (
        <p>
          {isDriver ? (
            <>
              <span className="font-bold text-fl">FL</span> marks a fastest-lap bonus: the driver who sets the fastest
              race lap scores +{fastestLapPoints} on top of their finish, if they finish the race.
            </>
          ) : (
            <>
              The fastest race lap pays +{fastestLapPoints} to its driver (if they finish), and that point counts
              for the team they drove for.
            </>
          )}
        </p>
      )}
      {showSprintNote && (
        <p>
          <span className="font-bold text-brand">S</span> marks a sprint weekend: the feature race and the sprint both
          score the full points table, added together under that round
          {isDriver && <> (hover a cell for the two halves)</>}.
        </p>
      )}
      {showDropNote && (
        <p>
          {isDriver ? (
            <>
              <span className="text-faint line-through decoration-2">Struck-through</span> rounds are dropped: each
              driver&rsquo;s {dropWorst} lowest-scoring round{dropWorst === 1 ? " doesn't" : "s don't"} count toward the
              total{raceNumbers.length > dropWorst && <> (best {raceNumbers.length - dropWorst} of {raceNumbers.length})</>}.
            </>
          ) : dropMode === "teamRounds" ? (
            <>
              <span className="text-faint line-through decoration-2">Struck-through</span> rounds are dropped: each
              team&rsquo;s {teamDropWorst} lowest round total{teamDropWorst === 1 ? " doesn't" : "s don't"} count toward the
              team total; rounds not yet run count as 0 and are dropped first
              {raceNumbers.length > teamDropWorst && <> (best {raceNumbers.length - teamDropWorst} of {raceNumbers.length})</>}.
            </>
          ) : teamDrop ? (
            <>
              <span className="text-faint line-through decoration-2">Struck-through</span> points are dropped: each
              team&rsquo;s {teamDropWorst} lowest single-driver round score{teamDropWorst === 1 ? " doesn't" : "s don't"} count
              toward the team total, so a round can count partially (the teammate&rsquo;s share still scores).
            </>
          ) : (
            <>
              <span className="text-faint line-through decoration-2">Struck-through</span> points are dropped: each
              driver&rsquo;s {dropWorst} lowest-scoring round{dropWorst === 1 ? " doesn't" : "s don't"} count for the team
              they drove for that round, so a round can count partially (the teammate&rsquo;s share still scores).
            </>
          )}
        </p>
      )}
      {showOfficialNote && (
        <p>
          <span className="font-bold uppercase text-medium">Pts = official final standings.</span> The round columns
          are reconstructed from the era&rsquo;s result posts. Penalties, bonus points and gaps in the old records
          mean they may not add up to the official totals exactly.
        </p>
      )}
    </div>
  );
}

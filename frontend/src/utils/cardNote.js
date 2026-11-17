// One line saying where the numbers on a driver card come from. A card is
// reprinted three times a season: at the start (end of last season), at
// half-time and at full-time. `card` is the `card` block the API sends.
export function cardNote(card) {
  if (!card) return null;
  if (card.source === "mid-season")
    return `Half-time update after Round ${card.asOfRound} · next update at the end of the season`;
  if (card.source === "season-end") return `Final Season ${card.seasonNumber} card · carried into next season`;
  if (card.locked && card.fromSeasonNumber != null)
    return `Earned by the end of Season ${card.fromSeasonNumber} · next update at half-time`;
  if (card.source === "live") return "First season on a card · this one moves with every round until the next update";
  return null;
}

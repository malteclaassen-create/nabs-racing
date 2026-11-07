// The Season awards looks under consideration, picked with ?look=<key> on the
// Hall of Fame page. Preview only: the chosen one replaces the section and the
// rest go.
import LookGala from "./LookGala.jsx";
import LookCards from "./LookCards.jsx";
import LookMedals from "./LookMedals.jsx";
import LookCeremony from "./LookCeremony.jsx";
import LookPlaques from "./LookPlaques.jsx";

export const AWARD_LOOKS = {
  gala: LookGala,
  cards: LookCards,
  medals: LookMedals,
  ceremony: LookCeremony,
  plaques: LookPlaques,
};

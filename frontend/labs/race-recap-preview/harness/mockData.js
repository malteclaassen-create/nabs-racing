// Which payload the preview shows: a REAL round, built from the live site's
// public API by mock/build-real.mjs (Season 8, Round 9, Singapore, from
// Maltegoat's seat). The generated mock rounds (mock/recap*.js) are no longer
// wired in.
import * as real from "../mock/real-recap.js";
import { publicTokens } from "./publicTokens.js";

export const activeMock = real;
// The token ledger is private (`points: null` in the real payload): the
// Rewards chapter shows what the league's public token rules pay for this
// result, with a sample balance that the card labels as such (publicTokens.js).
// Shown as on race night, when a recap is first handed over: the stewards have
// not looked at the reports yet, so the clean-race bonus is still pending.
const RACE_NIGHT = new Date(real.recap.race.date).getTime() + 3 * 3600 * 1000;
export const recap = real.recap.points ? real.recap : { ...real.recap, points: publicTokens(real.recap, RACE_NIGHT) };
export const laps = real.laps;

// GET /api/series, as the live site answered it.
export const SERIES = real.SERIES;

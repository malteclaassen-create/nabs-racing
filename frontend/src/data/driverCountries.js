// Nationality (flag) for each driver, by driver id (see backend/prisma/seed.js).
// ISO 3166-1 alpha-2 country codes. Confirmed against the Discord #teams roster.
// "" = no flag shown.
//
// Drivers can also set their own country when signing up (Discord login →
// country picker). That self-selected value lives in the DB and takes priority;
// this map is the baseline/fallback. See `countryFor(driverId, dbCountry)`.

export const DRIVER_COUNTRY = {
  // --- Tier 1 ---
  "13bot": "gb", // 13bot (Not a Bot)
  mtimmis: "gb", // Timmy 'Bunker' Gilmore
  siggsta: "gb", // Siggidy
  jomilan: "it", // JoMilan
  takoda: "nl", // Tafourthda
  steve: "nl", // Steven P8. Cheese
  maltegoat: "de", // Maltegoat
  pizd: "gb", // Pizd
  rayman: "nl", // Rayman
  rashford: "pl", // Marcus Rashford

  // --- Tier 2 ---
  vibe_officer: "fi", // VIBE_OFFICER
  j_yamanaka: "jp", // J. Yamanaka (山中)
  hedimak: "tn", // [FWE]hedimakk
  jacob_ordonez: "ph", // Jacob Ordoñez
  goldginger: "id", // GoldGinger
  jadend: "gb", // Jaden D-Ankrah
  jp_bekker: "za", // JP Bekker
  aleks: "al", // aleks
  dras: "in", // DRAS
  justyn: "fi", // Justyn
  kowandoh_badu: "gb", // Kowandoh Badu
  aliveaxe: "rs", // aliveaxe
  nottyler: "ie", // NotTyler
  zero0n1k: "cz", // ZerOn1k
  vhp: "bg", // VugPuh
  flo: "de", // Flo
  laluch: "cz", // Laluch
  endriu: "pl", // Endriu
  tischler: "de", // Tischler
  manro45gt: "es", // Menry | Duck Drivers
  naigouu: "fi", // Naigouu
  kalervo: "fi", // Kalervo77
  neesh: "ca", // Neesh
  duck: "se", // Duck
};

// A driver's own DB country (self-selected at sign-up) wins; otherwise fall back
// to the roster baseline above. Archive driver ids carry a season prefix
// ("s4_takoda" is Season 4's takoda), so a miss retries with the prefix
// stripped — the same person shows the same flag in every season.
export function countryFor(driverId, dbCountry) {
  if (dbCountry) return dbCountry;
  const id = String(driverId || "");
  return DRIVER_COUNTRY[id] || DRIVER_COUNTRY[id.replace(/^s\d+_/, "")] || "";
}

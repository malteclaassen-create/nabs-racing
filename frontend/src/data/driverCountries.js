// Nationality (flag) for each driver, by driver id (see backend/prisma/seed.js).
// ISO 3166-1 alpha-2 country codes. Read from the Discord #teams roster.
// "" = no flag shown.

export const DRIVER_COUNTRY = {
  // --- Tier 1 ---
  "13bot": "gb", // 13bot (Not a Bot)
  mtimmis: "gb", // Timmy 'Bunker' Gilmore
  siggsta: "gb", // Siggidy
  jomilan: "it", // JoMilan
  takoda: "hu", // Tafourthda
  steve: "hu", // Steven P6. Cheese
  maltegoat: "de", // Maltegoat
  pizd: "gb", // Pizd
  rayman: "pl", // Rayman
  rashford: "pl", // Marcus Rashford

  // --- Tier 2 ---
  vibe_officer: "fi", // VIBE_OFFICER
  j_yamanaka: "jp", // J. Yamanaka (山中)
  hedimak: "tr", // [FWE]hedimakk
  jacob_ordonez: "es", // Jacob Ordoñez
  goldginger: "de", // GoldGinger
  jadend: "gb", // Jaden D-Ankrah
  jp_bekker: "za", // JP Bekker
  aleks: "ma", // aleks
  dras: "in", // DRAS
  justyn: "fi", // Justyn
  kowandoh_badu: "gb", // Kowandoh Badu
  aliveaxe: "id", // aliveaxe  (red/white — Indonesia, please verify)
  nottyler: "ie", // NotTyler
  zero0n1k: "ar", // ZerOn1k
  vhp: "bg", // VugPuh
  flo: "de", // Flo
  laluch: "cz", // Laluch
  endriu: "cz", // Endriu
  tischler: "de", // Tischler
  manro45gt: "es", // Menry | Duck Drivers
  naigouu: "fi", // Naigouu
  kalervo: "fi", // Kalervo77
  neesh: "id", // Neesh  (red/white — Indonesia, please verify)
  duck: "se", // Duck
};

export function countryFor(driverId) {
  return DRIVER_COUNTRY[driverId] || "";
}

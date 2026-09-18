// ---------------------------------------------------------------------------
// The card designs you can BUY with tokens, as opposed to the ones you earn.
//
// Four collector series, drawn in the frontend (components/collectible*.css);
// this file is the league's side of them: what they are called, what they cost,
// and who owns which. A fifth series exists in the frontend catalogue,
// "Heritage", and is deliberately NOT here — it is not for sale.
//
// The line between this file and lib/cardEditions.js is the whole point:
//
//   cardEditions.js  designs you EARN. Starts, wins, poles, a title. They
//                    cannot be bought, and nothing here can unlock one.
//   cardShop.js      designs you BUY. They are never handed out by results, and
//                    they never make an earned one cheaper to get.
//
// A bought design is unlocked the moment it is paid for — no admin step, unlike
// every other thing in the token shop, because this is the one thing the site
// can hand over by itself. Ownership IS the purchase row in TokenRedemption
// (itemKey = the edition key), so it survives a season change, a driver row
// being rebuilt, and the trial being switched off and on again.
// ---------------------------------------------------------------------------

// Priced per series rather than per design: within a series the work is the
// same, and a price list with nineteen different numbers on it is a price list
// nobody reads. The league can still overrule a single design with `cost`.
export const CARD_COLLECTIONS = [
  {
    key: "concepts",
    name: "Concepts",
    cost: 900,
    blurb: "Full-bleed material surfaces. The loudest of the four.",
  },
  {
    key: "spectrum",
    name: "Spectrum",
    cost: 700,
    blurb: "Nine finishes of the same card, from liquid holo to plain void.",
  },
  {
    key: "velocity",
    name: "Velocity",
    cost: 800,
    blurb: "Hard diagonal colour, built around the number.",
  },
  {
    key: "signature",
    name: "Signature",
    cost: 1400,
    blurb: "Gold, platinum and amethyst on black. The quiet expensive ones.",
  },
];

// The designs themselves. Keys and names match the frontend catalogue
// (components/collectibleEditions.js) exactly — that file paints them, this one
// sells them, and a key that exists in only one of the two is a design nobody
// can either see or buy. The test keeps the two lists honest.
export const CARD_DESIGNS = [
  { key: "concept-liquid", name: "Liquid Chrome", collection: "concepts", serial: "01" },
  { key: "concept-race", name: "Race Cut", collection: "concepts", serial: "02" },
  { key: "concept-blue", name: "Studio Blue", collection: "concepts", serial: "03" },
  { key: "concept-pearl", name: "Black Pearl", collection: "concepts", serial: "04" },

  { key: "spectrum-holo", name: "Liquid Holo", collection: "spectrum", serial: "01" },
  { key: "spectrum-carbon", name: "Carbon Ember", collection: "spectrum", serial: "02" },
  { key: "spectrum-prisma", name: "Prisma Nova", collection: "spectrum", serial: "03" },
  { key: "spectrum-aurora", name: "Aurora", collection: "spectrum", serial: "04" },
  { key: "spectrum-solar", name: "Solar Flare", collection: "spectrum", serial: "05" },
  { key: "spectrum-glacier", name: "Glacier", collection: "spectrum", serial: "06" },
  { key: "spectrum-void", name: "Void", collection: "spectrum", serial: "07" },
  { key: "spectrum-rose", name: "Rose Chrome", collection: "spectrum", serial: "08" },
  { key: "spectrum-circuit", name: "Circuit", collection: "spectrum", serial: "09" },

  { key: "velocity-scarlet", name: "Scarlet", collection: "velocity", serial: "01" },
  { key: "velocity-electric", name: "Electric", collection: "velocity", serial: "02" },
  { key: "velocity-arctic", name: "Arctic", collection: "velocity", serial: "03" },

  { key: "signature-gold", name: "Gold", collection: "signature", serial: "01" },
  { key: "signature-platinum", name: "Platinum", collection: "signature", serial: "02" },
  { key: "signature-amethyst", name: "Amethyst", collection: "signature", serial: "03" },
];

const COLLECTION_BY_KEY = new Map(CARD_COLLECTIONS.map((c) => [c.key, c]));
export const CARD_DESIGN_BY_KEY = new Map(CARD_DESIGNS.map((d) => [d.key, d]));
export const CARD_DESIGN_KEYS = CARD_DESIGNS.map((d) => d.key);

export function isBuyableDesign(key) {
  return CARD_DESIGN_BY_KEY.has(String(key || ""));
}

// What one design costs: its own price if it has been given one, otherwise its
// series' price.
export function priceOf(key, cardOverrides = {}) {
  const design = CARD_DESIGN_BY_KEY.get(String(key || ""));
  if (!design) return null;
  return (
    design.cost ?? cardOverrides?.[design.collection]?.cost ?? COLLECTION_BY_KEY.get(design.collection)?.cost ?? null
  );
}

// The catalogue as the shop window draws it: the four series, each with its
// designs, prices and a mark against the ones this member already owns.
export function catalogueFor(owned = new Set(), cardOverrides = {}) {
  return CARD_COLLECTIONS.map((c) => ({
    ...c,
    cost: cardOverrides?.[c.key]?.cost ?? c.cost,
    designs: CARD_DESIGNS.filter((d) => d.collection === c.key).map((d) => ({
      ...d,
      cost: priceOf(d.key, cardOverrides),
      owned: owned.has(d.key),
    })),
  }));
}

// Which bought designs this member holds. A purchase row that an admin has
// declined (a refund) stops counting, which is the only way one is ever lost.
export async function ownedDesigns(prisma, discordId) {
  if (!discordId) return new Set();
  try {
    const ph = CARD_DESIGN_KEYS.map(() => "?").join(",");
    const rows = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT "itemKey" FROM "TokenRedemption"
        WHERE "discordId" = ? AND "status" <> 'DECLINED' AND "itemKey" IN (${ph})`,
      discordId,
      ...CARD_DESIGN_KEYS
    );
    return new Set(rows.map((r) => r.itemKey));
  } catch {
    // No table yet (a database from before the trial): nobody owns anything,
    // which is the right answer and never an error the member should see.
    return new Set();
  }
}

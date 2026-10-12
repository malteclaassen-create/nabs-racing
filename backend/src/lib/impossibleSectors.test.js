import { describe, it, expect } from "vitest";
import { dropImpossibleSectors, impossibleSector } from "./impossibleSectors.js";

const box = (ms) => (ms == null ? null : { ms, best: false, driversBest: false, cuts: 0 });
const entry = (name, lap, best) => ({ name, sectors: lap.map(box), bestSectors: best.map(box), potentialMs: best.reduce((a, b) => a + b, 0) });

// Silverstone, practice on 12 October 2026: the board as the server sent it.
const silverstone = () => [
  entry("mtimmis", [24368, 38791, 25582], [24316, 38791, 25582]),
  entry("Maltegoat", [24393, 39042, 25695], [24393, 38660, 25695]),
  entry("Takoda", [24534, 39014, 25700], [24534, 38962, 25700]),
  entry("STEFFAN", [24615, 38960, 25947], [24606, 38960, 22789]),
  entry("Rashford", [24637, 38974, 25934], [24637, 38876, 25934]),
];

describe("impossible best sectors", () => {
  it("takes out a sector seconds quicker than anyone, his own best lap included", () => {
    const board = silverstone();
    const dropped = dropImpossibleSectors(board);
    const steffan = board[3];
    expect(dropped[2].has(22789)).toBe(true);
    expect(steffan.bestSectors[2].ms).toBe(25947);
    expect(steffan.droppedSectors).toEqual([null, null, 22789]);
    expect(steffan.potentialMs).toBe(24606 + 38960 + 25947);
    // Nobody else loses anything.
    for (const e of [board[0], board[1], board[2], board[4]]) expect(e.droppedSectors).toBeUndefined();
  });

  it("keeps a genuinely quick best sector", () => {
    // 0.6 s under the next driver, but only 1.5% under their own best lap.
    expect(impossibleSector(25000, 25380, 25600)).toBe(false);
    // Well under their own best lap (a messy sector on it), close to the field.
    expect(impossibleSector(25500, 27200, 25600)).toBe(false);
  });

  it("decides on the own lap alone when nobody else has the sector", () => {
    expect(impossibleSector(22789, 25947, null)).toBe(true);
    expect(impossibleSector(25200, 25947, null)).toBe(false);
  });
});

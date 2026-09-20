import { describe, it, expect } from "vitest";
import { resolveIdentityOverrides } from "./persons.js";
import { cardPictureFor } from "./cardPhoto.js";

// One person, two leagues: the Friday row (season 8) carries a card picture,
// the Sunday row (season 6) carries nothing. Linking them in the admin area is
// supposed to give both rows the same face.
const FRIDAY = {
  personId: "p1",
  driverId: "friday",
  seasonNumber: 8,
  seriesId: "f",
  photoUrl: null,
  discordAvatar: null,
  cardPhotoUrl: "/api/uploads/cards/friday.jpg",
  cardPhotoPos: '{"x":40,"y":30,"z":1.2}',
  country: "CZ",
};
const SUNDAY = {
  personId: "p1",
  driverId: "sunday",
  seasonNumber: 6,
  seriesId: "s",
  photoUrl: null,
  discordAvatar: null,
  cardPhotoUrl: null,
  cardPhotoPos: null,
  country: null,
};

describe("resolveIdentityOverrides: the card picture travels with the person", () => {
  it("lends the newest row's card picture (and its framing) to the other league", () => {
    const out = resolveIdentityOverrides([FRIDAY, SUNDAY]);
    expect(out.get("sunday").cardPhotoUrl).toBe("/api/uploads/cards/friday.jpg");
    expect(out.get("sunday").cardPhotoPos).toBe('{"x":40,"y":30,"z":1.2}');
    expect(out.get("sunday").country).toBe("CZ");
  });

  it("finds a card picture even when nobody set a profile photo", () => {
    // The old resolution only looked at photoUrl/discordAvatar, so a person
    // who only ever dressed their card had no identity at all.
    const out = resolveIdentityOverrides([FRIDAY, SUNDAY]);
    expect(out.get("sunday").photoUrl).toBeNull();
    expect(out.get("sunday").cardPhotoUrl).toBeTruthy();
  });

  it("a pre-season draft row never shadows the active row's card picture", () => {
    const draft = { ...SUNDAY, driverId: "draft", seasonNumber: 9, seriesId: "f", cardPhotoUrl: "/cards/draft.jpg", draft: true };
    const out = resolveIdentityOverrides([{ ...FRIDAY, draft: false }, draft, { ...SUNDAY, draft: false }]);
    expect(out.get("sunday").cardPhotoUrl).toBe("/api/uploads/cards/friday.jpg");
  });

  it("an unlinked person (one row) gets no override", () => {
    expect(resolveIdentityOverrides([FRIDAY]).size).toBe(0);
  });
});

describe("cardPictureFor", () => {
  const idov = { photoUrl: "/avatars/p.jpg", photoPos: '{"x":10,"y":10,"z":1}', cardPhotoUrl: "/cards/p.jpg", cardPhotoPos: '{"x":40,"y":30,"z":1.2}' };

  it("borrows the person's card picture when the row has none of its own", () => {
    const got = cardPictureFor({ cardPhotoUrl: null, photoUrl: null, photoPos: null }, idov);
    expect(got.cardPhotoUrl).toBe("/cards/p.jpg");
    expect(got.photoPos).toEqual({ x: 40, y: 30, z: 1.2, s: 1, t: 0 });
  });

  it("a row's own card picture always wins, with its own framing", () => {
    const own = { x: 50, y: 50, z: 1, s: 1, t: 0 };
    const got = cardPictureFor({ cardPhotoUrl: "/cards/own.jpg", photoUrl: null, photoPos: own }, idov);
    expect(got).toEqual({ cardPhotoUrl: "/cards/own.jpg", photoPos: own });
  });

  it("a row with its own avatar keeps it: the card is not overruled by the person's", () => {
    const got = cardPictureFor({ cardPhotoUrl: null, photoUrl: "/avatars/own.jpg", photoPos: null }, idov);
    expect(got).toEqual({ cardPhotoUrl: null, photoPos: null });
  });

  it("falls back to the person's avatar when they have no card picture", () => {
    const got = cardPictureFor({ cardPhotoUrl: null, photoUrl: null, photoPos: null }, { ...idov, cardPhotoUrl: null });
    expect(got.cardPhotoUrl).toBeNull();
    expect(got.photoPos).toEqual({ x: 10, y: 10, z: 1, s: 1, t: 0 });
  });

  it("an unlinked row is left exactly as it is", () => {
    expect(cardPictureFor({ cardPhotoUrl: null, photoUrl: null, photoPos: null }, undefined)).toEqual({
      cardPhotoUrl: null,
      photoPos: null,
    });
  });
});

import { describe, it, expect } from "vitest";
import { resolveIdentityOverrides } from "./persons.js";
import { cardPictureFor, personPhotoFor } from "./cardPhoto.js";

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

  it("a row's own uploaded photo keeps the card: the person's does not overrule it", () => {
    const got = cardPictureFor({ cardPhotoUrl: null, photoUrl: "/uploads/own.jpg", photoPos: null }, idov);
    expect(got).toEqual({ cardPhotoUrl: "/uploads/own.jpg", photoPos: null });
  });

  it("falls back to the person's photo when they have no card picture", () => {
    const got = cardPictureFor({ cardPhotoUrl: null, photoUrl: null, photoPos: null }, { ...idov, cardPhotoUrl: null });
    expect(got.cardPhotoUrl).toBe("/avatars/p.jpg");
    expect(got.photoPos).toEqual({ x: 10, y: 10, z: 1, s: 1, t: 0 });
  });

  it("an unlinked row is left exactly as it is", () => {
    expect(cardPictureFor({ cardPhotoUrl: null, photoUrl: null, photoPos: null }, undefined)).toEqual({
      cardPhotoUrl: null,
      photoPos: null,
    });
  });
});

// The case this was reported for. Samuel Foniok races in both leagues and the
// admin had linked the rows, yet the Sunday card showed the bare letter of his
// name while the Friday card showed a picture. Neither row ever had an upload:
// both carried a DISCORD AVATAR, and the Sunday one was captured at an older
// login, so its URL had died when he changed his Discord picture.
describe("a stale Discord avatar never beats the person's live one", () => {
  const sunday = { cardPhotoUrl: null, photoUrl: null, discordAvatar: "https://cdn.discordapp.com/avatars/1/dead.png", photoPos: null };
  const idov = { photoUrl: null, photoPos: null, avatarUrl: "https://cdn.discordapp.com/avatars/1/live.png", avatarPos: null, cardPhotoUrl: null, cardPhotoPos: null };

  it("shows the person's newest avatar on the profile picture", () => {
    expect(personPhotoFor(sunday, idov)).toBe("https://cdn.discordapp.com/avatars/1/live.png");
  });

  it("shows it on the rating card too, instead of falling to the letter", () => {
    expect(cardPictureFor(sunday, idov).cardPhotoUrl).toBe("https://cdn.discordapp.com/avatars/1/live.png");
  });

  it("but an UPLOADED picture on the row still wins — that one was chosen", () => {
    const own = { ...sunday, photoUrl: "/api/uploads/avatars/own.jpg" };
    expect(personPhotoFor(own, idov)).toBe("/api/uploads/avatars/own.jpg");
    expect(cardPictureFor(own, idov).cardPhotoUrl).toBe("/api/uploads/avatars/own.jpg");
  });

  it("and the person's UPLOAD beats both avatars", () => {
    const withUpload = { ...idov, photoUrl: "/api/uploads/avatars/person.jpg" };
    expect(personPhotoFor(sunday, withUpload)).toBe("/api/uploads/avatars/person.jpg");
  });

  it("an unlinked row keeps its own avatar, dead or not — there is nothing else", () => {
    expect(personPhotoFor(sunday, undefined)).toBe("https://cdn.discordapp.com/avatars/1/dead.png");
  });

  it("the card picture still outranks every avatar", () => {
    const withCard = { ...idov, cardPhotoUrl: "/api/uploads/cards/person.jpg" };
    expect(cardPictureFor(sunday, withCard).cardPhotoUrl).toBe("/api/uploads/cards/person.jpg");
    // ...but never on the round profile avatar, which is not a card.
    expect(personPhotoFor(sunday, withCard)).toBe("https://cdn.discordapp.com/avatars/1/live.png");
  });
});

// resolveIdentityOverrides must hand those two apart in the first place.
describe("resolveIdentityOverrides keeps uploads and avatars apart", () => {
  it("reports the newest avatar separately from the newest upload", () => {
    const rows = [
      { personId: "p", driverId: "new", seasonNumber: 8, photoUrl: null, discordAvatar: "/live.png", cardPhotoUrl: null, cardPhotoPos: null, country: null },
      { personId: "p", driverId: "old", seasonNumber: 6, photoUrl: null, discordAvatar: "/dead.png", cardPhotoUrl: null, cardPhotoPos: null, country: null },
    ];
    const out = resolveIdentityOverrides(rows);
    expect(out.get("old").avatarUrl).toBe("/live.png");
    expect(out.get("old").photoUrl).toBeNull();
  });

  it("an upload on an older row still counts as the person's photo", () => {
    const rows = [
      { personId: "p", driverId: "new", seasonNumber: 8, photoUrl: null, discordAvatar: "/live.png", cardPhotoUrl: null, cardPhotoPos: null, country: null },
      { personId: "p", driverId: "old", seasonNumber: 6, photoUrl: "/uploads/old.jpg", discordAvatar: null, cardPhotoUrl: null, cardPhotoPos: null, country: null },
    ];
    const out = resolveIdentityOverrides(rows);
    expect(out.get("new").photoUrl).toBe("/uploads/old.jpg");
    expect(out.get("new").avatarUrl).toBe("/live.png");
  });
});

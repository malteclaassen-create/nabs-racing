import { describe, it, expect } from "vitest";
import { resolveIdentityOverrides } from "./persons.js";
import { cardPictureFor, personPhotoFor, pictureChainFor, photoFallbacksFor } from "./cardPhoto.js";

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
  const idov = {
    photoUrl: "/avatars/p.jpg",
    photoPos: '{"x":10,"y":10,"z":1}',
    cardPhotoUrl: "/cards/p.jpg",
    cardPhotoPos: '{"x":40,"y":30,"z":1.2}',
  };

  it("borrows the person's card picture when the row has none of its own", () => {
    const got = cardPictureFor({ cardPhotoUrl: null, photoUrl: null, photoPos: null }, idov);
    expect(got.cardPhotoUrl).toBe("/cards/p.jpg");
    // The FRAMING is not borrowed with it: this row has none of its own, so it
    // gets the default one rather than the crop of another season's card.
    expect(got.photoPos).toBeNull();
  });

  it("a row's own card picture always wins, with its own framing", () => {
    const own = { x: 50, y: 50, z: 1, s: 1, t: 0 };
    const got = cardPictureFor({ cardPhotoUrl: "/cards/own.jpg", photoUrl: null, photoPos: own }, idov);
    expect(got).toEqual({ cardPhotoUrl: "/cards/own.jpg", photoPos: own });
  });

  it("a row's own profile photo does NOT hold the current card's picture off", () => {
    // A profile photo is not a card choice — it is only what a card falls
    // back to. The picture set on the person's card still wins here.
    const got = cardPictureFor({ cardPhotoUrl: null, photoUrl: "/uploads/own.jpg", photoPos: null }, idov);
    expect(got.cardPhotoUrl).toBe("/cards/p.jpg");
  });

  it("...but it does win once nobody has a card picture anywhere", () => {
    const got = cardPictureFor(
      { cardPhotoUrl: null, photoUrl: "/uploads/own.jpg", photoPos: null },
      { ...idov, cardPhotoUrl: null }
    );
    expect(got.cardPhotoUrl).toBe("/uploads/own.jpg");
  });

  it("falls back to the person's photo when they have no card picture", () => {
    const got = cardPictureFor(
      { cardPhotoUrl: null, photoUrl: null, photoPos: null },
      { ...idov, cardPhotoUrl: null }
    );
    expect(got.cardPhotoUrl).toBe("/avatars/p.jpg");
  });

  it("an unlinked row is left exactly as it is", () => {
    expect(cardPictureFor({ cardPhotoUrl: null, photoUrl: null, photoPos: null }, undefined)).toEqual({
      cardPhotoUrl: null,
      photoPos: null,
    });
  });
});

// The rule the league asked for: one face on every card, but every season
// framed on its own. The PICTURE is carried — a season you never dressed wears
// what your current card wears, which is what stops a linked member showing a
// photo in one league and a bare letter in the other. The FRAMING is not: a
// zoom and a crop belong to one picture on one card, and carrying them meant
// adjusting one season silently re-cropped every season left alone.
describe("the picture is carried between seasons; the framing is not", () => {
  // The person's newest card: a picture and a framing they chose this season.
  const idov = {
    photoUrl: null,
    photoPos: null,
    avatarUrl: null,
    avatarPos: null,
    cardPhotoUrl: "/cards/current.jpg",
    cardPhotoPos: '{"x":40,"y":30,"z":1.2}',
  };
  const untouched = { cardPhotoUrl: null, photoUrl: null, discordAvatar: null, photoPos: null };

  it("an untouched season takes the current card's picture, and frames it itself", () => {
    expect(cardPictureFor(untouched, idov)).toEqual({
      cardPhotoUrl: "/cards/current.jpg",
      photoPos: null,
    });
  });

  it("framing one season leaves every other season's crop alone", () => {
    // The fault this rule exists for: S8 is framed, S7 was never touched, and
    // S7 must not be re-cropped by it.
    const framedSeason = { ...untouched, photoPos: { x: 20, y: 80, z: 2.4, s: 0.3, t: 0.9 } };
    expect(cardPictureFor(framedSeason, idov).photoPos).toEqual({ x: 20, y: 80, z: 2.4, s: 0.3, t: 0.9 });
    expect(cardPictureFor(untouched, idov).photoPos).toBeNull();
  });

  it("a season carrying only the fanned-out profile photo still follows", () => {
    // /me/photo writes the same avatar onto the person's current rows; that is
    // not somebody dressing that season's card, so it must not pin it.
    expect(cardPictureFor({ ...untouched, photoUrl: "/uploads/avatar.jpg" }, idov).cardPhotoUrl).toBe(
      "/cards/current.jpg"
    );
  });

  it("a season given its own picture keeps it when the current card changes", () => {
    const pinned = { ...untouched, cardPhotoUrl: "/cards/s3.jpg" };
    expect(cardPictureFor(pinned, idov).cardPhotoUrl).toBe("/cards/s3.jpg");
  });

  it("a season framed by hand keeps that framing, picture or no picture", () => {
    const own = { x: 50, y: 50, z: 2, s: 0.5, t: 0 };
    // Framed but never given a picture: it still follows the current picture.
    expect(cardPictureFor({ ...untouched, photoPos: own }, idov)).toEqual({
      cardPhotoUrl: "/cards/current.jpg",
      photoPos: own,
    });
  });

  it("picture and framing pin apart: its own picture, its own framing or none", () => {
    const ownPicture = { ...untouched, cardPhotoUrl: "/cards/s3.jpg" };
    expect(cardPictureFor(ownPicture, idov)).toEqual({
      cardPhotoUrl: "/cards/s3.jpg",
      photoPos: null,
    });
  });

  it("clearing a row's own picture hands THAT back to the person's", () => {
    // What the editor's reset button leaves behind is exactly `untouched`: the
    // picture follows again, the framing goes to the default.
    expect(cardPictureFor(untouched, idov).cardPhotoUrl).toBe("/cards/current.jpg");
    expect(cardPictureFor(untouched, idov).photoPos).toBeNull();
  });

  it("with no picture set anywhere there is nothing to inherit", () => {
    expect(cardPictureFor(untouched, { ...idov, cardPhotoUrl: null })).toEqual({
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

// The ranking is a guess about which URL still resolves, and it can be wrong:
// a season that has not started yet ranks last on purpose, and season numbers
// of two leagues are not really comparable. So the browser gets the whole
// chain and walks it as pictures fail — that test settles what a guess cannot.
describe("the picture chain the browser walks", () => {
  const own = { cardPhotoUrl: "/cards/own.jpg", photoUrl: "/uploads/own.jpg", discordAvatar: "/avatars/own.png", photoPos: null };
  const idov = { photoUrl: "/uploads/person.jpg", photoPos: null, avatarUrl: "/avatars/person.png", avatarPos: null, cardPhotoUrl: "/cards/person.jpg", cardPhotoPos: null };

  it("offers every candidate, best first", () => {
    // Card pictures first (this row's, then the current card's), then the
    // profile photos, then the avatars — see rankedPictures.
    expect(pictureChainFor(own, idov)).toEqual([
      "/cards/own.jpg",
      "/cards/person.jpg",
      "/uploads/own.jpg",
      "/uploads/person.jpg",
      "/avatars/person.png",
      "/avatars/own.png",
    ]);
  });

  it("leaves the card-only pictures out of the round avatar's chain", () => {
    expect(pictureChainFor(own, idov, { card: false })).toEqual([
      "/uploads/own.jpg",
      "/uploads/person.jpg",
      "/avatars/person.png",
      "/avatars/own.png",
    ]);
  });

  it("never repeats a picture two rows share", () => {
    const shared = "https://cdn.discordapp.com/avatars/1/same.png";
    const chain = pictureChainFor(
      { cardPhotoUrl: null, photoUrl: null, discordAvatar: shared, photoPos: null },
      { photoUrl: null, avatarUrl: shared, cardPhotoUrl: null }
    );
    expect(chain).toEqual([shared]);
  });

  it("the fallbacks are the chain minus the picture already on show", () => {
    expect(photoFallbacksFor(own, idov)).toEqual(pictureChainFor(own, idov).slice(1));
    expect(photoFallbacksFor(own, idov)[0]).toBe("/cards/person.jpg");
  });

  it("a row with a dead avatar and a linked person still has somewhere to go", () => {
    // Foniok's case with the ranking reversed by a pre-season draft: even when
    // the guess picks the dead URL first, the live one is next in line.
    const sunday = { cardPhotoUrl: null, photoUrl: null, discordAvatar: "/dead.png", photoPos: null };
    const stale = { photoUrl: null, avatarUrl: "/dead.png", cardPhotoUrl: null };
    expect(pictureChainFor(sunday, stale)).toEqual(["/dead.png"]);
    const withLive = { photoUrl: null, avatarUrl: "/live.png", cardPhotoUrl: null };
    expect(pictureChainFor(sunday, withLive)).toEqual(["/live.png", "/dead.png"]);
  });

  it("an unlinked row's chain is just its own picture", () => {
    expect(pictureChainFor({ cardPhotoUrl: null, photoUrl: null, discordAvatar: "/a.png" }, undefined)).toEqual(["/a.png"]);
    expect(photoFallbacksFor({ cardPhotoUrl: null, photoUrl: null, discordAvatar: "/a.png" }, undefined)).toEqual([]);
  });
});

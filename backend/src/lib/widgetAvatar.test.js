import { describe, it, expect, vi, beforeAll } from "vitest";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { UPLOADS_DIR } from "./dataDirs.js";

vi.mock("./persons.js", () => ({ getIdentityOverrides: vi.fn(async () => new Map()) }));
vi.mock("../services/seasonService.js", () => ({
  getPrivateSeasonIds: vi.fn(async () => new Set(["season-private"])),
}));

const { avatarBox, pictureSource, avatarUrlFor, avatarImage, AVATAR_MAX } = await import("./widgetAvatar.js");

// A landscape test picture on disk, where uploads live (vitest points the data
// directories at a throwaway folder).
beforeAll(async () => {
  const canvas = createCanvas(1200, 800);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 1200, 800);
  mkdirSync(join(UPLOADS_DIR, "cards"), { recursive: true });
  writeFileSync(join(UPLOADS_DIR, "cards", "widget_test.png"), await canvas.encode("png"));
});

const fakePrisma = (row) => ({ $queryRaw: vi.fn(async () => (row ? [row] : [])) });

describe("avatarBox", () => {
  it("cuts a landscape picture square around the card's framing", () => {
    expect(avatarBox(1200, 800, 50)).toEqual({ sx: 200, sy: 0, sw: 800, sh: 800, w: 600, h: 600 });
    expect(avatarBox(1200, 800, 0).sx).toBe(0);
    expect(avatarBox(1200, 800, 100).sx).toBe(400);
  });

  it("keeps a portrait picture whole and brings its long side down", () => {
    expect(avatarBox(900, 1200)).toEqual({ sx: 0, sy: 0, sw: 900, sh: 1200, w: 450, h: AVATAR_MAX });
  });

  it("never scales up", () => {
    expect(avatarBox(256, 256)).toMatchObject({ w: 256, h: 256 });
  });
});

describe("pictureSource", () => {
  it("reads uploads on this server and Discord avatars, nothing else", () => {
    expect(pictureSource("/api/uploads/cards/widget_test.png?v=1")).toMatchObject({ kind: "file" });
    expect(pictureSource("/api/uploads/cards/missing.png")).toBe(null);
    expect(pictureSource("/api/uploads/cards/..%2F..%2Fsecret")).toBe(null);
    expect(pictureSource("https://cdn.discordapp.com/avatars/1/abc.png?size=256")).toMatchObject({ kind: "discord" });
    expect(pictureSource("https://example.com/me.png")).toBe(null);
    expect(pictureSource(null)).toBe(null);
  });
});

describe("avatarUrlFor", () => {
  const row = { seasonId: "s8", cardPhotoUrl: "/api/uploads/cards/widget_test.png?v=1", photoUrl: null, discordAvatar: null, cardPhotoPos: null };

  it("names the card's picture with a version", async () => {
    const url = await avatarUrlFor(fakePrisma(row), "drv1", "https://nabsracing.com");
    expect(url).toMatch(/^https:\/\/nabsracing\.com\/api\/widget\/avatar\/drv1\?v=[0-9a-f]{10}$/);
  });

  it("is null without a picture, for an unknown row and for a private season", async () => {
    expect(await avatarUrlFor(fakePrisma({ ...row, cardPhotoUrl: null }), "drv1", "")).toBe(null);
    expect(await avatarUrlFor(fakePrisma(null), "drv1", "")).toBe(null);
    expect(await avatarUrlFor(fakePrisma({ ...row, seasonId: "season-private" }), "drv1", "")).toBe(null);
  });
});

describe("avatarImage", () => {
  it("serves the picture as a square JPEG of at most 600px", async () => {
    const row = { seasonId: "s8", cardPhotoUrl: "/api/uploads/cards/widget_test.png?v=2", photoUrl: null, discordAvatar: null, cardPhotoPos: null };
    const jpeg = await avatarImage(fakePrisma(row), "drv1");
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    const img = await loadImage(jpeg);
    expect([img.width, img.height]).toEqual([600, 600]);
  });

  it("goes on to the next picture when one will not load, like the card", async () => {
    const row = {
      seasonId: "s8",
      cardPhotoUrl: "/api/uploads/cards/missing.png",
      photoUrl: "/api/uploads/cards/widget_test.png?v=3",
      discordAvatar: null,
      cardPhotoPos: null,
    };
    expect(await avatarImage(fakePrisma(row), "drv1")).not.toBe(null);
    expect(await avatarImage(fakePrisma({ ...row, photoUrl: null }), "drv1")).toBe(null);
  });
});

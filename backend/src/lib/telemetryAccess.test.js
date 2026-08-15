// The switch that decides who may read a recorded lap.
//
// The tests that matter are the ones about the CLOSED state, because that is
// the state a mistake leaks from: an unset setting, a broken database, a
// half-typed value must all read as "admins only". Open is one exact value and
// nothing else.
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAdmin = vi.fn((req, res, next) => next());
vi.mock("../middleware/auth.js", () => ({ requireAdmin: (...a) => requireAdmin(...a) }));

import {
  isTelemetryPublic,
  setTelemetryPublic,
  invalidateTelemetryVisibility,
  telemetryReadGate,
  TELEMETRY_PUBLIC_KEY,
} from "./telemetryAccess.js";

const prismaWith = (value) => ({
  setting: {
    findUnique: vi.fn(async () => (value === undefined ? null : { key: TELEMETRY_PUBLIC_KEY, value })),
    upsert: vi.fn(async () => ({})),
  },
});

beforeEach(() => {
  invalidateTelemetryVisibility();
  requireAdmin.mockClear();
});

describe("reading the switch", () => {
  it("is open only for exactly \"1\"", async () => {
    expect(await isTelemetryPublic(prismaWith("1"))).toBe(true);
  });

  it("is closed when the setting was never written", async () => {
    expect(await isTelemetryPublic(prismaWith(undefined))).toBe(false);
  });

  it("is closed for an empty value, which is how switching off is stored", async () => {
    expect(await isTelemetryPublic(prismaWith(""))).toBe(false);
  });

  it("is closed for anything else somebody might put there by hand", async () => {
    for (const v of ["true", "yes", "on", "0", " 1", "1 ", "public"]) {
      invalidateTelemetryVisibility();
      expect([v, await isTelemetryPublic(prismaWith(v))]).toEqual([v, false]);
    }
  });

  it("is closed when the database cannot answer at all", async () => {
    // A failed read is not permission. This is the one that would quietly
    // publish every driver's inputs during an outage.
    const broken = { setting: { findUnique: vi.fn(async () => { throw new Error("down"); }) } };
    expect(await isTelemetryPublic(broken)).toBe(false);
  });
});

describe("the cache", () => {
  it("does not re-read the setting for every request", async () => {
    const p = prismaWith("1");
    await isTelemetryPublic(p);
    await isTelemetryPublic(p);
    await isTelemetryPublic(p);
    expect(p.setting.findUnique).toHaveBeenCalledTimes(1);
  });

  it("takes hold immediately when the switch is flipped here", async () => {
    const p = prismaWith("1");
    expect(await isTelemetryPublic(p)).toBe(true);
    p.setting.findUnique = vi.fn(async () => ({ value: "" }));
    await setTelemetryPublic(p, false); // flipping invalidates
    expect(await isTelemetryPublic(p)).toBe(false);
  });
});

describe("writing the switch", () => {
  it("stores exactly the value the reader accepts", async () => {
    const p = prismaWith("");
    await setTelemetryPublic(p, true);
    expect(p.setting.upsert.mock.calls[0][0].update).toEqual({ value: "1" });
    await setTelemetryPublic(p, false);
    expect(p.setting.upsert.mock.calls[1][0].update).toEqual({ value: "" });
  });
});

describe("the gate on the read endpoints", () => {
  const run = async (prisma) => {
    const next = vi.fn();
    await telemetryReadGate(prisma)({}, {}, next);
    return next;
  };

  it("lets anybody through when the league has opened it, without asking who", async () => {
    const next = await run(prismaWith("1"));
    expect(next).toHaveBeenCalled();
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it("falls back to the admin check when it is closed", async () => {
    await run(prismaWith(""));
    expect(requireAdmin).toHaveBeenCalled();
  });

  it("falls back to the admin check when the database is down", async () => {
    const broken = { setting: { findUnique: vi.fn(async () => { throw new Error("down"); }) } };
    await run(broken);
    expect(requireAdmin).toHaveBeenCalled();
  });
});

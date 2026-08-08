// ---------------------------------------------------------------------------
// "Sign in through Steam" — linking a member's Steam account to their login.
//
// Why at all: race results are imported from Assetto Corsa JSON files, which
// identify drivers by their SteamID64. The import captures that id by itself
// the first time someone races, but a NEW member has no result yet, so their
// first import falls back to matching display names. Letting them prove their
// Steam account up front means the very first race lands on the right person.
//
// Why it is cheap: Steam is an open OpenID 2.0 provider. There is no app to
// register, no client id, no secret, no API key, and no redirect allowlist to
// maintain. The flip side is that Valve enforces nothing for us, so every check
// in this file matters.
//
// THE SHAPE OF THE FLOW (and why it is not the obvious one):
// Steam sends the member back with a signed assertion in a plain browser GET.
// If that GET landed here and wrote the id straight away, the site would be
// wide open to a linking attack: an attacker signs in with a throwaway Discord
// account, starts the flow, sends the resulting Steam URL to a member, the
// member clicks Valve's own confirm button, and the member's SteamID64 gets
// written onto the ATTACKER's account. Everything about that request looks
// legitimate, so no amount of signature checking prevents it.
//
// So the return URL points at a page in OUR frontend (like the Discord login
// already does), and that page POSTs the assertion back here WITH the member's
// session. The write then goes to the account that is actually signed in, in
// this browser, right now. An assertion for someone else's Steam account is
// still verified against Steam, but it can only ever land on the account of
// whoever posts it.
// ---------------------------------------------------------------------------
import { Router } from "express";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
import { requireUser, resolveDriverId } from "../middleware/auth.js";
import { IS_DEPLOYED } from "../lib/deployment.js";
import {
  applyMemberSteamId,
  dbClearSteamId,
  dbGetMember,
  dbMemberBySteamId,
  dbSetSteamId,
} from "../lib/members.js";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const STEAM_OPENID = "https://steamcommunity.com/openid/login";
// Steam's identity URLs. Valve's own documentation writes http:// while live
// responses use https://, so both are accepted (and nothing is trusted from
// this string before Steam has confirmed the assertion).
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})\/?$/;
// A SteamID64 of an individual account sits in this band. Cheap sanity check;
// its real job is catching a pasted Discord user id in the admin field, which
// looks like a 17-19 digit number too.
const STEAM_ID_MIN = 76561197960265728n;
const STEAM_ID_MAX = 76561202255233024n;
// An assertion older than this is refused, so a signed URL that leaks (browser
// history, a screenshot, a proxy log) cannot be replayed days later.
const MAX_ASSERTION_AGE_MS = 10 * 60 * 1000;

export function isIndividualSteamId(id) {
  if (!/^\d{17}$/.test(String(id || ""))) return false;
  const n = BigInt(id);
  return n >= STEAM_ID_MIN && n < STEAM_ID_MAX;
}

// Which sites may be named as the place Steam returns to. Steam allows any
// site to start a flow for any realm, so this list is the only thing that ties
// an assertion to US: without it, someone could collect a signed assertion on
// their own site (by getting a member to sign in through Steam there) and post
// it here with their own session, which would move that member's Steam account
// onto their account. The list is configuration on purpose — a request header
// would be no boundary at all, since whoever posts controls it.
//
// Sources: the CORS allowlist the site already maintains (DEPLOYMENT.md sets it
// to the real domain), plus loopback during development.
function allowedOrigins() {
  const out = new Set();
  for (const raw of String(process.env.CORS_ORIGIN || "").split(",")) {
    const v = raw.trim().replace(/\/$/, "");
    if (v) out.add(v);
  }
  const extra = String(process.env.PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
  if (extra) out.add(extra);
  return out;
}

// Anything that looks like a real deployment must NOT get the loopback escape
// hatch below. NODE_ENV alone is not enough: start:prod never sets it, so the
// live server would look like a dev box and accept a return address that never
// touches the league's domain. The probe itself lives in lib/deployment.js —
// it was copied into three files and had already drifted apart there.
const isDev = !IS_DEPLOYED;

// The page in OUR frontend that Steam returns to. Same trick as the Discord
// login: the browser lands on a route of the site, that page hands the result
// to the API with the member's own session attached. Returns the URL when it is
// both well-formed AND one of ours, else null.
export function pickReturnTo(explicit) {
  const val = String(explicit || "").trim();
  if (!/^https?:\/\/[^\s?#]+\/auth\/steam\/callback$/.test(val)) return null;
  let origin;
  try {
    origin = new URL(val).origin;
  } catch {
    return null;
  }
  if (allowedOrigins().has(origin)) return val;
  // Dev convenience: the site is served from a handful of local ports (Vite,
  // the built bundle, the odd second instance) and from a tunnel while sharing.
  // Never in production.
  if (isDev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return val;
  return null;
}

// Realm derived mechanically from the return URL (scheme + host, trailing
// slash), so realm and return_to can never disagree — the classic reason Steam
// rejects the request behind a reverse proxy.
function realmOf(returnTo) {
  const u = new URL(returnTo);
  return `${u.protocol}//${u.host}/`;
}

// POST /api/auth/steam/start { returnTo } -> { url }
// Builds the redirect, with a short-lived token naming WHO started this round
// trip baked into the return address. Steam signs the return address, so it
// comes back untampered, and the answer is only accepted by the same member
// (see /verify). Without that binding, a signed Steam answer is a bearer token
// for "somebody's Steam account": whoever gets a browser to hand it in decides
// nothing about whose account it lands on, so it could be pushed onto another
// member's account, or another member's answer could be handed in as one's own.
router.post("/start", requireUser, async (req, res, next) => {
  try {
    const base = pickReturnTo(req.body?.returnTo);
    if (!base) {
      return res.status(400).json({ error: "Invalid return URL" });
    }
    const state = jwt.sign({ role: "steam-state", sub: req.user.discordId }, JWT_SECRET, {
      expiresIn: "10m",
    });
    const returnTo = `${base}?s=${encodeURIComponent(state)}`;
    const params = new URLSearchParams({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      // Both are the literal spec URI, not our domain: it tells Steam "you pick
      // which account, we do not know it yet".
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.realm": realmOf(returnTo),
      "openid.return_to": returnTo,
    });
    res.json({ url: `${STEAM_OPENID}?${params.toString()}` });
  } catch (e) {
    next(e);
  }
});

// Answers already spent, so the same signed callback cannot be handed in twice.
// In memory on purpose: entries live for minutes, the site runs as one process,
// and a restart only means an unlucky member has to press the button again.
const usedNonces = new Map(); // nonce -> expiry (ms)
function isUsedNonce(nonce) {
  const now = Date.now();
  for (const [k, exp] of usedNonces) if (exp <= now) usedNonces.delete(k);
  return usedNonces.has(nonce);
}
function markNonceUsed(nonce) {
  usedNonces.set(nonce, Date.now() + MAX_ASSERTION_AGE_MS * 2);
}

// Ask Steam whether the assertion it apparently issued is genuine. Mandatory:
// the signature is over a key only Steam holds, so without this call anyone
// could hand-craft a callback URL naming any SteamID64 they like.
async function checkAuthentication(params) {
  const body = new URLSearchParams(params);
  body.set("openid.mode", "check_authentication");
  const r = await fetch(STEAM_OPENID, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return false;
  const text = await r.text();
  // Key-value form; accept only an explicit positive.
  return /(^|\n)is_valid:true\s*(\n|$)/.test(text);
}

// POST /api/auth/steam/verify { query } -> { ok, steamId, driver }
// `query` is the raw query string Steam appended to the callback page.
router.post("/verify", requireUser, async (req, res, next) => {
  try {
    const discordId = req.user?.discordId;
    if (!discordId) return res.status(401).json({ error: "Sign in with Discord first" });

    const params = new URLSearchParams(String(req.body?.query || "").replace(/^\?/, ""));
    // A repeated field would let us read one value while Steam signs another:
    // our reads take the first occurrence, and whether Steam's parser agrees is
    // not something to bet an identity on. Refuse outright.
    for (const key of new Set(params.keys())) {
      if (params.getAll(key).length > 1) {
        return res.status(400).json({ error: "That Steam response is malformed." });
      }
    }
    const get = (k) => params.get(k) || "";

    if (get("openid.mode") === "cancel") {
      return res.status(400).json({ error: "Steam sign-in was cancelled.", cancelled: true });
    }
    if (get("openid.mode") !== "id_res") {
      return res.status(400).json({ error: "That Steam response is not a sign-in result." });
    }
    if (get("openid.op_endpoint") !== STEAM_OPENID) {
      return res.status(400).json({ error: "That response did not come from Steam." });
    }
    // Only SIGNED fields can be trusted; an unsigned claimed_id is just text an
    // attacker appended to the URL.
    const signed = get("openid.signed").split(",");
    for (const field of ["claimed_id", "return_to", "response_nonce"]) {
      if (!signed.includes(field)) {
        return res.status(400).json({ error: "That Steam response is incomplete." });
      }
    }
    // The signed return_to has to be one of ours, so an answer produced for a
    // different site cannot be handed in here.
    const returnTo = get("openid.return_to");
    if (!pickReturnTo(returnTo.split("?")[0])) {
      return res.status(400).json({ error: "That Steam response belongs to another site." });
    }
    // ...and it has to be the round trip THIS member started. The token rides
    // inside the signed return address, so it cannot be swapped without
    // breaking Steam's signature. This is what stops a Steam answer from being
    // pushed onto somebody else's account (in either direction).
    let state;
    try {
      state = jwt.verify(new URL(returnTo).searchParams.get("s") || "", JWT_SECRET);
    } catch {
      state = null;
    }
    if (!state || state.role !== "steam-state") {
      return res.status(400).json({ error: "That Steam sign-in has expired. Please start again.", expired: true });
    }
    if (state.sub !== discordId) {
      return res.status(403).json({
        error: "That Steam sign-in was started from a different account. Please start again from your own profile.",
      });
    }
    // Steam's nonce starts with an ISO timestamp. Refuse stale answers.
    const nonce = get("openid.response_nonce");
    const stamp = Date.parse(nonce.slice(0, 20));
    if (!Number.isFinite(stamp) || Math.abs(Date.now() - stamp) > MAX_ASSERTION_AGE_MS) {
      return res.status(400).json({ error: "That Steam sign-in has expired. Please try again.", expired: true });
    }
    // ...and each answer counts once. A callback URL lingers in history, logs
    // and screenshots; replaying it must not do anything a second time.
    if (isUsedNonce(nonce)) {
      return res.status(400).json({ error: "That Steam sign-in was already used. Please start again.", expired: true });
    }

    if (!(await checkAuthentication(params))) {
      return res.status(400).json({ error: "Steam could not confirm that sign-in. Please try again." });
    }
    markNonceUsed(nonce);

    const match = CLAIMED_ID.exec(get("openid.claimed_id"));
    const steamId = match?.[1];
    if (!steamId || !isIndividualSteamId(steamId)) {
      return res.status(400).json({ error: "That is not a personal Steam account." });
    }

    const account = await dbGetMember(prisma, discordId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const holder = await dbMemberBySteamId(prisma, steamId);
    if (holder && holder.discordId !== discordId) {
      return res.status(409).json({
        error:
          "That Steam account is already linked to another league login. If that is you, ask an admin to sort the two accounts out.",
      });
    }

    await dbSetSteamId(prisma, discordId, steamId);

    // If a driver row already exists for this login, seed it right away; the
    // admin onboarding paths do the same for accounts that get one later.
    let driver = { written: false, reason: "no-driver" };
    const driverId = await resolveDriverId(prisma, req.user);
    if (driverId) driver = await applyMemberSteamId(prisma, discordId, driverId);

    res.json({ ok: true, steamId, driver });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/auth/steam -> unlink (so a member can correct a wrong account).
// Only the ACCOUNT claim is dropped. A value already carried over to a driver
// row stays: from there on it is league data an admin owns, and clearing it
// silently would break result matching mid-season.
router.delete("/", requireUser, async (req, res, next) => {
  try {
    if (!req.user?.discordId) return res.status(401).json({ error: "Sign in with Discord first" });
    await dbClearSteamId(prisma, req.user.discordId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;

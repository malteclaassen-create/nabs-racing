import { describe, expect, it } from "vitest";
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from "node:crypto";
import {
  encryptPayload,
  fromB64u,
  generateVapidKeys,
  isVapidPublicKey,
  sendWebPush,
  vapidAuthorization,
} from "./webPush.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");

// RFC 8291 section 5 and appendix A: the worked example, inputs and the exact
// body a correct implementation sends.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

// The browser's side of RFC 8291, written out independently, so a message
// with a random key and salt can be opened again and compared.
function decrypt(body, uaPrivate, authSecret) {
  const salt = body.subarray(0, 16);
  const idLen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLen);
  const sealed = body.subarray(21 + idLen);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const uaPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, authSecret, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const padded = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  // Strip the delimiter (and any zero padding before it).
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2);
  return padded.subarray(0, end).toString("utf8");
}

function aBrowser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    privateKey: ecdh.getPrivateKey(),
    keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(Buffer.from("0123456789abcdef")) },
  };
}

function verifyJwt(jwt, publicKeyB64u) {
  const [h, c, s] = jwt.split(".");
  const pub = fromB64u(publicKeyB64u);
  const key = createPublicKey({
    key: { kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  return verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, fromB64u(s));
}

describe("payload encryption (RFC 8291)", () => {
  it("reproduces the RFC's worked example byte for byte", () => {
    const body = encryptPayload({
      uaPublic: fromB64u(RFC.uaPublic),
      authSecret: fromB64u(RFC.authSecret),
      payload: Buffer.from(RFC.plaintext),
      senderPrivateKey: fromB64u(RFC.asPrivate),
      salt: fromB64u(RFC.salt),
    });
    expect(b64u(body)).toBe(RFC.body);
  });

  it("opens again on the browser's side with a fresh key and salt", () => {
    const browser = aBrowser();
    const text = JSON.stringify({ title: "Round 4 results are in", url: "/s/f1/races?race=abc" });
    const body = encryptPayload({
      uaPublic: fromB64u(browser.keys.p256dh),
      authSecret: fromB64u(browser.keys.auth),
      payload: Buffer.from(text),
    });
    expect(decrypt(body, browser.privateKey, fromB64u(browser.keys.auth))).toBe(text);
  });

  it("never sends the same bytes twice", () => {
    const browser = aBrowser();
    const args = { uaPublic: fromB64u(browser.keys.p256dh), authSecret: fromB64u(browser.keys.auth), payload: Buffer.from("x") };
    expect(b64u(encryptPayload(args))).not.toBe(b64u(encryptPayload(args)));
  });
});

describe("VAPID", () => {
  it("makes a key pair a browser accepts", () => {
    const keys = generateVapidKeys();
    expect(isVapidPublicKey(keys.publicKey)).toBe(true);
    expect(fromB64u(keys.privateKey)).toHaveLength(32);
    expect(isVapidPublicKey("abc")).toBe(false);
  });

  it("signs a token the push service can check against the public key", () => {
    const keys = generateVapidKeys();
    const now = Date.UTC(2026, 9, 14, 12, 0, 0);
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc:def", keys, "https://nabsracing.com", now);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    expect(m[2]).toBe(keys.publicKey);
    expect(verifyJwt(m[1], keys.publicKey)).toBe(true);
    const [h, c] = m[1].split(".");
    expect(JSON.parse(fromB64u(h).toString())).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(fromB64u(c).toString());
    // The push service's origin, not the endpoint's path.
    expect(claims.aud).toBe("https://fcm.googleapis.com");
    expect(claims.sub).toBe("https://nabsracing.com");
    // At most a day out (RFC 8292).
    expect(claims.exp - now / 1000).toBeGreaterThan(0);
    expect(claims.exp - now / 1000).toBeLessThanOrEqual(24 * 3600);
  });

  it("a token signed with another key does not check out", () => {
    const a = generateVapidKeys();
    const b = generateVapidKeys();
    const header = vapidAuthorization("https://web.push.apple.com/QGuQyavXut", a, "https://nabsracing.com");
    const jwt = /t=([^,]+),/.exec(header)[1];
    expect(verifyJwt(jwt, b.publicKey)).toBe(false);
  });
});

describe("sending", () => {
  const vapid = generateVapidKeys();
  const endpoint = "https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB";

  function fakeFetch(status) {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init });
      if (status instanceof Error) throw status;
      return { ok: status >= 200 && status < 300, status };
    };
    return { impl, calls };
  }

  it("posts an encrypted body with the headers the push services ask for", async () => {
    const browser = aBrowser();
    const { impl, calls } = fakeFetch(201);
    const out = await sendWebPush(
      { endpoint, keys: browser.keys },
      { title: "Starting soon" },
      { vapid, subject: "https://nabsracing.com", ttl: 3600, urgency: "high", fetchImpl: impl }
    );
    expect(out).toEqual({ ok: true, status: 201, gone: false });
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe(endpoint);
    expect(init.method).toBe("POST");
    expect(init.headers.TTL).toBe("3600");
    expect(init.headers.Urgency).toBe("high");
    expect(init.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(JSON.parse(decrypt(init.body, browser.privateKey, fromB64u(browser.keys.auth)))).toEqual({ title: "Starting soon" });
  });

  it("calls a subscription gone when the push service says so", async () => {
    const browser = aBrowser();
    for (const status of [404, 410]) {
      const { impl } = fakeFetch(status);
      const out = await sendWebPush({ endpoint, keys: browser.keys }, "x", { vapid, subject: "mailto:a@b.c", fetchImpl: impl });
      expect(out).toMatchObject({ ok: false, status, gone: true });
    }
  });

  it("a passing fault is not the end of a subscription", async () => {
    const browser = aBrowser();
    for (const status of [429, 500, new Error("socket hang up")]) {
      const { impl } = fakeFetch(status);
      const out = await sendWebPush({ endpoint, keys: browser.keys }, "x", { vapid, subject: "mailto:a@b.c", fetchImpl: impl });
      expect(out.ok).toBe(false);
      expect(out.gone).toBe(false);
    }
  });

  it("a subscription whose keys do not decode is gone without a request", async () => {
    const { impl, calls } = fakeFetch(201);
    const out = await sendWebPush({ endpoint, keys: { p256dh: "bm9wZQ", auth: "x" } }, "x", { vapid, subject: "mailto:a@b.c", fetchImpl: impl });
    expect(out.gone).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

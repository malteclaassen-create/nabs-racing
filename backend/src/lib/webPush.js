// ---------------------------------------------------------------------------
// Web Push, the protocol half: how one message gets from this server to one
// phone. Hand-written on node:crypto, no library, the same way the service
// worker on the other end is.
//
// Three standards, and each is small once it is spelled out:
//
//   RFC 8030  the push service. Every browser hands the page an "endpoint" URL
//             at its vendor (Google for Chrome and Android, Apple for Safari
//             and the iPhone, Mozilla for Firefox, Microsoft for Edge). A POST
//             to that URL is delivered to the device, even with the site
//             closed. TTL says how long the service may hold it for a phone
//             that is off; Urgency lets a battery saver decide.
//   RFC 8292  VAPID. The POST carries a short JWT signed with this server's
//             key, so the push service knows the message comes from the same
//             server the browser subscribed to — nobody who merely learns an
//             endpoint can push to it.
//   RFC 8291  the payload is end-to-end encrypted for the browser's own key
//             (ECDH on P-256, HKDF, AES-128-GCM). The push service carries it
//             and cannot read it. encryptPayload() below reproduces the RFC's
//             worked example byte for byte (webPush.test.js).
//
// League logic — who gets what, the switch, the devices — is lib/push.js.
// ---------------------------------------------------------------------------
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
export const fromB64u = (s) => Buffer.from(String(s || ""), "base64url");

// One record of 4096 bytes, the RFC's default and what every push service
// takes. A message has to fit in it whole (lib/push.js keeps them short).
const RECORD_SIZE = 4096;

// A P-256 private key is a 32-byte number. Written out as bytes it can come up
// short when it happens to start with a zero, and a JWK insists on the full 32.
function pad32(buf) {
  if (buf.length >= 32) return buf;
  return Buffer.concat([Buffer.alloc(32 - buf.length), buf]);
}

// A fresh key pair for this server, both halves base64url: the public key as
// the 65-byte uncompressed point browsers want as `applicationServerKey`, the
// private key as the raw 32 bytes. Made once and kept (lib/push.js); every
// subscription is tied to the public half, so a new pair means every device
// has to subscribe again.
export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(pad32(ecdh.getPrivateKey())) };
}

// Is this a public key a browser can be handed? 65 bytes, uncompressed point.
export function isVapidPublicKey(key) {
  const raw = fromB64u(key);
  return raw.length === 65 && raw[0] === 0x04;
}

// The Authorization header for one POST (RFC 8292). `aud` is the push
// service's origin, `exp` at most a day out (twelve hours here, as everybody
// does), `sub` a way to reach whoever runs the server: a mailto: or https URL.
// Apple refuses anything else.
export function vapidAuthorization(endpoint, { publicKey, privateKey }, subject, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(
    JSON.stringify({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / 1000) + 12 * 3600,
      sub: subject,
    })
  );
  const pub = fromB64u(publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: b64u(pad32(fromB64u(privateKey))),
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  // JOSE wants the bare r||s pair (64 bytes), not the DER wrapping node
  // produces by default.
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${publicKey}`;
}

// The encrypted body for one browser (RFC 8291 with the aes128gcm coding of
// RFC 8188). `uaPublic` and `authSecret` are the subscription's p256dh and auth
// keys as bytes. The sender key and the salt are fresh for every message; the
// test passes the RFC's own so the output can be checked against it.
export function encryptPayload({ uaPublic, authSecret, payload, senderPrivateKey = null, salt = null }) {
  const ecdh = createECDH("prime256v1");
  if (senderPrivateKey) ecdh.setPrivateKey(senderPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // The browser's auth secret and both public keys go into the key, so a
  // message can only be opened by the subscription it was made for.
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", ecdhSecret, authSecret, keyInfo, 32));

  const s = salt || randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, s, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, s, Buffer.from("Content-Encoding: nonce\0"), 12));

  // One record, so it is also the last one: the 0x02 delimiter, no padding.
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  // Header: salt (16), record size (4, big-endian), key id length (1) and the
  // key id itself, which for Web Push is the sender's public key.
  const head = Buffer.alloc(21);
  s.copy(head, 0);
  head.writeUInt32BE(RECORD_SIZE, 16);
  head.writeUInt8(asPublic.length, 20);
  return Buffer.concat([head, asPublic, sealed]);
}

// POST one message to one subscription. Never throws: the answer says whether
// it arrived (`ok`), and whether the subscription is dead for good (`gone`: the
// browser unsubscribed, the app was uninstalled, the permission was taken
// away), in which case the caller forgets it.
export async function sendWebPush(
  subscription,
  payload,
  { vapid, subject, ttl = 86400, urgency = "normal", fetchImpl = fetch, timeoutMs = 10_000 } = {}
) {
  let body;
  let authorization;
  try {
    body = encryptPayload({
      uaPublic: fromB64u(subscription.keys.p256dh),
      authSecret: fromB64u(subscription.keys.auth),
      payload: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)),
    });
    authorization = vapidAuthorization(subscription.endpoint, vapid, subject);
  } catch (e) {
    // A key that does not decode is a broken subscription, not a passing
    // fault: there is no point offering it the next message either.
    return { ok: false, status: 0, gone: true, error: e.message };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(subscription.endpoint, {
      method: "POST",
      headers: {
        TTL: String(Math.max(0, Math.round(ttl))),
        Urgency: urgency,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        Authorization: authorization,
      },
      body,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// "Is this a real deployment, or someone's laptop?"
//
// Three separate things need that answer and each one fails dangerously if it
// gets it wrong: the JWT placeholder guard (middleware/auth.js) would let the
// site boot on a publicly known signing key, the Steam return-address check
// (routes/steamAuth.js) would accept a loopback address that never touches the
// league's domain, and the live-timing demo board (services/liveTiming.js)
// would let anyone fabricate a championship projection in public.
//
// It lived in three copies, and by the time this was written they had already
// drifted: steamAuth and liveTiming probed Railway, auth.js did not — while
// steamAuth's own comment stated that auth.js used the same probe. The JWT
// guard, the one with the worst failure mode, was the one silently doing less.
// One exported answer so that cannot happen again.
//
// NODE_ENV is not enough on its own: `start:prod` (backend/package.json) never
// sets it, so the live server looks exactly like a dev box. Hence the platform
// variables Railway injects, plus the https CORS origin that DEPLOYMENT.md's
// step 2 tells the operator to configure.
// ---------------------------------------------------------------------------

export const ON_RAILWAY = !!(
  process.env.RAILWAY_ENVIRONMENT ||
  process.env.RAILWAY_PROJECT_ID ||
  process.env.RAILWAY_SERVICE_ID
);

export const IS_DEPLOYED =
  process.env.NODE_ENV === "production" ||
  ON_RAILWAY ||
  /https:\/\//i.test(process.env.CORS_ORIGIN || "");

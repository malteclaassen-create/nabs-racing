import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Notice, CheckField } from "../components/ui.jsx";
import { useSocial } from "../components/SocialLinks.jsx";
import { useAuth, clearUser } from "../hooks/useAuth.js";
import { useDiscordLogin } from "../hooks/useDiscordLogin.js";
import { useAsk } from "../components/overlay.jsx";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";

// ---------------------------------------------------------------------------
// /delete-account — leaving, done properly.
//
// One page doing two jobs, because they are the same explanation:
//
//   Signed in   the button that actually does it.
//   Signed out  the public, login-free description of what deletion removes
//               and what it keeps. Google Play requires exactly this at a URL
//               of its own, reachable without installing anything, and it is
//               also what somebody deciding whether to leave wants to read
//               before they commit.
//
// The page states the split (person goes, racing stays) before it offers the
// button, and shows real counts from the member's own account rather than a
// generic warning: "3 season entries, 2 feedback threads" is something the
// reader can check against what they remember doing.
//
// The deed itself lives in backend/src/services/accountDeletionService.js,
// which is also where the reasoning behind each keep-or-delete call is written
// down. Whatever changes there changes the lists below.
// ---------------------------------------------------------------------------

function Section({ title, children }) {
  return (
    <section className="border-t border-border py-6 first:border-t-0 first:pt-0 sm:py-8">
      <h2 className="font-display text-xl font-extrabold uppercase tracking-tight text-dark sm:text-2xl">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-light">{children}</div>
    </section>
  );
}

function List({ children }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-faint">{children}</ul>;
}

// "2 feedback threads" / "1 feedback thread" / nothing at all when it's zero.
function countLine(n, one, many) {
  if (!n) return null;
  return `${n} ${n === 1 ? one : many}`;
}

export default function DeleteAccount() {
  useSpecificTitle("Delete your account · NABS Racing League");
  const { user } = useAuth();
  const ask = useAsk();
  const social = useSocial();
  const discord = social.data?.discord;
  const login = useDiscordLogin("/delete-account");

  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // Only ask the server about the account while there is one to ask about, and
  // stop once it is gone (the session dies with it, so a refetch would 401).
  const signedIn = !!user && !done;
  const preview = useApi(
    useCallback(() => (signedIn ? api.deleteAccountPreview() : Promise.resolve(null)), [signedIn])
  );

  // A deleted account means a dead session. Clearing it flips the whole UI to
  // signed-out, which is the honest state and stops every other panel on the
  // site from firing requests that would now fail.
  useEffect(() => {
    if (done) clearUser();
  }, [done]);

  async function remove() {
    if (
      !(await ask({
        title: "Delete your account for good?",
        body: "Your login, your pictures, your links and your messages to the admins go now. Race results stay. This cannot be undone.",
        danger: true,
        confirmLabel: "Delete my account",
      }))
    )
      return;
    setBusy(true);
    setError(null);
    try {
      setDone(await api.deleteAccount());
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const p = preview.data;
  const counts = p
    ? [
        countLine(p.seasons, "season entry", "season entries"),
        countLine(p.feedback, "feedback thread", "feedback threads"),
        countLine(p.reportsFiled, "report you filed", "reports you filed"),
        countLine(p.reportMessages, "message in a stewarding thread", "messages in stewarding threads"),
        countLine(p.notifications, "personal notification", "personal notifications"),
      ].filter(Boolean)
    : [];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Your account"
        title="Delete your account"
        subtitle="You can remove your NABS account at any time, from here, without asking anyone. This page also explains exactly what goes and what stays, so read it before you press anything."
      />

      {done ? (
        <div className="mb-8 space-y-4">
          <Notice kind="success">
            Your account is gone. You have been signed out.
          </Notice>
          <p className="text-[15px] leading-relaxed text-light">
            Removed: your login and everything you had written about yourself.
            {done.feedback ? ` Your ${done.feedback === 1 ? "feedback thread" : "feedback threads"} went with it.` : ""}
            {done.reportsFiled || done.reportMessages
              ? " Your name has been taken off the stewarding threads you were part of."
              : ""}{" "}
            Your race results are still in the standings, under the name you raced as.
          </p>
          <p className="text-[15px] leading-relaxed text-light">
            You are welcome back whenever you like: signing in with Discord again simply starts a new
            account. It will not know anything about the old one.
          </p>
          <Link to="/" className="inline-block text-sm font-semibold text-link hover:underline">
            Back to the league
          </Link>
        </div>
      ) : null}

      {!done && (
        <>
          <Section title="What gets deleted">
            <List>
              <li>Your login, and with it your Discord name, display name and profile picture.</li>
              <li>Your Steam link, if you had one.</li>
              <li>
                Everything you filled in about yourself: your uploaded pictures, your bio, your
                country, your racing number, your social links and how your rating card is set up.
              </li>
              <li>Your messages to the admins, and their replies to you.</li>
              <li>Your personal notifications.</li>
            </List>
          </Section>

          <Section title="What stays">
            <List>
              <li>
                <span className="font-semibold text-dark">Your race results.</span> Entries,
                positions, lap times, points and the ratings worked out from them, under the name you
                raced as. Removing those would rewrite championships that the rest of the grid also
                drove, and their results are their data too.
              </li>
              <li>
                <span className="font-semibold text-dark">Stewarding threads you were part of.</span>{" "}
                An incident is a record between two drivers and the officials, so the thread stays,
                with your name taken off it and replaced by "Former member".
              </li>
              <li>
                <span className="font-semibold text-dark">Backups.</span> The database is copied
                automatically, so what you deleted today can still sit in an older backup for a while
                before it ages out.
              </li>
            </List>
            <p>
              If you want your racing name off the archive as well, that is a conversation rather
              than a button. Ask, and we will work out what is possible.
            </p>
          </Section>

          {signedIn ? (
            <Section title="Delete it">
              {preview.loading && <p>Checking what is on your account…</p>}
              {counts.length > 0 && (
                <p>
                  On your account right now: {counts.join(", ")}.
                  {p?.upcomingRsvps
                    ? ` You are also signed up for ${p.upcomingRsvps} upcoming ${
                        p.upcomingRsvps === 1 ? "race" : "races"
                      }.`
                    : ""}
                </p>
              )}
              {p && counts.length === 0 && (
                <p>There is nothing on your account but the login itself.</p>
              )}
              {p?.upcomingRsvps ? (
                <Notice kind="info">
                  Tell an admin before you go. Your sign-ups stay on the entry list, and without a
                  login you cannot withdraw them yourself.
                </Notice>
              ) : null}

              <div className="card space-y-4 p-5">
                <CheckField
                  checked={understood}
                  onChange={(e) => setUnderstood(e.target.checked)}
                  label="I understand this cannot be undone"
                  hint="There is no restore, and no way for an admin to put it back."
                />
                <button
                  type="button"
                  onClick={remove}
                  disabled={!understood || busy}
                  className="rounded-lg bg-red-600 px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wide text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Deleting…" : "Delete my account"}
                </button>
                {error && <Notice kind="error">{error}</Notice>}
              </div>
            </Section>
          ) : (
            <Section title="How to do it">
              <p>
                Sign in with Discord and the button appears on this page. Nobody has to approve it and
                nobody is told.
              </p>
              {login.enabled && (
                <button
                  type="button"
                  onClick={login.start}
                  disabled={login.loading}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#4752c4] disabled:opacity-60"
                >
                  Sign in with Discord
                </button>
              )}
              <p>
                Cannot sign in any more, or would rather not?{" "}
                {discord ? (
                  <>
                    Ask an admin in{" "}
                    <a
                      className="text-dark underline"
                      href={discord}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      our Discord
                    </a>
                    , or write to the contact on the{" "}
                  </>
                ) : (
                  <>Ask an admin in the league Discord, or write to the contact on the </>
                )}
                <Link className="text-dark underline" to="/privacy">
                  privacy page
                </Link>
                . A request made that way is handled by hand and does exactly the same thing.
              </p>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

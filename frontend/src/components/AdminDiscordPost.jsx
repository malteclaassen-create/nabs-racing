import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { CardHead, ErrorBox, Notice } from "./ui.jsx";
import { useAsk } from "./overlay.jsx";
import { countryFor } from "../data/driverCountries.js";
import SlidingTabs from "./SlidingTabs.jsx";
import DiscordPreview from "./DiscordPreview.jsx";
import {
  renderPosterBlob, renderPosterTo, renderStandingsTo, renderStandingsBlobs,
  renderConstructorsTo, renderConstructorsBlob,
  savedTheme, THEMES, THEME_KEYS,
  savedStandingsSetup, standingsPageCount, standingsTitle, standingsSubtitle, constructorsTitle,
  upToRoundOf, filterStandings,
} from "../utils/resultGraphic.js";

// ---------------------------------------------------------------------------
// The "#results" message for a round: generated from the saved result, edited
// if you like, then copied or posted straight to the results-channel webhook.
//
// Two lengths, because the week the poster goes with it is a different message
// from the week it does not:
//
//   Full   every driver, the DNFs, and the stats block. What the channel got
//          before there was a picture.
//   Short  the round, the podium, a link. The poster underneath already lists
//          the top ten, so the long version prints the same table twice.
//
// Both are kept and edited independently, so flipping between them to compare
// does not cost you whichever one you had been writing.
//
// Built from what is STORED. A classification still open in the results editor
// is not in here yet, which is the one thing worth knowing before pressing
// generate.
// ---------------------------------------------------------------------------

// What is being posted. Both go to the same channel with the same webhook, the
// same two lengths and the same preview, so they are one control here rather
// than a second copy of this page somewhere else — the thing an admin looks for
// is "post to Discord", not "post the standings to Discord".
const KINDS = [
  { key: "result", label: "Race result" },
  { key: "standings", label: "Standings" },
];

const LENGTHS = [
  { key: "short", label: "Short" },
  { key: "full", label: "Full" },
];

// The poster designs, plus the option of not sending one. "none" is a real
// choice rather than an unticked box: it sits in the same control as the two
// designs because it is the same decision — which picture goes out.
const GRAPHICS = [...THEME_KEYS.map((k) => ({ key: k, label: THEMES[k].label })), { key: "none", label: "No image" }];

// `artVersion` is bumped by the Content area whenever a car, a logo or a
// driver's flag is changed in the Graphic half. This half draws its OWN copy of
// the poster, so without that signal it would keep sending the version from
// before the fix.
export default function AdminDiscordPost({ raceId, race = null, artVersion = 0 }) {
  const ask = useAsk();
  const { data: hook, reload: reloadHook } = useApi(useCallback(() => api.getResultsWebhook(), []));
  const { data: role, reload: reloadRole } = useApi(useCallback(() => api.getResultsRole(), []));
  const [roleInput, setRoleInput] = useState("");
  const [kind, setKind] = useState("result");
  // Both drafts, edited separately. `null` until generated.
  const [drafts, setDrafts] = useState(null);
  const [mentions, setMentions] = useState({});
  const [length, setLength] = useState("short");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  // Which poster goes with it. Starts on whatever design is showing under
  // Graphic, so the two halves of the tab agree the moment you arrive.
  const [graphic, setGraphic] = useState(savedTheme);
  // Everything the poster is drawn from, loaded once per round so the preview
  // can redraw on a design change without going back to the network.
  const [source, setSource] = useState(null);

  const text = drafts?.[length] ?? "";
  const setText = (v) => setDrafts((d) => ({ ...d, [length]: v }));

  // A different round, or a different thing to post, starts from a clean slate:
  // a standings draft left in the box while the switch says "race result" is
  // the wrong message one click from going out.
  useEffect(() => {
    setDrafts(null);
    setMentions({});
    setMsg(null);
    setError(null);
  }, [raceId, kind]);

  // The round the table is frozen after. The same number the Standings tab
  // draws from, worked out by the same function, so the heading and the sheets
  // cannot disagree about which week this is.
  const upTo = upToRoundOf(race);

  const loadSource = useCallback(async () => {
    const [r, teamArt, framing, standings, t1, t2] = await Promise.all([
      api.raceResults(raceId),
      api.teamArt(),
      api.posterFraming(),
      // Only for the standings mode, but fetched either way: they are small
      // reads, and having them in hand means switching modes redraws instead of
      // showing an empty preview while the network catches up.
      api.driverStandings(undefined, upTo).catch(() => null),
      api.t1Standings(undefined, upTo).catch(() => null),
      api.t2Standings(undefined, upTo).catch(() => null),
    ]);
    return {
      race: r.race,
      results: r.results,
      teamArt,
      framing,
      standings: standings?.standings || [],
      t1: t1?.standings || [],
      t2: t2?.standings || [],
    };
  }, [raceId, upTo]);

  useEffect(() => {
    if (!raceId) return;
    let alive = true;
    loadSource()
      .then((next) => alive && setSource(next))
      .catch(() => alive && setSource(null));
    return () => {
      alive = false;
    };
  }, [raceId, loadSource, artVersion]);

  // What renderPosterTo / renderPosterBlob need. One object, used by the
  // preview and by the post, so the picture in the preview and the picture in
  // the channel cannot be drawn from different things.
  const posterFrom = useCallback(
    (src) =>
      graphic === "none" || !src
        ? null
        : {
            race: src.race,
            results: src.results,
            teamArt: src.teamArt,
            framing: src.framing,
            countryOf: (r) => countryFor(r.driverId, r.country),
            logoSrc: "/logo-light.png",
            theme: graphic,
          },
    [graphic]
  );

  // How many drivers to a sheet and which group the table is of are NOT asked
  // again here: they are set next door under Standings, by looking at the
  // picture, and read back from there. Two places to set them is two answers,
  // and the channel would get whichever one was touched last. Re-read on
  // `artVersion`, which the Standings half bumps whenever either changes.
  const [{ kind: tableKind, perPage, tier, withoutStarts, t1Rows, t2Rows }, setSetup] = useState(savedStandingsSetup);
  const teamsTable = tableKind === "constructors";
  useEffect(() => setSetup(savedStandingsSetup()), [artVersion]);

  // And the same for the table.
  const standingsRows = useMemo(
    () => filterStandings(source?.standings || [], tier, { withoutStarts }),
    [source, tier, withoutStarts]
  );

  const standingsFrom = useCallback(
    (src) => {
      if (graphic === "none" || !src) return null;
      if (teamsTable) {
        if (!src.t1?.length && !src.t2?.length) return null;
        return {
          t1: src.t1,
          t2: src.t2,
          teamArt: src.teamArt,
          logoSrc: "/logo-light.png",
          title: constructorsTitle(),
          subtitle: standingsSubtitle(upTo),
          t1Rows,
          t2Rows,
          framing: src.framing,
          theme: graphic,
        };
      }
      const rows = filterStandings(src.standings || [], tier, { withoutStarts });
      return rows.length
        ? {
            standings: rows,
            teamArt: src.teamArt,
            countryOf: (r) => countryFor(r.driverId, r.country),
            logoSrc: "/logo-light.png",
            title: standingsTitle(tier),
            subtitle: standingsSubtitle(upTo),
            framing: src.framing,
            theme: graphic,
          }
        : null;
    },
    [graphic, upTo, tier, withoutStarts, teamsTable, t1Rows, t2Rows]
  );

  const sheetCount = teamsTable ? 1 : standingsPageCount(standingsRows.length, perPage);
  // Which sheets go out. All of them to start with, because that is the whole
  // table and the usual answer; unticking one is how you post only the top ten
  // of a field of twenty.
  const [sheets, setSheets] = useState([]);
  useEffect(() => {
    setSheets(Array.from({ length: sheetCount }, (_, i) => i));
  }, [sheetCount, tier, teamsTable]);
  const chosen = useMemo(() => [...sheets].sort((a, b) => a - b), [sheets]);

  // Exactly the files that will be attached, drawn by the functions that draw
  // them for real.
  const attachments = useMemo(() => {
    if (kind === "result") {
      const poster = posterFrom(source);
      return poster ? [{ id: `result-${graphic}`, draw: (c) => renderPosterTo(c, poster) }] : [];
    }
    const opts = standingsFrom(source);
    if (!opts) return [];
    if (teamsTable) return [{ id: `constructors-${graphic}`, draw: (c) => renderConstructorsTo(c, opts) }];
    return chosen.map((p) => ({
      id: `standings-${graphic}-${p}`,
      draw: (c) => renderStandingsTo(c, { ...opts, rows: perPage, offset: p * perPage }),
    }));
  }, [kind, source, posterFrom, standingsFrom, graphic, perPage, chosen, teamsTable]);

  async function run(fn, doneMsg) {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (doneMsg) setMsg(doneMsg);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const generate = () =>
    run(async () => {
      const r =
        kind === "result"
          ? await api.getResultsPost(raceId)
          : await api.getStandingsPost(
              upTo,
              teamsTable ? { of: "constructors", t1Rows, t2Rows } : { tier, withoutStarts }
            );
      setDrafts({ full: r.text || "", short: r.short || "" });
      setMentions(r.mentions || {});
    });

  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(text);
    }, "Copied. Paste it into Discord.");

  const post = async () => {
    const shots = attachments.length;
    if (
      !(await ask({
        title: "Post this message to the results channel?",
        body: shots
          ? `Mentioned drivers get pinged, and ${shots > 1 ? `the ${shots} sheets below go` : "the graphic below goes"} with it.`
          : "Mentioned drivers get pinged. No graphic is attached.",
        confirmLabel: "Post to Discord",
      }))
    )
      return;
    run(async () => {
      // Drawn from data fetched RIGHT NOW, not from what was loaded when the
      // round was picked. The alternative is posting last hour's artwork
      // because somebody uploaded a car in between, and a Discord message
      // cannot be edited from here once it is out.
      const fresh = await loadSource();
      setSource(fresh);
      const r =
        kind === "result"
          ? await api.sendResultsPost(raceId, text, graphic === "none" ? null : await renderPosterBlob(posterFrom(fresh)))
          : await api.sendStandingsPost(
              text,
              graphic === "none"
                ? []
                : teamsTable
                  ? [await renderConstructorsBlob(standingsFrom(fresh))]
                  : await renderStandingsBlobs(standingsFrom(fresh), { perPage, pages: chosen })
            );
      const how = r.messages > 1 ? `as ${r.messages} messages (Discord length limit)` : "";
      const withPics =
        r.attached > 1 ? `, ${r.attached} sheets attached.` : r.attached ? ", graphic attached." : ".";
      setMsg(`Posted to Discord${how ? ` ${how}` : ""}${withPics}`);
    });
  };

  const saveHook = () =>
    run(async () => {
      await api.setResultsWebhook(url.trim());
      setUrl("");
      reloadHook();
    }, "Results webhook saved.");

  // Clearing only stops the "Post to Discord" button; Copy keeps working. The
  // URL itself stays usable in Discord until it's deleted there too.
  const removeHook = async () => {
    if (
      !(await ask({
        title: "Remove the saved results webhook?",
        body: "Posting from here stops until a new one is saved. (To fully revoke the URL, also delete the webhook in Discord.)",
        danger: true,
        confirmLabel: "Remove webhook",
      }))
    )
      return;
    run(async () => {
      await api.setResultsWebhook("");
      reloadHook();
    }, "Results webhook removed.");
  };

  return (
    <div className="card space-y-3 p-4">
      <CardHead eyebrow="Discord" title="Results post" />
      {error && <ErrorBox message={error} />}
      {msg && <Notice kind="success">{msg}</Notice>}

      {/* First: which of the two posts this is. Above the drafts, because it
          decides what they say. */}
      <label className="flex items-center gap-2.5">
        <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Post</span>
        <SlidingTabs items={KINDS} value={kind} onChange={setKind} btnClassName="px-3.5 py-1.5 text-xs" />
      </label>

      {!drafts ? (
        <>
          <p className="text-sm text-light">
            {kind === "result"
              ? "Built from the saved result, so save any open edits in Edit Results first."
              : `Built from the ${(teamsTable ? constructorsTitle() : standingsTitle(tier)).toLowerCase()}${upTo ? ` as they stood after round ${upTo}` : ""}. Which table and who is on it are set under Standings.`}{" "}
            You get both lengths and a preview of the message as the channel will see it.
            {role?.roleId
              ? " The drivers' role is pinged on the first line; delete that line if a round should go out quietly."
              : " Add the drivers' role below and it will be pinged on the first line."}
          </p>
          <button className="btn-secondary" disabled={busy} onClick={generate}>
            {busy ? "Building…" : "Generate message"}
          </button>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Length</span>
              <SlidingTabs items={LENGTHS} value={length} onChange={setLength} btnClassName="px-3.5 py-1.5 text-xs" />
            </label>
            <label className="flex items-center gap-2.5">
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Image</span>
              <SlidingTabs items={GRAPHICS} value={graphic} onChange={setGraphic} btnClassName="px-3.5 py-1.5 text-xs" />
            </label>

            {/* Which sheets of a long table go out. Only where there is more
                than one and a picture is going at all — otherwise this is a
                control over nothing. Posting places 1 to 10 and keeping the
                rest back is a normal week, so every sheet can be unticked
                except that the button below stops you sending none of them
                with nothing else attached either. */}
            {kind === "standings" && graphic !== "none" && sheetCount > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-light">Sheets</span>
                {Array.from({ length: sheetCount }, (_, p) => {
                  const on = sheets.includes(p);
                  const a = p * perPage + 1;
                  const b = Math.min((p + 1) * perPage, standingsRows.length);
                  return (
                    <button
                      key={p}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setSheets(on ? sheets.filter((n) => n !== p) : [...sheets, p])}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                        on ? "border-link text-dark" : "border-border text-faint hover:border-link"
                      }`}
                    >
                      {a}&ndash;{b}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <textarea
                aria-label="Results message"
                className="input min-h-72 w-full font-mono text-xs leading-relaxed"
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-light">
                The &lt;@…&gt; codes turn into real @mentions once the message lands in Discord. Custom server emojis
                can be added as :emoji_name: if the webhook&rsquo;s server has them.
              </p>
            </div>
            <DiscordPreview
              text={text}
              mentions={mentions}
              attachments={attachments}
              when="Today"
              roleName="Drivers"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || !hook?.configured || !text.trim()} onClick={post}>
              {busy ? "Posting…" : "Post to Discord"}
            </button>
            <button className="btn-secondary" disabled={busy || !text.trim()} onClick={copy}>
              Copy
            </button>
            <button className="btn-secondary" disabled={busy} onClick={generate}>
              Regenerate
            </button>
          </div>
        </>
      )}

      <div className="rounded-lg bg-surface2 p-3">
        <div className="text-sm">
          Results channel webhook:{" "}
          {hook?.configured ? (
            <span className="font-semibold text-ok">connected ({hook.preview})</span>
          ) : (
            <span className="font-semibold text-light">not connected (copy still works)</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            aria-label="Results channel webhook URL"
            className="input max-w-md flex-1"
            placeholder="https://discord.com/api/webhooks/… (the #results channel)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button className="btn-secondary" disabled={busy || !url.trim()} onClick={saveHook}>
            Save webhook
          </button>
          {hook?.configured && (
            <button className="btn-secondary" disabled={busy} onClick={removeHook}>
              Remove
            </button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-light">
          Separate from the events webhook, so results land in their own channel. Discord channel &rarr; Edit
          Channel &rarr; Integrations &rarr; Webhooks.
        </p>

        {/* The role ping. One line at the top of the message notifies the whole
            grid, instead of only the twenty people named in it. */}
        <div className="mt-3 border-t border-border pt-3">
          <div className="text-sm">
            Drivers&rsquo; role:{" "}
            {role?.roleId ? (
              <span className="font-semibold text-ok">pinged (ID {role.roleId})</span>
            ) : (
              <span className="font-semibold text-light">not set (nobody is notified as a group)</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              aria-label="Drivers' Discord role ID"
              className="input max-w-md flex-1 font-mono text-sm"
              placeholder="Role ID, e.g. 1109397717320478761"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
            />
            <button
              className="btn-secondary"
              disabled={busy || !roleInput.trim()}
              onClick={() =>
                run(async () => {
                  await api.setResultsRole(roleInput.trim());
                  setRoleInput("");
                  reloadRole();
                }, "Role saved. Generate the message again to see the ping.")
              }
            >
              Save role
            </button>
            {role?.roleId && (
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.setResultsRole("");
                    reloadRole();
                  }, "Role removed. Results posts no longer ping the grid.")
                }
              >
                Remove
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-light">
            In Discord: Server Settings &rarr; Roles &rarr; right-click the role &rarr; Copy Role ID (needs
            Developer Mode under Settings &rarr; Advanced). The role&rsquo;s NAME does not ping, only its ID.
          </p>
        </div>
      </div>
    </div>
  );
}

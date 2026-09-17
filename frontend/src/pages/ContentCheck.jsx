import { useCallback, useMemo, useRef, useState } from "react";
import { PageHeader, ErrorBox, Notice, CardHead } from "../components/ui.jsx";
import { useApi } from "../hooks/useApi.js";
import { api } from "../api/client.js";
import { md5File } from "../utils/md5.js";
import { canPickFolder, pickAcFolder, readerFromDrop } from "../utils/acFolder.js";

// ---------------------------------------------------------------------------
// /content-check — "Checksum failed. You have been kicked out of the race."
//
// The game kicks on a hash: the server names the files it checksums and their
// MD5, the client hashes its own copies, one mismatch and you are out. This
// page makes that same comparison visible instead of leaving a driver to
// reinstall things at random.
//
// The right-hand side of the comparison comes from the RACE SERVER ITSELF
// (/api/content-check reads the server's own copies), so "correct" is not a
// guess about which version the mod drive ought to hold — it is what the
// server will compare against tonight.
//
// The driver's files never leave their machine: the folder is read in the
// browser, hashed in the browser, and only the verdict is drawn on screen.
// Deliberately reachable without a login — somebody who has just been kicked
// is exactly the person who should not have to sign in first.
// ---------------------------------------------------------------------------

const STATUS = {
  ok: { label: "passt", cls: "bg-emerald-500/15 text-ok" },
  diff: { label: "falsche Version", cls: "bg-red-500/15 text-bad" },
  missing: { label: "fehlt", cls: "bg-red-500/15 text-bad" },
  unpacked: { label: "entpackte Daten", cls: "bg-amber-500/15 text-warn" },
  skipped: { label: "nicht prüfbar", cls: "bg-surface2 text-light" },
};

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.skipped;
  return <span className={`pill shrink-0 ${s.cls}`}>{s.label}</span>;
}

// One line per file, in the order the check ran.
function ResultRow({ row }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
      <StatusPill status={row.status} />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-dark">{row.label}</span>
        <span className="ml-2 break-all font-mono text-[11px] text-light">{row.path}</span>
      </span>
      {row.detail && <span className="w-full text-xs text-medium sm:w-auto">{row.detail}</span>}
    </li>
  );
}

export default function ContentCheck() {
  const [serverKey, setServerKey] = useState(null);
  const fetcher = useCallback(() => api.contentCheck(serverKey), [serverKey]);
  const { data, loading, error, reload } = useApi(fetcher);

  const [rows, setRows] = useState(null); // null = not checked yet
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null); // something stopped the check itself
  const [folderName, setFolderName] = useState(null);
  const [dragging, setDragging] = useState(false);
  const copyRef = useRef(null);

  // Only the files this session's join actually hashes. The manifest also
  // carries a layout track's ROOT surfaces.ini (inPlay: false) for the admin
  // view — the game never looks at it for a layout session, so a difference
  // there would be a false alarm, and a false alarm is the one thing this page
  // must never raise. It is left out of the check entirely.
  const inPlay = useMemo(() => (data?.files || []).filter((f) => f.inPlay !== false), [data]);
  // Of those, the ones the server actually has a hash for. A file the server
  // does not serve cannot be compared, and saying so is better than a green
  // tick that means nothing.
  const checkable = useMemo(() => inPlay.filter((f) => f.md5), [inPlay]);

  async function runCheck(reader) {
    if (!reader) {
      setProblem("Das war kein Ordner. Zieh den Ordner assettocorsa (oder content) auf die Fläche.");
      return;
    }
    setBusy(true);
    setProblem(null);
    setFolderName(reader.name || null);
    try {
      const out = [];
      for (const file of inPlay) {
        if (!file.md5) {
          out.push({
            ...file,
            status: "skipped",
            detail: file.error ? `Server: ${file.error}` : "Der Server hat diese Datei nicht",
          });
          continue;
        }
        const local = await reader.getFile(file.path);
        if (!local) {
          out.push({ ...file, status: "missing", detail: "Nicht in deiner Installation gefunden" });
        } else {
          const hash = await md5File(local);
          out.push(
            hash === file.md5
              ? { ...file, status: "ok", detail: null }
              : {
                  ...file,
                  status: "diff",
                  detail: `deine ${hash.slice(0, 8)}… · Server ${file.md5.slice(0, 8)}…`,
                }
          );
        }
        // An unpacked data/ folder beside the .acd is read by the game INSTEAD
        // of the .acd, so the hash can be perfect and the join still fail.
        // This is the single most common cause after a wrong version.
        if (file.unpackedDir && (await reader.hasDir(file.unpackedDir))) {
          out.push({
            kind: file.kind,
            label: file.label,
            path: file.unpackedDir,
            status: "unpacked",
            detail: "Diesen Ordner löschen — er übersteuert die data.acd",
          });
        }
      }
      setRows(out);
    } catch (e) {
      setProblem(e?.message || "Der Ordner konnte nicht gelesen werden.");
    } finally {
      setBusy(false);
    }
  }

  async function onPick() {
    try {
      await runCheck(await pickAcFolder());
    } catch (e) {
      // The picker throws when the dialog is dismissed — not worth a message.
      if (e?.name !== "AbortError") setProblem(e?.message || "Der Ordner konnte nicht geöffnet werden.");
    }
  }

  async function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    await runCheck(await readerFromDrop(e.dataTransfer));
  }

  const bad = (rows || []).filter((r) => r.status === "diff" || r.status === "missing" || r.status === "unpacked");
  const skipped = (rows || []).filter((r) => r.status === "skipped");

  // What a driver pastes back into Discord, so the answer there is a file name
  // instead of "geht nicht".
  const report = useMemo(() => {
    if (!rows) return "";
    const head = `NABS Content Check · ${data?.server?.name || ""} · ${data?.track || "?"}${data?.config ? ` (${data.config})` : ""}`;
    if (!bad.length) {
      return `${head}\nAlles korrekt (${rows.length - skipped.length} Dateien geprüft).`;
    }
    return [head, ...bad.map((r) => `${STATUS[r.status].label.toUpperCase()}: ${r.path}${r.detail ? ` — ${r.detail}` : ""}`)].join("\n");
  }, [rows, bad, skipped.length, data]);

  function copyReport() {
    navigator.clipboard?.writeText(report).then(
      () => {
        if (copyRef.current) {
          copyRef.current.textContent = "Kopiert";
          setTimeout(() => copyRef.current && (copyRef.current.textContent = "Für Discord kopieren"), 2000);
        }
      },
      () => setProblem("Kopieren hat nicht geklappt — markier den Text oben von Hand.")
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow="Assetto Corsa"
        title="Content Check"
        subtitle="Vom Server geflogen mit „Checksum failed“? Diese Seite vergleicht deine Dateien mit denen des Race-Servers und sagt dir, welche nicht stimmt."
      />

      {error && <ErrorBox message={error} onRetry={reload} title="Der Race-Server antwortet gerade nicht" />}

      {!error && (
        <div className="space-y-5">
          {/* What is being checked, and where the list comes from. */}
          <div className="card p-5">
            <CardHead eyebrow="Geprüft wird" title={loading ? "Wird geladen…" : data?.track || "Keine Session gefunden"}>
              {(data?.servers?.length || 0) > 1 && (
                <select
                  className="input py-1 text-xs"
                  value={data?.server?.key || ""}
                  onChange={(e) => {
                    setRows(null);
                    setServerKey(e.target.value);
                  }}
                  aria-label="Race-Server"
                >
                  {data.servers.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </CardHead>
            {data?.session ? (
              <p className="text-sm text-medium">
                Die Liste stammt aus der letzten Session auf {data.server?.name}
                {data.config && <> · Layout <span className="font-mono text-xs">{data.config}</span></>} ·{" "}
                {checkable.length} Datei{checkable.length === 1 ? "" : "en"} mit Server-Hash
                {data.carCount > 0 && <> · {data.carCount} Auto{data.carCount === 1 ? "" : "s"}</>}.
              </p>
            ) : (
              !loading && (
                <p className="text-sm text-medium">
                  {data?.note || "Auf diesem Server liegt noch keine Session, aus der sich die Autoliste lesen lässt."}
                </p>
              )
            )}
          </div>

          {/* The one action on the page. */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`card flex flex-col items-center gap-3 border-2 border-dashed p-8 text-center transition ${
              dragging ? "border-brand bg-surface2" : "border-border"
            }`}
          >
            <p className="text-sm font-semibold text-dark">
              {canPickFolder() ? "Wähle deinen Ordner assettocorsa" : "Zieh deinen Ordner assettocorsa hierher"}
            </p>
            <p className="max-w-md text-xs text-light">
              Typisch <span className="font-mono">C:\Program Files (x86)\Steam\steamapps\common\assettocorsa</span>. Der
              Ordner <span className="font-mono">content</span> tut es auch. Es werden nur die {checkable.length} Dateien
              oben gelesen — nichts wird hochgeladen.
            </p>
            {canPickFolder() ? (
              <button className="btn-primary px-5" disabled={busy || !checkable.length} onClick={onPick}>
                {busy ? "Prüfe…" : "Ordner auswählen"}
              </button>
            ) : (
              <p className="text-xs text-medium">
                {busy ? "Prüfe…" : "In Chrome oder Edge gibt es hier einen Knopf statt Ziehen und Ablegen."}
              </p>
            )}
            {folderName && !busy && <p className="text-xs text-faint">Gelesen: {folderName}</p>}
          </div>

          {problem && <Notice kind="error">{problem}</Notice>}

          {/* The verdict. */}
          {rows && (
            <div className="card p-5">
              <CardHead
                eyebrow="Ergebnis"
                title={bad.length === 0 ? "Alles korrekt" : `${bad.length} Problem${bad.length === 1 ? "" : "e"} gefunden`}
              >
                <button ref={copyRef} className="btn-secondary px-3 py-1 text-xs" onClick={copyReport}>
                  Für Discord kopieren
                </button>
              </CardHead>
              {bad.length === 0 ? (
                <Notice kind="success">
                  Deine Dateien sind identisch mit denen des Servers. Wenn du trotzdem gekickt wirst, liegt es nicht an
                  diesen Dateien — schick den Screenshot der Fehlermeldung in den Discord.
                </Notice>
              ) : (
                <Notice kind="warn">
                  Genau diese Dateien weichen vom Server ab. Zieh sie neu aus dem Mod-Drive (oder lösch den entpackten
                  Ordner) und prüfe noch einmal.
                </Notice>
              )}
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {rows.map((r, i) => (
                  <ResultRow key={`${r.path}-${i}`} row={r} />
                ))}
              </ul>
              {skipped.length > 0 && (
                <p className="mt-3 text-xs text-light">
                  {skipped.length} Datei{skipped.length === 1 ? "" : "en"} ohne Server-Hash konnte{skipped.length === 1 ? "" : "n"}{" "}
                  nicht verglichen werden.
                </p>
              )}
            </div>
          )}

          {/* Said plainly rather than buried: this check is not everything. */}
          <div className="card p-5 text-xs leading-relaxed text-light">
            <p>
              <b className="text-medium">Was geprüft wird:</b> die <span className="font-mono">data.acd</span> jedes Autos
              der Session und die <span className="font-mono">surfaces.ini</span> der Strecke — die Dateien, auf denen der
              Checksum-Kick beruht. Die Hashes kommen vom Race-Server selbst, nicht aus einer gepflegten Liste.
            </p>
            <p className="mt-2">
              <b className="text-medium">Was nicht:</b> die 3D-Modelle (<span className="font-mono">.kn5</span>) — die gibt
              der Server nicht heraus. Und alles, was kein Checksum-Fehler ist: CSP-Version, Passwort, voller Server. Die
              melden sich mit einer anderen Meldung.
            </p>
            <p className="mt-2">
              <b className="text-medium">Deine Dateien bleiben bei dir.</b> Gelesen und gehasht wird im Browser; zum Server
              geht nichts.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

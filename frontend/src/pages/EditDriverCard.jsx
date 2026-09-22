import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner, ErrorBox, PageHeader, Skeleton } from "../components/ui.jsx";
import { CardPhotoEditor, CardEditionPicker } from "../components/CardEditor.jsx";
import { useSeries } from "../context/SeriesContext.jsx";
import { cardRowFor } from "./viewedLeague.mjs";

// ---------------------------------------------------------------------------
// /profile/card — a focused page to edit ONLY the driver's rating card: pick an
// unlocked edition, set the card picture and its framing, tune the two photo
// sliders, and switch the card animation on/off. Everything self-saves on
// interaction (like the old in-profile controls did), so there's no page Save.
// ---------------------------------------------------------------------------

function BackLink() {
  return (
    <Link to="/profile" className="btn-secondary inline-flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" />
      </svg>
      Back to profile
    </Link>
  );
}

// `startId` is the row the page was sent to (?driver= from the Personal Area's
// "Edit driver card" button). Without one the page picks the row itself, from
// the series the site is viewing — see the auto-pick effect below.
function CardEditor({ me, reload, startId = null }) {
  const [error, setError] = useState(null);
  // `current` rather than `slug`: this page sits outside the /s/<slug> URLs
  // too, so on a cold load there is no slug while the header still names a
  // series (the same reason the Personal Area reads it this way).
  const { current: viewedSeries } = useSeries();

  // Rating (for the numbers on the preview). Safety-car drivers get a card even
  // without a rating payload; everyone else needs to have raced.
  const ratingRes = useApi(useCallback(() => api.driverRating(me.driverId).catch(() => null), [me.driverId]));

  // Edition picker: per-season-row, self-saving on pick.
  const [meCardStyle, setMeCardStyle] = useState(me.cardStyle || "classic");
  const [cardSeasons, setCardSeasons] = useState([]);
  const [pickerDriverId, setPickerDriverId] = useState(startId || me.driverId);
  const [editionsByDriver, setEditionsByDriver] = useState({});
  const [editionsLoading, setEditionsLoading] = useState(true);
  const [savedByDriver, setSavedByDriver] = useState({});

  // The season chips AND what each row has set for itself. Re-read after a
  // picture write, because that is exactly what it changes.
  const loadSeasons = useCallback(
    () => api.myCardSeasons().then((d) => setCardSeasons(d?.seasons || [])).catch(() => {}),
    []
  );
  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  // Open on the card of the league the site is VIEWING, not on the row the
  // Discord login happens to sit on: somebody on the Sunday pages who comes
  // here to restyle "their card" means their Sunday one. Once only — the chips
  // are re-read after every picture write, and a later run would drag the
  // member back off the chip they picked by hand.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (startId || autoPicked.current || !cardSeasons.length) return;
    autoPicked.current = true;
    setPickerDriverId(cardRowFor(cardSeasons, viewedSeries?.slug || null, me.driverId));
  }, [cardSeasons, viewedSeries, startId, me.driverId]);

  useEffect(() => {
    if (editionsByDriver[pickerDriverId]) { setEditionsLoading(false); return; }
    let alive = true;
    setEditionsLoading(true);
    api
      .myCardEditions(pickerDriverId === me.driverId ? undefined : pickerDriverId)
      .then((d) => alive && setEditionsByDriver((m) => ({ ...m, [pickerDriverId]: d?.editions || [] })))
      .catch(() => {})
      .finally(() => alive && setEditionsLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerDriverId]);

  // Preview data for an OLD season row (a picker chip other than the current
  // one): that row's public profile + rating, fetched once and cached, so the
  // card on the left shows THAT season's card while you restyle it.
  //
  // The cache entry is a DEPENDENCY, not something read past the deps list: a
  // picture write drops what is cached (it can change what every other row
  // shows), and the row on screen has to come back on its own. Depending only
  // on the chip id left the dropped row with nothing to render and nothing to
  // fetch it — the editor fell to a skeleton and stayed there until you clicked
  // another chip and back.
  const isMe = pickerDriverId === me.driverId;
  const [previewByDriver, setPreviewByDriver] = useState({});
  const rowPreview = previewByDriver[pickerDriverId];
  useEffect(() => {
    if (isMe || rowPreview) return;
    let alive = true;
    Promise.all([
      api.driverProfile(pickerDriverId),
      api.driverRating(pickerDriverId).catch(() => null),
    ])
      .then(([prof, rating]) => {
        if (alive) setPreviewByDriver((m) => ({ ...m, [pickerDriverId]: { driver: prof.driver, rating } }));
      })
      .catch((err) => alive && setError(err.message));
    return () => { alive = false; };
  }, [pickerDriverId, isMe, rowPreview]);

  const styleOf = (id) => {
    if (id === me.driverId) return meCardStyle;
    if (savedByDriver[id] != null) return savedByDriver[id];
    return cardSeasons.find((s) => s.driverId === id)?.cardStyle || "classic";
  };

  // --- Per-row picture / framing / animation editing -----------------------
  // EVERY season row is fully editable, not just the current one: the stored
  // values come from `me` (current row) or the fetched preview (old rows), and
  // local overlays keyed by row id carry edits until they self-save.
  //
  // Two different questions, and the page needs both answers:
  //
  //   `stored` — what the card SHOWS. A row that has dressed itself shows its
  //     own picture and framing; a row that never has follows the person's
  //     newest (lib/cardPhoto cardPictureFor). This is what the preview draws.
  //   `own`    — what this row has SET, null where it is only following along.
  //     This is what the reset buttons act on, so it is what decides whether
  //     they are offered at all.
  //
  // They were treated as one value, from whichever endpoint happened to answer
  // — the current row got its OWN values and old rows got their EFFECTIVE ones
  // — so each was wrong in the other's direction: an old row offered "Use
  // profile picture" for a picture it had never set, and the current row drew
  // the profile photo over a card that goes on inheriting one.
  const stored = isMe
    ? {
        // Where `cardShows` exists it is the whole answer, a null picture
        // included; falling through on null would show one this row has not.
        photoPos: (me.cardShows ? me.cardShows.photoPos : me.photoPos) ?? null,
        cardPhotoUrl: (me.cardShows ? me.cardShows.cardPhotoUrl : me.cardPhotoUrl) ?? null,
        cardAnim: me.cardAnim ?? null,
      }
    : rowPreview
    ? {
        photoPos: rowPreview.driver.photoPos || null,
        cardPhotoUrl: rowPreview.driver.cardPhotoUrl || null,
        cardAnim: rowPreview.driver.cardAnim ?? null,
      }
    : null;
  // The row's own, from the one endpoint that reads the columns raw.
  const ownRow = cardSeasons.find((s) => s.driverId === pickerDriverId) || null;
  // A row missing from the chips (a private season has none) falls back to
  // what is on screen, which is how the page behaved before it knew better.
  const ownPhoto = ownRow ? ownRow.ownCardPhotoUrl : stored?.cardPhotoUrl ?? null;
  const ownPos = ownRow ? ownRow.ownPhotoPos : stored?.photoPos ?? null;

  const [posByRow, setPosByRow] = useState({}); // row id -> framing overlay
  const [photoByRow, setPhotoByRow] = useState({}); // row id -> card picture overlay
  const [animByRow, setAnimByRow] = useState({}); // row id -> "off" | null overlay
  const [posEdit, setPosEdit] = useState(null); // { id, pos } debounced save
  // The newest framing change, by identity. A save that is already in flight
  // when the member moves the picture again must not put its own values back
  // on screen when it lands.
  const latestPos = useRef(null);
  const [posState, setPosState] = useState("idle"); // idle | saving | saved
  const [cardUploading, setCardUploading] = useState(false);
  const rowMeta = ownRow;

  const photoPos = posByRow[pickerDriverId] !== undefined ? posByRow[pickerDriverId] : stored?.photoPos ?? null;
  const cardPhotoUrl =
    photoByRow[pickerDriverId] !== undefined ? photoByRow[pickerDriverId] : stored?.cardPhotoUrl ?? null;
  const cardAnim =
    (animByRow[pickerDriverId] !== undefined ? animByRow[pickerDriverId] : stored?.cardAnim) === "off"
      ? "off"
      : null;
  // Has this row anything of ITS OWN to reset? An unsaved overlay is the truth
  // until the refetch lands, the stored own value after that.
  const hasOwnPhoto = photoByRow[pickerDriverId] !== undefined ? !!photoByRow[pickerDriverId] : !!ownPhoto;
  const hasOwnPos = posByRow[pickerDriverId] !== undefined ? !!posByRow[pickerDriverId] : !!ownPos;

  // Framing auto-saves shortly after the last change. The pending edit carries
  // its OWN row id, so switching season chips mid-debounce still saves to the
  // row that was edited.
  useEffect(() => {
    if (!posEdit) return;
    const t = setTimeout(async () => {
      setPosState("saving");
      try {
        const res = await api.setMyCardPhoto(posEdit.pos, posEdit.id === me.driverId ? undefined : posEdit.id);
        // Only the save that is still the newest may write back. The timer is
        // cancelled on every change, but one already past it cannot be: it
        // would land a moment later and drag the zoom back to where it was
        // before the member carried on adjusting.
        if (latestPos.current !== posEdit) return;
        setPosByRow((m) => ({ ...m, [posEdit.id]: res.photoPos }));
        latestPos.current = null;
        setPosEdit(null);
        setPosState("saved");
      } catch (err) {
        setError(err.message);
        setPosState("idle");
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posEdit]);

  // "Framing saved" is a confirmation, not a state the page sits in: without
  // this it was set once and never cleared, so the note stayed under the card
  // for the rest of the visit.
  useEffect(() => {
    if (posState !== "saved") return;
    const t = setTimeout(() => setPosState("idle"), 2500);
    return () => clearTimeout(t);
  }, [posState]);

  // A picture or framing write lands on ONE row, but it changes what the OTHERS
  // show: a card nobody ever dressed follows the person's newest picture, and a
  // card just cleared falls back to whatever they carry (lib/cardPhoto
  // cardPictureFor). Which picture that turns out to be is the server's answer,
  // not one this page can work out, so every cached picture is dropped and the
  // row on screen is fetched again.
  //
  // `keepPhoto` is the one thing a write already knows for certain: the URL an
  // upload just returned, shown at once rather than after the round trip.
  // CLEARING passes nothing on purpose — drawing the profile photo there would
  // claim the card has no picture, when what it really does is go back to the
  // one the person carries.
  function forgetPictures(id, keepPhoto = undefined) {
    setPreviewByDriver({});
    setPosByRow({});
    setPhotoByRow(keepPhoto === undefined ? {} : { [id]: keepPhoto });
    latestPos.current = null;
    setPosEdit(null);
    setPosState("idle");
    reload(); // what the current row's card now shows rides on `me`
    loadSeasons(); // what each row has set of its own
  }

  function editPos(p) {
    const id = pickerDriverId;
    const edit = { id, pos: p };
    latestPos.current = edit;
    setPosByRow((m) => ({ ...m, [id]: p }));
    setPosEdit(edit);
  }

  async function resetCardPhoto() {
    const id = pickerDriverId;
    setError(null);
    try {
      await api.setMyCardPhoto(null, isMe ? undefined : id);
      // The row holds no framing of its own now, so what it shows is what it
      // inherits — fetched, not assumed to be the default.
      forgetPictures(id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function onPickCardPhoto(e) {
    const id = pickerDriverId;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setCardUploading(true);
    try {
      const res = await api.uploadMyCardPhoto(file, isMe ? undefined : id);
      forgetPictures(id, res.cardPhotoUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setCardUploading(false);
    }
  }

  async function resetCardPhotoImage() {
    const id = pickerDriverId;
    setError(null);
    setCardUploading(true);
    try {
      await api.clearMyCardPhoto(isMe ? undefined : id);
      forgetPictures(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setCardUploading(false);
    }
  }

  // Card animation on/off (self-saves on toggle). "off" = a fully still card.
  async function toggleAnim() {
    const id = pickerDriverId;
    const prev = cardAnim;
    const next = prev === "off" ? null : "off";
    // The switch is the person's, not the season's: every one of their cards
    // follows, so the overlay covers all of them at once. On a failure the
    // overlays are dropped entirely rather than guessed back — nothing was
    // written, so each row's stored value is the truth again.
    setAnimByRow(Object.fromEntries([...cardSeasons.map((s) => [s.driverId, next]), [id, next]]));
    setError(null);
    try {
      await api.setMyCardAnim(id, next);
    } catch (err) {
      setError(err.message);
      setAnimByRow({});
    }
  }

  async function pickStyle(key) {
    const id = pickerDriverId;
    const prev = styleOf(id);
    if (id === me.driverId) setMeCardStyle(key);
    else setSavedByDriver((m) => ({ ...m, [id]: key }));
    setError(null);
    try {
      await api.setMyCardStyle(id, key === "classic" ? null : key);
    } catch (err) {
      setError(err.message);
      if (id === me.driverId) setMeCardStyle(prev);
      else setSavedByDriver((m) => ({ ...m, [id]: prev }));
    }
  }

  // The selected row's identity + rating for the editor card on the left.
  const editorDriver = isMe
    ? {
        id: me.driverId,
        name: me.name,
        number: me.number ?? null,
        country: me.country || "",
        photoUrl: me.photoUrl,
        tier: me.tier,
        role: me.role ?? null,
        team: me.team,
        cardStyle: meCardStyle,
        cardAnim,
        seasonNumber: me.seasonNumber ?? null,
      }
    : rowPreview
    ? { ...rowPreview.driver, cardStyle: styleOf(pickerDriverId), cardAnim }
    : null;
  const editorRating = isMe ? ratingRes.data : rowPreview?.rating;
  const rowHasCard = !!(editorRating?.ratings || editorDriver?.role === "safety");
  const rowSeasonNumber = isMe
    ? me.seasonNumber
    : cardSeasons.find((s) => s.driverId === pickerDriverId)?.seasonNumber;

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[332px_minmax(0,1fr)]">
        {/* Left: the live card + framing + animation switch for WHICHEVER
            season chip is picked on the right — every season's card is fully
            editable on its own (edition, picture, framing, animation). */}
        <div className="mx-auto w-full max-w-[332px] space-y-4 lg:mx-0">
          {!isMe && !rowPreview ? (
            <Skeleton className="h-[440px] w-full rounded-2xl" />
          ) : rowHasCard ? (
            <>
              <CardPhotoEditor
                driver={editorDriver}
                rating={editorRating}
                pos={photoPos}
                setPos={editPos}
                onReset={resetCardPhoto}
                resetting={posState === "saving"}
                cardPhotoUrl={cardPhotoUrl}
                onPickCardPhoto={onPickCardPhoto}
                onResetCardPhoto={resetCardPhotoImage}
                canResetPhoto={hasOwnPhoto}
                canResetFraming={hasOwnPos}
                cardUploading={cardUploading}
              />
              {cardSeasons.length > 1 && (
                <p className="text-xs leading-relaxed text-light">
                  {isMe ? (
                    <>
                      This is your current card. The <strong className="font-semibold text-medium">picture</strong>{" "}
                      also shows on every season you never gave one of its own; how it{" "}
                      <strong className="font-semibold text-medium">sits</strong> is this season&rsquo;s alone, so
                      framing here changes nothing anywhere else.
                    </>
                  ) : (
                    <>
                      You&rsquo;re dressing your{" "}
                      <strong className="font-semibold text-medium">
                        {rowMeta?.seriesName
                          ? `${rowMeta.seriesName} Season ${rowSeasonNumber ?? ""}`.trim()
                          : `Season ${rowSeasonNumber ?? ""}`.trim()}
                      </strong>{" "}
                      card. How the picture sits is this season&rsquo;s alone. A picture you set here stays on it
                      too, even when you change your current card later — remove it to let this season show your
                      current one again.
                    </>
                  )}
                </p>
              )}
            </>
          ) : (
            <div className="card p-5 text-sm text-light">
              {isMe
                ? "Your rating card appears once you've raced a round this season. You can still pick an edition on the right."
                : "No card for this season yet. It appears once you've raced a round. You can still pick its edition on the right."}
            </div>
          )}

          {/* Animation switch: keep the edition's baseline motion, or freeze it.
              Unlike everything else on this page it is NOT per row — a still
              card is a preference about the person, so every card follows. */}
          {rowHasCard && (
          <>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
            <div className="min-w-0">
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Card animation</div>
              <div className="mt-0.5 text-xs text-light">
                {cardAnim === "off" ? "Off, a still card." : "On, with the edition's glow, sparkle and shimmer."}
                {cardSeasons.length > 1 && " Applies to all your cards."}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={cardAnim !== "off"}
              onClick={toggleAnim}
              className={`relative h-6 w-11 shrink-0 rounded-full transition ${cardAnim === "off" ? "bg-surface2" : "bg-brand"}`}
              title="Turn the card's animation on or off"
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${cardAnim === "off" ? "left-0.5" : "left-[22px]"}`} />
            </button>
          </div>
          <p className="text-right font-mono text-[10px] uppercase tracking-wider text-light">
            {posState === "saving" ? "Saving framing…" : posState === "saved" ? "Framing saved" : " "}
          </p>
          </>
          )}
        </div>

        {/* Right: the edition picker. */}
        <div className="min-w-0">
          <CardEditionPicker
            seasons={cardSeasons}
            activeDriverId={pickerDriverId}
            onPickSeason={setPickerDriverId}
            editions={editionsByDriver[pickerDriverId]}
            current={styleOf(pickerDriverId)}
            onPick={pickStyle}
            teamColor={me.team?.color}
            loading={editionsLoading && !editionsByDriver[pickerDriverId]}
          />
        </div>
      </div>
    </div>
  );
}

function EditDriverCardInner() {
  const me = useApi(useCallback(() => api.me(), []));
  // The Personal Area links here with the row it was showing, so the two pages
  // agree on which card is being edited.
  const [params] = useSearchParams();
  const startId = params.get("driver") || null;
  // Only the FIRST load takes the page: a picture write reloads this to read
  // back what the card really shows now, and tearing the editor down to a
  // spinner on every upload would make a self-saving page flicker.
  if (me.loading && !me.data) return <Spinner label="Loading your card…" />;
  if (me.error && !me.data) return <ErrorBox message={me.error} />;
  // Signed in but not linked to a roster driver yet — nothing to edit.
  if (me.data && me.data.isLinked === false) {
    return (
      <div className="mx-auto max-w-md">
        <div className="card p-6 text-center text-sm text-medium">
          You don&rsquo;t have a driver entry yet, so there&rsquo;s no card to edit.{" "}
          <Link to="/profile" className="transition font-semibold text-link hover:underline">
            Start on your profile
          </Link>{" "}
          to connect your Steam account and ask for a seat.
        </div>
      </div>
    );
  }
  return <CardEditor me={me.data} reload={me.reload} startId={startId} />;
}

export default function EditDriverCard() {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/profile" replace />;
  return (
    <div className="content-in space-y-6">
      <PageHeader
        eyebrow="Your profile"
        title="Edit Driver Card"
        subtitle="Choose your card edition, set the picture and how it sits, and switch the animation on or off. Every change saves by itself, so there is no save button."
        right={<BackLink />}
      />
      <EditDriverCardInner />
    </div>
  );
}

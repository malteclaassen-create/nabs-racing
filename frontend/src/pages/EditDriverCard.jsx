import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client.js";
import { useApi } from "../hooks/useApi.js";
import { useAuth } from "../hooks/useAuth.js";
import { Spinner, ErrorBox, PageHeader, Skeleton } from "../components/ui.jsx";
import { CardPhotoEditor, CardEditionPicker } from "../components/CardEditor.jsx";
import RatingCard from "../components/RatingCard.jsx";

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

function CardEditor({ me }) {
  const [error, setError] = useState(null);

  // Rating (for the numbers on the preview). Safety-car drivers get a card even
  // without a rating payload; everyone else needs to have raced.
  const ratingRes = useApi(useCallback(() => api.driverRating(me.driverId).catch(() => null), [me.driverId]));

  // Framing (x/y/z/s/t). Dragged/zoomed/tuned live, then auto-saved shortly
  // after the last change (no page Save button on this focused page).
  const [photoPos, setPhotoPos] = useState(me.photoPos || null);
  const [posDirty, setPosDirty] = useState(false);
  const [posState, setPosState] = useState("idle"); // idle | saving | saved
  useEffect(() => {
    if (!posDirty) return;
    const t = setTimeout(async () => {
      setPosState("saving");
      try {
        const res = await api.setMyCardPhoto(photoPos);
        setPhotoPos(res.photoPos);
        setPosDirty(false);
        setPosState("saved");
      } catch (err) {
        setError(err.message);
        setPosState("idle");
      }
    }, 700);
    return () => clearTimeout(t);
  }, [photoPos, posDirty]);

  async function resetCardPhoto() {
    setError(null);
    try {
      await api.setMyCardPhoto(null);
      setPhotoPos(null);
      setPosDirty(false);
      setPosState("idle");
    } catch (err) {
      setError(err.message);
    }
  }

  // Separate card-only picture.
  const [cardPhotoUrl, setCardPhotoUrl] = useState(me.cardPhotoUrl || null);
  const [cardUploading, setCardUploading] = useState(false);
  async function onPickCardPhoto(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setCardUploading(true);
    try {
      const res = await api.uploadMyCardPhoto(file);
      setCardPhotoUrl(res.cardPhotoUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setCardUploading(false);
    }
  }
  async function resetCardPhotoImage() {
    setError(null);
    setCardUploading(true);
    try {
      await api.clearMyCardPhoto();
      setCardPhotoUrl(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCardUploading(false);
    }
  }

  // Card animation on/off (self-saves on toggle). "off" = a fully still card.
  const [cardAnim, setCardAnim] = useState(me.cardAnim === "off" ? "off" : null);
  async function toggleAnim() {
    const next = cardAnim === "off" ? null : "off";
    const prev = cardAnim;
    setCardAnim(next);
    setError(null);
    try {
      await api.setMyCardAnim(me.driverId, next);
    } catch (err) {
      setError(err.message);
      setCardAnim(prev);
    }
  }

  // Edition picker: per-season-row, self-saving on pick. The preview card above
  // always shows the CURRENT row's chosen edition.
  const [meCardStyle, setMeCardStyle] = useState(me.cardStyle || "classic");
  const [cardSeasons, setCardSeasons] = useState([]);
  const [pickerDriverId, setPickerDriverId] = useState(me.driverId);
  const [editionsByDriver, setEditionsByDriver] = useState({});
  const [editionsLoading, setEditionsLoading] = useState(true);
  const [savedByDriver, setSavedByDriver] = useState({});

  useEffect(() => {
    let alive = true;
    api.myCardSeasons().then((d) => alive && setCardSeasons(d?.seasons || [])).catch(() => {});
    return () => { alive = false; };
  }, []);

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
  const [previewByDriver, setPreviewByDriver] = useState({});
  useEffect(() => {
    if (pickerDriverId === me.driverId || previewByDriver[pickerDriverId]) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerDriverId]);

  const styleOf = (id) => {
    if (id === me.driverId) return meCardStyle;
    if (savedByDriver[id] != null) return savedByDriver[id];
    return cardSeasons.find((s) => s.driverId === id)?.cardStyle || "classic";
  };

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

  const canPreview = ratingRes.data?.ratings || me.role === "safety";
  const driver = {
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
  };

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}
      <div className="grid gap-8 lg:grid-cols-[332px_minmax(0,1fr)]">
        {/* Left: the live card + framing + animation switch. When an OLD
            season's chip is picked on the right, the current card gives way to
            a preview of THAT season's card (edition picks show live on it);
            picture and framing are only editable on the current card. */}
        <div className="mx-auto w-full max-w-[332px] space-y-4 lg:mx-0">
          {pickerDriverId !== me.driverId ? (
            previewByDriver[pickerDriverId] ? (
              previewByDriver[pickerDriverId].rating?.ratings ||
              previewByDriver[pickerDriverId].driver.role === "safety" ? (
                <>
                  <RatingCard
                    driver={{ ...previewByDriver[pickerDriverId].driver, cardStyle: styleOf(pickerDriverId) }}
                    rating={previewByDriver[pickerDriverId].rating}
                  />
                  <p className="text-xs leading-relaxed text-light">
                    Season {cardSeasons.find((s) => s.driverId === pickerDriverId)?.seasonNumber} card — pick its
                    edition on the right. Picture, framing and animation are edited on your current card.
                  </p>
                </>
              ) : (
                <div className="card p-5 text-sm text-light">
                  No card for this season yet — it appears once you've raced a round. You can still pick its
                  edition on the right.
                </div>
              )
            ) : (
              <Skeleton className="h-[440px] w-full rounded-2xl" />
            )
          ) : canPreview ? (
            <CardPhotoEditor
              driver={driver}
              rating={ratingRes.data}
              pos={photoPos}
              setPos={(p) => { setPhotoPos(p); setPosDirty(true); }}
              onReset={resetCardPhoto}
              resetting={posState === "saving"}
              cardPhotoUrl={cardPhotoUrl}
              onPickCardPhoto={onPickCardPhoto}
              onResetCardPhoto={resetCardPhotoImage}
              cardUploading={cardUploading}
            />
          ) : (
            <div className="card p-5 text-sm text-light">
              Your rating card appears once you've raced a round this season. You can still pick an edition on the right.
            </div>
          )}

          {/* Animation switch: keep the edition's baseline motion, or freeze it.
              Acts on the CURRENT card only, so it hides on an old season's preview. */}
          {pickerDriverId === me.driverId && (
          <>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
            <div className="min-w-0">
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-medium">Card animation</div>
              <div className="mt-0.5 text-xs text-light">
                {cardAnim === "off" ? "Off — a still card." : "On — the edition's glow, sparkle and shimmer."}
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
          <p className="text-right font-mono text-[10px] uppercase tracking-wide text-light">
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
  if (me.loading) return <Spinner label="Loading your card…" />;
  if (me.error) return <ErrorBox message={me.error} />;
  // Signed in but not linked to a roster driver yet — nothing to edit.
  if (me.data && me.data.isLinked === false) {
    return (
      <div className="mx-auto max-w-md">
        <div className="card p-6 text-center text-sm text-medium">
          Your Discord account isn't linked to a driver yet, so there's no card to edit. Please contact an admin.
        </div>
      </div>
    );
  }
  return <CardEditor me={me.data} />;
}

export default function EditDriverCard() {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/profile" replace />;
  return (
    <div className="space-y-6">
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

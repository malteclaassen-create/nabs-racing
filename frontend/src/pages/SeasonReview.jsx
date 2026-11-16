// ---------------------------------------------------------------------------
// /s/<series>/drivers/<row>/review: one driver's season as a Wrapped story
// (review/Story.jsx), and nothing else. There is no long page behind it:
// closing the story goes back where the person came from, or to the
// driver's page when the link was opened on its own (from Discord, say).
//
// The data comes from the backend (services/seasonReviewService.js): public
// figures only, so the story is the same whoever opens it, apart from "you"
// for the driver themself.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { useSpecificTitle } from "../utils/pageTitle.js";
import { ErrorBox } from "../components/ui.jsx";
import Story from "./review/Story.jsx";
import { storySlides } from "./review/storySlides.mjs";

export default function SeasonReview() {
  const { id, seriesSlug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const slides = useMemo(() => (review && !review.tooEarly && !review.empty ? storySlides(review) : []), [review]);

  useEffect(() => {
    let gone = false;
    setReview(null);
    setError(null);
    api
      .driverSeasonReview(id)
      .then((r) => !gone && setReview(r.review))
      .catch((e) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [id]);

  const seasonLabel = review?.season?.label || "Season";
  useSpecificTitle(review?.driver ? `${review.driver.name} · ${seasonLabel} Wrapped` : "Season Wrapped");

  // Back to the page the story was opened from; a link opened on its own
  // has nothing to go back to, so it lands on the driver's page instead.
  const close = () => {
    if (location.key && location.key !== "default") {
      navigate(-1);
      return;
    }
    const driverPage = `${seriesSlug ? `/s/${seriesSlug}` : ""}/drivers/${encodeURIComponent(id)}`;
    navigate(review?.season?.number != null ? `${driverPage}?season=${review.season.number}` : driverPage, { replace: true });
  };

  if (error) return <ErrorBox message={error === "Not available" ? "The season Wrapped is not open yet." : error} />;
  if (!review) return <div className="min-h-[60vh]" aria-busy="true" />;
  if (review.tooEarly || review.empty || slides.length === 0) {
    return (
      <div className="card p-6">
        <div className="text-xs font-bold uppercase tracking-wider text-light">{review.season?.label}</div>
        <p className="mt-2 text-medium">
          {review.tooEarly ? "Not enough rounds yet. The Wrapped opens once two rounds are run." : `${review.driver?.name || "This driver"} did not start a race this season.`}
        </p>
      </div>
    );
  }
  return <Story review={review} slides={slides} onClose={close} />;
}

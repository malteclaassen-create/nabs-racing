import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client.js";
import { Spinner, ErrorBox } from "../components/ui.jsx";

// Where Steam sends the member back after "Sign in through Steam".
//
// This page exists for a security reason, not for looks. Steam's answer arrives
// as a plain browser navigation, which carries no session. If the backend
// accepted that navigation directly, anyone could start the flow, send the
// resulting link to someone else, and have THEIR Steam account written onto the
// attacker's login. So the assertion is handed to the API from here, with the
// signed-in member's own token attached: the write can only ever land on the
// account that is actually signed in, in this browser.
//
// Same shape as the Discord callback, and mounted the same way, so the SPA
// fallback in production serves it. The exchange is cached per query string
// because React StrictMode mounts effects twice in dev.
const verifications = new Map();
function verifyOnce(query) {
  if (!verifications.has(query)) verifications.set(query, api.steamLinkVerify(query));
  return verifications.get(query);
}

export default function SteamCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const query = window.location.search;
    if (!query || !query.includes("openid.")) {
      setError("No answer from Steam.");
      return;
    }
    let gone = false;
    verifyOnce(query)
      .then((res) => {
        if (gone) return;
        // The result rides in the URL so the profile page can say what happened
        // without this page needing any layout of its own. "Connected" is only
        // reported when the id genuinely got where it belongs: no driver row yet
        // is fine (it follows on linking), but a row that holds a DIFFERENT id,
        // one held by another driver, or a failed write all need an admin.
        const d = res?.driver;
        const needsAdmin =
          d && d.written === false && !["no-driver", "no-claim", "already-set"].includes(d.reason);
        navigate(`/profile?steam=${needsAdmin ? "carried" : "ok"}`, { replace: true });
      })
      .catch((e) => {
        if (gone) return;
        // Cancelling at Steam is a normal outcome, not an error.
        if (/cancel/i.test(e.message)) navigate("/profile?steam=cancelled", { replace: true });
        else setError(e.message);
      });
    return () => {
      gone = true;
    };
  }, [navigate]);

  if (error)
    return (
      <div className="mx-auto max-w-md space-y-4">
        <ErrorBox message={`Steam link failed: ${error}`} />
        <button className="btn-secondary" onClick={() => navigate("/profile", { replace: true })}>
          Back to your profile
        </button>
      </div>
    );

  return <Spinner label="Linking your Steam account…" />;
}

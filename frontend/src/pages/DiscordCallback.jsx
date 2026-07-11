import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { saveUser } from "../hooks/useAuth.js";
import { Spinner, ErrorBox } from "../components/ui.jsx";

// Discord authorization codes are single-use, but this page can mount more than
// once for the same code: StrictMode double-runs effects in dev, and App remounts
// the whole page subtree once the season list loads. So the exchange is cached at
// module level per code — every mount awaits the SAME request instead of firing a
// second one (which Discord would reject with invalid_grant).
const exchanges = new Map();
function exchangeOnce(code) {
  if (!exchanges.has(code)) exchanges.set(code, api.discordCallback(code));
  return exchanges.get(code);
}

export default function DiscordCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      setError("No code received from Discord.");
      return;
    }
    let gone = false;
    exchangeOnce(code)
      .then((res) => {
        saveUser(res.token, res.user);
        if (!gone) navigate("/profile", { replace: true, state: { linked: res.linked } });
      })
      .catch((e) => {
        if (!gone) setError(e.message);
      });
    return () => {
      gone = true;
    };
  }, [params, navigate]);

  if (error)
    return (
      <div className="mx-auto max-w-md space-y-4">
        <ErrorBox message={`Discord login failed: ${error}`} />
        <button className="btn-secondary" onClick={() => navigate("/profile")}>
          Back
        </button>
      </div>
    );

  return <Spinner label="Signing you in with Discord…" />;
}

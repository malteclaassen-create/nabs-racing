import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client.js";
import { saveUser } from "../hooks/useAuth.js";
import { Spinner, ErrorBox } from "../components/ui.jsx";

export default function DiscordCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard against StrictMode double-run
    ran.current = true;

    const code = params.get("code");
    if (!code) {
      setError("No code received from Discord.");
      return;
    }
    api
      .discordCallback(code)
      .then((res) => {
        saveUser(res.token, res.user);
        navigate("/signup", { replace: true, state: { linked: res.linked } });
      })
      .catch((e) => setError(e.message));
  }, [params, navigate]);

  if (error)
    return (
      <div className="mx-auto max-w-md space-y-4">
        <ErrorBox message={`Discord login failed: ${error}`} />
        <button className="btn-secondary" onClick={() => navigate("/signup")}>
          Back
        </button>
      </div>
    );

  return <Spinner label="Signing you in with Discord…" />;
}

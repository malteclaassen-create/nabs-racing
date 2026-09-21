import { Navigate } from "react-router-dom";
import { PageHeader } from "../components/ui.jsx";
import SettingsSections from "../components/SettingsSections.jsx";
import { useAuth } from "../hooks/useAuth.js";
import { useSpecificTitle } from "../utils/pageTitle.js";

// ---------------------------------------------------------------------------
// /settings — the settings for somebody who has nowhere else to put them.
//
// For a MEMBER the settings are a panel of the personal area, beside Edit
// Profile, My Rating and Telemetry: everything about you in one place, reached
// the same way as everything else there. So this address hands a signed-in
// member straight on to it, which also means the bell's Settings row, an old
// link and a bookmark all land in the same place rather than in two.
//
// A VISITOR has no personal area — /profile is the Discord login for them —
// and the two settings that are not about an account (the theme and the Lite
// performance mode) have to stay reachable without one. The bell is in the bar
// for everyone, signed in or not, and this is the page it opens for them.
// ---------------------------------------------------------------------------
export default function Settings() {
  useSpecificTitle("Settings · NABS Racing League");
  const { isLoggedIn } = useAuth();

  // `replace`: Back should go where the reader came from, not bounce off the
  // redirect and forward again.
  if (isLoggedIn) return <Navigate to="/profile?tab=settings" replace />;

  return (
    <div className="content-in mx-auto max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        subtitle="How the site looks and runs on this device. Sign in for the rest."
      />
      <SettingsSections />
    </div>
  );
}

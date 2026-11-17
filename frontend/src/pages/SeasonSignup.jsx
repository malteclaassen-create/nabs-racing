import TeamSignupCard from "../components/TeamSignupCard.jsx";
import { EmptyState } from "../components/ui.jsx";

// The sign-up for a coming season on a page of its own, so the menu (and a
// link posted in Discord) can lead straight to it. The same card also sits on
// the series' home page while the sign-up is open. The nav shows its item only
// while an admin has the sign-up open (NavBar).
export default function SeasonSignup() {
  return (
    <div className="content-in mx-auto max-w-3xl">
      <TeamSignupCard
        startOpen
        whenClosed={<EmptyState title="No sign-up open" hint="There is no sign-up for this series right now. Keep an eye on Discord." />}
      />
    </div>
  );
}

import { useAuth } from "./useAuth.js";
import { getToken } from "../api/client.js";

// The public transfer market page (/transfers) is built but not signed off,
// so it is held back from the public for now: the Standings menu, the mobile
// menu, the "Team changes" button on the Constructors page and the page
// itself all ask here. Admins (PIN or Discord-designated) still get all of
// it, so it can be checked on the live site. Flip TRANSFERS_PUBLIC to true to
// open it up; the sitemap entry (backend lib/sitemap.js) goes back in then.
export const TRANSFERS_PUBLIC = false;

export function useTransfersVisible() {
  const { user } = useAuth();
  return TRANSFERS_PUBLIC || !!user?.isAdmin || !!getToken();
}

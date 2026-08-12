import { useCallback, useState } from "react";

// Which shape the admin's navigation takes: the folding list down the left side
// ("rail"), or the strip of tabs across the top ("tabs"). Both show the same
// twenty-two tabs and the same panels; the choice is only where the menu lives,
// so it is remembered per browser rather than per account.
//
// It sits in its own file rather than next to the navigation it belongs to
// because a module that exports both components and a hook cannot be hot
// reloaded — every edit to the admin's menu would otherwise reload the whole
// page and lose whatever was half-typed in the panel beside it.
//
// The try/catch is for private-browsing windows, where reading or writing
// localStorage throws: the preference then simply lasts for the visit.
const KEY = "nabs_admin_nav";
export const NAV_TABS = "tabs";
export const NAV_RAIL = "rail";

export function useAdminNavMode() {
  const [mode, setMode] = useState(() => {
    try {
      return localStorage.getItem(KEY) === NAV_TABS ? NAV_TABS : NAV_RAIL;
    } catch {
      return NAV_RAIL;
    }
  });
  const choose = useCallback((m) => {
    setMode(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* private mode: this visit only */
    }
  }, []);
  return [mode, choose];
}

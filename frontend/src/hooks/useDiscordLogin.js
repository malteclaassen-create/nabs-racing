import { useCallback } from "react";
import { api, setDiscordReturnTo } from "../api/client.js";
import { useApi } from "./useApi.js";

// The Discord sign-in, in one place: whether it is configured on this
// deployment at all, and the jump to Discord's consent screen.
//
// Four places ask the same two questions — the profile's sign-in card, the
// downloads gate, the feedback page and the attendance banner — and each used
// to carry its own copy of these three lines, including the easily-missed
// detail that api.discordConfig() is what mints the OAuth `state` nonce, so the
// URL must come from that call and not be built by hand.
//
// `returnTo` is an in-site path to come back to afterwards instead of the
// profile page. The attendance banner passes it so signing in leaves the member
// looking at the race they were about to answer for.
export function useDiscordLogin(returnTo = null) {
  const discord = useApi(useCallback(() => api.discordConfig(), []));
  const url = discord.data?.url || null;

  const start = useCallback(() => {
    if (!url) return;
    if (returnTo) setDiscordReturnTo(returnTo);
    window.location.href = url;
  }, [url, returnTo]);

  return { enabled: !!discord.data?.enabled, loading: discord.loading, start };
}

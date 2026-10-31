// Which Steam ids are the signed-in member's own, so the live map can find
// their car without them clicking it. The race server knows every car by its
// driver's Steam id; the league knows it two ways: the member's own Steam
// link (Profile > Steam) and the id the result imports wrote onto their driver
// rows (Driver.steamId). Every row of the person counts, archive seasons and
// other series included: whichever car they are in tonight, it is them.
import { resolveDriverId } from "../middleware/auth.js";
import { getLinkedDriverIds } from "./persons.js";
import { dbGetMember } from "./members.js";

export async function ownSteamIds(prisma, user) {
  if (!user?.discordId) return [];
  const ids = new Set();
  const acct = await dbGetMember(prisma, user.discordId).catch(() => null);
  if (acct?.steamId) ids.add(String(acct.steamId));
  const driverId = await resolveDriverId(prisma, user).catch(() => null);
  if (driverId) {
    const rowIds = await getLinkedDriverIds(prisma, driverId).catch(() => [driverId]);
    const rows = await prisma.driver
      .findMany({ where: { id: { in: rowIds } }, select: { steamId: true } })
      .catch(() => []);
    for (const r of rows) if (r.steamId) ids.add(String(r.steamId));
  }
  return [...ids];
}

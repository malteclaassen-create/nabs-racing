// The LEAGUE's own social accounts, stored by an admin under `social_<platform>`
// keys in the Setting table.
//
// Not to be confused with lib/socials.js, which is the same idea one level down:
// the links an individual DRIVER puts on their profile. This file is the league
// itself, hence the name.
//
// Lives in lib/ rather than in routes/settings.js because there are now two
// readers: the public /api/settings/social endpoint the site's icons use, and
// the structured data on the home page, which lists the same accounts as "this
// organisation is also these" (lib/pageMeta.js).
// The platforms the site knows how to render an icon for.
export const SOCIAL_KEYS = ["discord", "twitch", "youtube", "instagram", "tiktok", "x", "patreon"];

// Read the configured links as { discord, twitch, … }. An unset one is "".
export async function readSocialLinks(prisma) {
  const rows = await prisma.setting.findMany({
    where: { key: { in: SOCIAL_KEYS.map((k) => `social_${k}`) } },
  });
  const map = {};
  for (const k of SOCIAL_KEYS) map[k] = rows.find((r) => r.key === `social_${k}`)?.value || "";
  return map;
}

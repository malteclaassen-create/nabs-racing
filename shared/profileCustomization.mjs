export const PROFILE_SLOTS = ["theme", "banner", "frame", "nameplate", "stats", "trophies", "showcase", "effect"];
export const EMPTY_APPEARANCE = Object.fromEntries(PROFILE_SLOTS.map(slot => [slot, null]));
// The page background is bought like a design but worn like a setting: there is
// nothing to pick from, only your own picture, so it has no slot of its own.
export const CUSTOM_BACKGROUND_ITEM_ID = "background-custom";
export const EMPTY_PROFILE_CONTENT = {
  title: "", bannerImage: null, bannerPosition: 50,
  showcaseImage: null, showcaseTitle: "", showcaseText: "", showcaseMode: "card", achievementKey: null,
  accentColor: null, panelShape: "theme", density: "comfortable", bannerStrength: 60,
  effectStrength: 50, motion: true, nameCase: "theme", nameScale: 100,
  // Per-effect settings. lavaOpaquePanels is the stored key for the shared
  // "Opaque info cards" switch; it kept its name from when only the lava had it.
  lightningColor: "default", lavaAmount: 50, lavaColor: "default", lavaOpaquePanels: true,
  nameColor: null, namePlateColor: null, nameInStandings: false,
  backgroundImage: null, backgroundPositionX: 50, backgroundPositionY: 50, backgroundStrength: 65, backgroundFit: "cover", backgroundScroll: "fixed",
};
export function profileItemPrice(catalog, item, owned = []) {
  if (owned.includes(item.id)) return 0;
  // A catalogue that does not know this design yet (a server still running on
  // the list from before a new one was added) falls back to the design's own
  // price rather than taking the page down.
  return catalog.find(i => i.id === item.id)?.price ?? item.price ?? 0;
}
export function applyProfileItem(catalog, appearance, item) {
  const design = catalog.find(i => i.id === item.id);
  return { ...appearance, [design.slot]: design.id };
}

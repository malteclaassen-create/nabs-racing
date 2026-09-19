export const PROFILE_SLOTS = ["theme", "banner", "frame", "nameplate", "stats", "trophies", "showcase", "effect"];
export const EMPTY_APPEARANCE = Object.fromEntries(PROFILE_SLOTS.map(slot => [slot, null]));
export const EMPTY_PROFILE_CONTENT = {
  title: "", bannerImage: null, bannerPosition: 50,
  showcaseImage: null, showcaseTitle: "", showcaseText: "", showcaseMode: "card", achievementKey: null,
  accentColor: null, panelShape: "theme", density: "comfortable", bannerStrength: 60,
  effectStrength: 50, motion: true, nameCase: "theme", nameScale: 100,
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

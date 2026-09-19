export const PROFILE_SLOTS = ["theme", "banner", "frame", "nameplate", "stats", "trophies", "showcase", "effect"];
export const EMPTY_APPEARANCE = Object.fromEntries(PROFILE_SLOTS.map(slot => [slot, null]));
export const EMPTY_PROFILE_CONTENT = {
  title: "", bannerImage: null, bannerPosition: 50,
  showcaseImage: null, showcaseTitle: "", showcaseText: "", showcaseMode: "card", achievementKey: null,
  accentColor: null, panelShape: "theme", density: "comfortable", bannerStrength: 60,
  effectStrength: 50, motion: true, nameCase: "theme", nameScale: 100,
};
export function profileItemPrice(catalog, item, owned = []) {
  return owned.includes(item.id) ? 0 : catalog.find(i => i.id === item.id).price;
}
export function applyProfileItem(catalog, appearance, item) {
  const design = catalog.find(i => i.id === item.id);
  return { ...appearance, [design.slot]: design.id };
}

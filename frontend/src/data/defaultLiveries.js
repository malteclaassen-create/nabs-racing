// The default liveries a special event's car ships with, for drivers who bring
// no livery of their own. Each one carries its number, so picking a car IS
// picking a number, and the number on a sign-up says which default car that is.
// A number somebody took for their own livery takes that default car off the
// list (EventCar.jsx).
//
// Pictures: frontend/public/cars/<car>/skins/<skin>.jpg, made from the skin's
// preview.jpg in the Assetto Corsa folder (560 px wide). Only the car's own
// skins as RSS ships them are here, not the league's or anybody's custom ones.

const HYPERION = [
  [1, "blue_hyperion_1", "Blue"],
  [10, "warbird_hyperion_10", "WarBird"],
  [12, "warbird_hyperion_12", "WarBird"],
  [13, "green_hyperion_13", "Green"],
  [14, "green_hyperion_14", "Green"],
  [15, "red_hyperion_15", "Red"],
  [16, "red_hyperion_16", "Red"],
  [20, "brown_hyperion_20", "Brown"],
  [22, "brown_hyperion_22", "Brown"],
  [23, "tiger_hyperion_23", "Tiger"],
  [25, "tiger_hyperion_25", "Tiger"],
  [44, "rss_hyperion_44", "RSS"],
  [47, "rss_hyperion_47", "RSS"],
  [61, "blue_green_hyperion_61", "White Green"],
  [65, "blue_green_hyperion_65", "White Green"],
  [67, "light_hyperion_67", "Light"],
  [73, "light_hyperion_73", "Light"],
  [74, "blend_hyperion_74", "Blend"],
  [92, "blue_hyperion_92", "Blue"],
  [98, "blend_hyperion_98", "Blend"],
].map(([number, skin, name]) => ({ number, skin, name, image: `/cars/rss_hyperion_2020/skins/${skin}.jpg` }));

// Where an event's car is bought or downloaded, for the {carLink} placeholder
// on its Race Info page. null for a car we have no address for.
export function carStoreUrl(car) {
  if (/hyperion/i.test(String(car || ""))) return "https://store.racesimstudio.com/p/hyperion-2020/";
  return null;
}

// The default liveries for an event's car (the season's "game" text, e.g.
// "RSS Hyperion"), or [] for a car we have none for.
export function defaultLiveriesFor(car) {
  if (/hyperion/i.test(String(car || ""))) return HYPERION;
  return [];
}

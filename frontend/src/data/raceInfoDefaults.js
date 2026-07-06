// Default content for the Race Info page. The live text is admin-editable
// (Admin -> Race Info tab, stored in the backend Setting table); this file is
// the fallback when nothing has been saved yet, and the "Reset to defaults"
// source in the editor.
//
// Text conventions (also documented in the admin editor):
//   **like this**  -> bold highlight
//   {rounds}       -> number of championship rounds this season
//   {counted}      -> rounds that count after the drop rule
//   {drop}         -> how many rounds are dropped per driver
//   {platform}     -> the sim platform (e.g. Assetto Corsa)
//   {era}          -> the car era (e.g. F1 2007)

export const RACE_INFO_DEFAULTS = {
  subtitle:
    "The rules, the format and every file you need to get on the NABS grid. {platform} setup included.",
  cards: [
    {
      icon: "calendar",
      title: "The season",
      text: "{rounds} championship rounds, run roughly weekly on {platform}. Right now we race {era} machinery. Special events in between are just for fun and score nothing.",
    },
    {
      icon: "tiers",
      title: "Tiers & reserves",
      text: "Every team runs a **Tier 1** and a **Tier 2** car, so you race people at your level. Reserves can jump into any free seat on race day. That is the easiest way to get your first start.",
    },
    {
      icon: "shield",
      title: "Three championships",
      text: "One drivers' table for everyone. Constructors run twice: Tier 1 adds both drivers' points; Tier 2 re-ranks only the Tier-2 cars each round, then scores them.",
    },
    {
      icon: "scale",
      title: "Best {counted} of {rounds}",
      text: "Every driver's {drop} lowest-scoring rounds are dropped, and the team standings inherit those drops. One bad night (or a missed round) never ends your championship.",
    },
    {
      icon: "flag",
      title: "Race week",
      text: "Mark yourself **Accepted**, **Tentative** or **Declined** for each round, either on the Races page or in Discord. Free seats go to reserves through the driver market.",
    },
    {
      icon: "clock",
      title: "Penalties",
      text: "Stewards review incidents after the race in Discord. Penalties are added as **seconds on your race time**, so results can shift once stewarding is done. Race fair, leave space, and give places back if you gain them off track.",
    },
  ],
  pointsFootnote:
    "A DNF, DSQ or no-show scores nothing. The classification never has gaps: if a car retires or is disqualified, everyone behind moves up.",
  rulebook: [
    {
      subject: "Tyres",
      icon: "tyre",
      rules: [
        "Each driver must change compound type **at least once** during the race: after the first full lap and before the last full lap of the race.",
      ],
    },
    {
      subject: "Track limits",
      icon: "limits",
      rules: [
        "Track limits are decided by RealPenalty. Each driver must not go above **5 track-cut warnings**.",
        "Even if the track warning is green, the driver must not make big track cuts by abusing the system.",
      ],
    },
    {
      subject: "DRS",
      icon: "wind",
      rules: ["The driver must be within **1 second** of the car ahead to use DRS."],
    },
    {
      subject: "Racing",
      icon: "wheel",
      rules: [
        "The driver must avoid contact whenever possible.",
        "The driver must not go unnecessarily slow on the racing line when faster drivers are behind.",
        "The driver must not re-enter the track/racing line when other drivers are close behind.",
        "The driver must not overtake off track. If it does happen, they must **give the place back** to avoid penalisation.",
        "The driver must not brake unreasonably when other drivers are behind (brake check).",
        "The driver must leave enough space for the other car to stay on track.",
        "The driver must not bump-draft with other cars.",
      ],
    },
    {
      subject: "Qualifying",
      icon: "clock",
      rules: [
        "Qualifying is done in two groups: Tier 1 and Tier 2.",
        "During the **first 12 minutes**, Tier 2 drivers set their laps. They must teleport back to the pits the moment the 12 minutes are over. No overtime.",
        "During the **last 8 minutes**, Tier 1 drivers set their laps. Once the session ends, their laps finish instantly. No overtime.",
        "No track cuts during outlaps.",
        "On an outlap, the driver must stay out of the way of cars on a fast lap.",
      ],
    },
    {
      subject: "Blue flags",
      icon: "blueflag",
      rules: [
        "When getting lapped, the driver must get out of the way as fast as possible, so the car behind can pass safely.",
      ],
    },
    {
      subject: "Engagement rules",
      icon: "align",
      rules: [
        "Drivers are alongside when their **front wheels fully align with the rear wheels** of the car in front.",
      ],
    },
    {
      subject: "Safety car",
      icon: "safety",
      rules: [
        "When the Full Course Yellow is deployed, the driver must slow down to **160 km/h (99 mph)** before the end of the 10-second warning on screen.",
        "The driver must not overtake during the safety-car period (including the 10 seconds while it is being deployed).",
        "Lapped drivers can only unlap themselves after the Full Course Yellow period, and must do it safely.",
        "Drivers must keep within the **green delta** during the Full Course Yellow period. They may speed up once the safety-car message is pulled.",
        "If a car spins, crashes, or is going very slowly off track, drivers are allowed to overtake it safely.",
        "If you are closely following the car in front during Full Course Yellow and you are above **4 seconds** in the green delta, you are allowed to overtake them.",
        "The driver must keep a consistent gap and avoid speeding up or slowing down quickly under SC conditions.",
        "During a safety-car restart, the lead driver dictates the pace and has to give the safety car space to enter the pits.",
        "The lead driver mustn't go before the **last 3 corners** of the lap, and is only allowed one starting action.",
        "During a safety-car restart, drivers are not allowed to overtake until the start/finish line.",
        "Drivers have **10 laps** to take a drive-through penalty. If a driver cannot serve it due to SC conditions, **40 seconds** are added at the end of the race.",
        "Drivers are not allowed to take their penalties (e.g. drive-throughs) while under SC conditions.",
        "Drivers must not crash during safety-car conditions.",
        "The lead driver must not overtake the safety car before the restart.",
      ],
    },
  ],
  rulebookFootnote:
    "Incidents are reviewed by the stewards in Discord after the race. Penalties are added as seconds on your race time, so the final classification can shift once stewarding is done.",
};

# Archiv-Saisons (Seasons 1–6)

Maschinenlesbare Quelle für die alten Saisons. Pro Saison ein Ordner
`season<N>/`. Der Importer (`npm run import:archive -- --season <N>`) liest
diese Dateien und legt die Saison **read-only** in der DB an (nie aktiv).

> ⚠️ Ein `npm run seed` löscht ALLE Saisons (auch die Archiv-Saisons).
> Danach immer `npm run import:archive -- --all` laufen lassen.

## `season<N>/season.json` (Pflicht)

```jsonc
{
  "number": 6,
  "name": "Season 6",
  "game": "F1 20xx · Assetto Corsa",   // Label im Header
  "dropWorst": 0,                       // Streichresultate der DAMALIGEN Regel (0 = alle Rennen zählen)
  "pointsTable": null,                  // null = Liga-Standard; sonst [35,30,25,...]
  "teams": [
    { "id": "ferrari", "name": "Ferrari", "tier": 1, "color": "#E10600" }
    // S1–S5: alle tier 1 (keine Tiers). S6: tier 1 / 2 laut ZIP.
  ],
  "drivers": [
    { "id": "takoda", "name": "Takoda", "discord": "Takoda", "teamId": "ferrari", "tier": 1 }
  ],
  "nameMap": {
    // Optional: AC-Anzeigename -> driverId, für Namen die der Fuzzy-Match verfehlt.
    "T4koda #99": "takoda"
  },
  "finalStandings": {
    // Offizielle Endstände. Diese Zahlen + Reihenfolge sind maßgeblich und
    // gewinnen in der Tabelle gegenüber allem, was aus den Rennen gerechnet wird.
    "drivers": [ { "id": "takoda", "points": 214 } ],
    "teams":   [ { "id": "ferrari", "points": 320 } ]
  }
}
```

IDs sind **kurze Slugs ohne Präfix** — der Importer stellt automatisch
`s<N>_` voran (also `takoda` → `s6_takoda`).

## `season<N>/rounds.json` (optional, nur wenn Renndaten existieren)

```json
[
  { "round": 1, "track": "Melbourne", "date": "2025-01-17T18:30:00Z", "emperorId": "2025_1_17_18_30_RACE" },
  { "round": 2, "track": "Bahrain",   "date": "2025-01-24T18:30:00Z", "emperorId": null }
]
```

`emperorId: null` = Runde ist bekannt, aber die AC-Datei existiert nicht mehr →
es wird nur die Rennzeile angelegt (ohne Ergebnisse).

Die passenden `emperorId`s findet man mit:
`npm run archive:inventory -- --from 2025-01-01 --to 2026-03-31 --detail`

## `season<N>/raw/`

Cache der heruntergeladenen AC-JSONs (`r<round>-<id>.json`), damit ein erneuter
Import ohne Netz läuft. Wird automatisch befüllt.

`_template/` ist nur ein Beispiel und wird vom Importer ignoriert
(nur `season<Zahl>`-Ordner werden erkannt).

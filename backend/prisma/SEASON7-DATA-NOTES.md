# Season 7 — Datenlage der Teamwertung (Stand 2026-07-03, abgeschlossen)

Die Teamwertung wird live aus den einzelnen Rennergebnissen berechnet
(Fahrer-Streichregel: die 3 schlechtesten Rennen jedes Fahrers zählen nicht
für das Team, für das er in der jeweiligen Runde fuhr). Die
`ConstructorRaceScore`-Tabelle enthält die offiziellen Sheet-Rundenwerte und
dient nur noch als Referenz.

## Aufstellungen R1–R8: vollständig rekonstruiert und bestätigt

Die Aufstellungen wechselten in Season 7 ständig (Reservisten sprangen ein,
Stammfahrer halfen anderen Teams aus, dritte Autos wurden nicht gewertet).
Die vollständige Zuordnung pro Runde steht in `SUB_ASSIGNMENTS` in `seed.js`.
Quellen: die offiziellen Rundenpunkte beider Tiers (Constraint-Solver) plus
die Team-Logos in den Discord-Result-Posts von **R1–R10** (vom Liga-Admin
bereitgestellt, 2026-07-03 abgeglichen).

**Ergebnis: Alle 10 Runden reproduzieren die offiziellen Rundenpunkte zu
100 %** (Tier-1-Summen und Tier-2-Re-Ranking).

Highlights: JoMilan fuhr R1 für Williams, R5/R6 für Porsche, R7 für Honda.
Pizd fuhr R1/R2 für Jaguar. Kowandoh Badu fuhr R2 für Honda. Tball
(Discord: SirTibletTheSandwichArtist) war Stamm-Aushilfe bei McLaren
(R1–R3, R6). R8s zweites Lamborghini-Auto war Oshy. `subForTeamId =
"reserve"` heißt: fuhr mit, zählte für kein Team (z.B. drittes BMW-Auto
Zero0n1k in R1/R2).

## Vorgenommene Datenkorrekturen

- **R7: Positionen von Vibe Officer (jetzt P17) und GoldGinger (jetzt P18)
  getauscht** — die AC-Rohdaten hatten die beiden andersherum als die
  offizielle Wertung (Discord-Post + gespeicherte Fahrerpunkte 2/1 belegen
  die offizielle Reihenfolge). Korrigiert in DB und
  `season7/race-positions.json`.

## Verbleibende Kleinigkeiten (ohne Auswirkung auf die Wertung)

1. **R10:** Manro45GT hat 1 Punkt, aber keine gespeicherte Position → fehlt
   im Tier-2-Re-Rank dieser Runde (offizielle Werte stimmen trotzdem).
2. **R10:** Gabriele Grossi trägt im Discord-Post ein Renault-artiges Icon,
   die offiziellen Zahlen werten ihn aber für kein Team — so übernommen.
3. **R10, Justyn ↔ Kowandoh Badu:** Das offizielle Sheet widerspricht sich
   hier selbst — die Fahrerpunkte folgen der Reihenfolge NACH Kowandohs
   Strafe (Justyn P14 = 5 Pkt, Kowandoh P15 = 4 Pkt, so auch der Discord-
   Post), die Team-Rundenpunkte wurden aber mit der Reihenfolge DAVOR
   gerechnet (Kowandoh vor Justyn). Wir speichern die Positionen so, dass
   die Teamwertung stimmt; der Daten-Check im Admin (Health) meldet die
   beiden deshalb dauerhaft als bekannte Warnung.
3. Discord-Namen ↔ DB: SirTibletTheSandwichArtist=Tball, Tafourthda=Takoda,
   Timmy 'Bunker' Gilmore=Mtimmis, "Mr. Inconsistency | Duck Drivers"=
   Manro45GT, VugPuh=VHP, Siggidy=Siggsta.

Nachträge jederzeit im Admin-Ergebnis-Editor ("fuhr für") möglich — die
Standings rechnen sich automatisch neu.

# Design-Varianten: lokal live ausprobieren

Dieser Branch (`design-varianten`) ist nur zum Anschauen gedacht und wird **nicht** in `main` gemerged.
Er enthält für jedes Element jeder Seite drei Entwürfe (A, B, C) und einen Picker, mit dem du sie in der
echten Seite auf `localhost` austauschen kannst.

## Starten

```bash
git fetch origin design-varianten
git checkout design-varianten

# wie immer: Backend und Frontend starten (siehe README.md)
cd backend && npm install && npm run dev        # Terminal 1
cd frontend && npm install && npm run dev       # Terminal 2
```

Dann im Browser öffnen:

**http://localhost:5173/_design/index.html**

## So funktioniert der Picker

- Links wählst du oben die Seite, darunter stehen alle Elemente der Seite von oben nach unten.
- Pro Element: **Original** (wie heute) oder **A / B / C**. Ein Klick tauscht das Element rechts in der echten Seite sofort aus.
- **Rechtsklick** auf ein Vorschaubild zeigt den Entwurf groß.
- Oben rechts: **Desktop 1440 / Handy 390** und **Varianten / Original** zum schnellen Vergleichen.
- „zeigen ↓“ scrollt die Vorschau zum Element.
- **In neuem Tab öffnen** zeigt die Seite in voller Größe. Die Auswahl gilt dort genauso, und Änderungen im Picker erscheinen in jedem offenen Tab sofort.
- Auf der Seite selbst schwebt unten eine kleine Leiste „Design · N“ mit Varianten/Original und dem Link zurück zum Picker.
- **Auswahl kopieren** gibt dir eine Liste wie `Startseite (Mitglieder) › Titelkampf: B (Duell-Ansicht)` – die kannst du Claude schicken, dann werden genau diese Varianten richtig eingebaut.

## Was dahinter steckt

- `frontend/public/_design/` – Picker (`index.html`), Entwürfe als HTML (`variants/<seite>/…`), Vorschaubilder, `data.json`.
- `frontend/src/design/` – `DesignSlot` (tauscht ein Element gegen den gewählten Entwurf), `DesignBar` (schwebende Leiste).
- Die Seiten haben um jedes Element ein `<DesignSlot id="seite/element">`. Im Production-Build ist das wirkungslos
  (`import.meta.env.DEV` ist dort `false`), die Seite sieht ohne Auswahl exakt aus wie vorher.
- Die Entwürfe sind statische Mockups (Tailwind über CDN, also Internet nötig) mit Beispieldaten. Klicks darin tun nichts.
  Sie zeigen das Aussehen, nicht die fertige Funktion.
- Die Auswahl liegt im `localStorage` deines Browsers (`nabs-variant-picks`).

# Mosaik-Studio – LEGO-Plakate aus Fotos

Progressive Web App, die aus einem Foto ein Mosaik-Plakat aus **echten LEGO-Teilen in offiziellen LEGO-Farben** erzeugt. Die Steine lassen sich danach von Hand setzen. Am Ende erstellt die App eine Bestellliste und eine druckbare Bauanleitung.

## Funktionen

1. **Entwurf:** Foto wählen (Datei, Drag & Drop oder Einfügen), Ausschnitt verschieben und zoomen, Format wählen (in 16×16-Grundplatten, bis 128×128 Noppen). Dazu Steintyp, Helligkeit, Kontrast, Sättigung und Dithering sowie die erlaubten LEGO-Farben, einzeln oder als Vorauswahl (Graustufen, Sepia, Porträt …).
   Die Farben werden in CIELAB mit **CIEDE2000** zugeordnet, auf Wunsch mit Floyd-Steinberg-Dithering.
2. **Bearbeiten:** Steine selbst setzen mit Pinsel, Füllen, Pipette und Verschieben, Rückgängig/Wiederholen, Zoom und 16er-Raster. Zur Wahl stehen alle 41 LEGO-Farben.
   Tastenkürzel: `B` Pinsel, `F` Füllen, `I` Pipette, `Strg+Z`/`Strg+Y`, Leertaste + Ziehen zum Verschieben, `Strg` + Mausrad zum Zoomen.
3. **Bestellliste:** Stückzahlen je Farbe mit LEGO-Farb-ID und BrickLink-Farb-ID, wahlweise mit Reserve und Grundplatten.
   Export als **CSV** und als **BrickLink Wanted List (XML)**. Drucken ist ebenfalls möglich.
4. **Anleitung:** Deckblatt mit Übersicht und Farblegende, danach eine Seite pro 16×16-Abschnitt mit nummeriertem Raster und Teileliste. Über den Druckdialog lässt sie sich als PDF speichern.

Das Projekt wird automatisch im Browser gespeichert (IndexedDB). Über **Projekt → speichern/öffnen** lässt es sich als `.json` sichern, inklusive Foto. Die App funktioniert nach dem ersten Aufruf offline und kann installiert werden.

## Teile & Farben

- Steintypen: Platte rund 1×1 (BL 4073), Fliese rund 1×1 (BL 98138), Platte 1×1 (BL 3024), Fliese 1×1 (BL 3070b). Grundplatte: Platte 16×16 (BL 91405).
- Farben: 41 deckende LEGO-Farben in `js/colors.js`, jeweils mit offiziellem LEGO-Namen und LEGO-ID sowie BrickLink-Name und BrickLink-ID. Transparente, Perlmutt- und Metallicfarben sind bewusst nicht dabei.
- **Hinweis:** Nicht jedes Teil gibt es in jeder Farbe. Vor der Bestellung die Verfügbarkeit prüfen, etwa auf BrickLink oder bei LEGO Pick a Brick, und notfalls im Editor eine andere Farbe setzen.

## Entwicklung

Kein Build-Schritt, nur Vanilla-JS-Module.

```bash
npm start      # lokaler Server auf http://localhost:8080
npm test       # Unit-Tests (Node ≥ 20)
```

Der Service Worker braucht HTTPS oder `localhost`. Zum Veröffentlichen genügt jeder statische Hoster, z. B. GitHub Pages. Nach Änderungen an Dateien `VERSION` in `sw.js` erhöhen.

| Datei | Inhalt |
|---|---|
| `js/colors.js`, `js/parts.js` | LEGO-Farben und -Teile |
| `js/mosaic.js` | Bildverarbeitung, Farbabstand, Dithering, Füllen (DOM-frei, getestet) |
| `js/editor.js`, `js/render.js` | Editor und Darstellung der Noppen |
| `js/orderlist.js` | Bestellliste, CSV, BrickLink-XML |
| `js/instructions.js` | Bauanleitung |
| `js/app.js` | Oberfläche und Zustand |
| `sw.js`, `manifest.webmanifest` | PWA |

LEGO® ist eine Marke der LEGO Gruppe, die dieses Projekt weder unterstützt noch autorisiert.

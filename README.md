# Mosaik-Studio – LEGO-Plakate aus Fotos

Progressive Web App, die aus einem Foto ein Mosaik-Plakat aus **echten LEGO-Teilen in offiziellen LEGO-Farben** erzeugt. Die Steine lassen sich danach von Hand setzen. Am Ende erstellt die App eine Bestellliste und eine druckbare Bauanleitung.

## Funktionen

1. **Entwurf:** Foto wählen (Datei, Drag & Drop oder Einfügen), Ausschnitt verschieben und zoomen, Format wählen: Papierformat A4–A0 hoch oder quer (1 Noppe = 8 mm, z. B. A3 = 37 × 52 Noppen), Raster aus 16er-Abschnitten oder frei in Noppen (8–160). Dazu Steintyp, Helligkeit, Kontrast, Sättigung und Dithering sowie die erlaubten LEGO-Farben, einzeln oder als Vorauswahl (Graustufen, Sepia, Porträt …).
   Die Farben werden in CIELAB mit **CIEDE2000** zugeordnet, auf Wunsch mit Floyd-Steinberg-Dithering.
   **Steine & Konturen:** Steintyp für Flächen und für Konturen getrennt wählbar (z. B. runde Platten in Flächen, eckige Fliesen an Kanten wie bei LEGO-Art-Bildern). Gleichfarbige eckige Fliesen werden zu 1×2- bis 1×4-Fliesen zusammengefasst. **Halbe Noppen:** An schrägen und runden Kanten kommt auf eine 1×1-Platte eine Viertel- oder Halbkreis-Fliese in der Nachbarfarbe; das glättet Konturen unterhalb der Noppen-Auflösung und gibt ein leichtes Relief. **Schärfen** (Unscharf-Maskieren) macht Kanten klarer; die Abtastung entscheidet je Stein selbst, ob sie die vorherrschende Farbe (Schrift, Fenster, harte Kanten – dünne helle Linien bleiben dabei erhalten) oder den Mittelwert (Haut, Verläufe) nimmt. **Vereinfachen** glättet Flächen kantenerhaltend und verschmilzt kleine Farbinseln mit der passendsten Nachbarfläche – das Ergebnis wirkt ruhiger, mit weniger Farben und mehr langen Fliesen. Konturen gelten nur zwischen echten Flächen, und lange Fliesen laufen entlang der Kanten.
   **Anzahl Farben:** Statt aller erlaubten Farben wählt die App auf Wunsch die 2–16 passendsten LEGO-Farben für genau dieses Bild (gierige Reduktion mit ΔE2000², danach Tauschschritte, damit keine Farbfamilie komplett verloren geht). Einzelne Farben lassen sich festhalten 📌. Zusammen mit „Vereinfachen“ entsteht ein flächiger Plakat-Look.
   **Bereiche:** Die App zerlegt das Bild graphbasiert in zusammenhängende, farblich ähnliche Bereiche (Titel, Gesicht, Himmel, Rahmen …). Antippen in der Vorschau oder in der Liste wählt einen Bereich; „alle ähnlichen“ nimmt farbgleiche Bereiche dazu (z. B. alle Buchstaben). Pro Bereich: **ausblenden** (mit der Umgebungsfarbe füllen), **Ebene** festlegen oder **umfärben**. Die Aktionen bleiben erhalten, wenn du andere Einstellungen änderst.
   **Ebenen (Relief):** „Tiefe automatisch“ holt Flächen, die sich farblich vom Hintergrund (größte zusammenhängende Fläche) abheben, 1–3 Plattenhöhen nach vorne; die Stufenkanten folgen den Farbflächen. Die Vorschau zeigt das mit Schatten und Lichtkanten. Einen Rahmen um das Motiv vorher wegschneiden, sonst kommt er mit nach vorne.
2. **Bearbeiten:** Steine selbst setzen mit Pinsel, Füllen, Pipette und Verschieben, Rückgängig/Wiederholen, Zoom und 16er-Raster. Zur Wahl stehen alle 41 LEGO-Farben.
   Werkzeuge **Form** (Steintyp je Stein), **Halbe Noppe** (erneuter Klick dreht) und **Ebene** (Bereiche auf Ebene 0 bis +3 malen). Tastenkürzel: `B` Pinsel, `F` Füllen, `I` Pipette, `S` Form, `H` halbe Noppe, `L` Ebene, `R` drehen, `Strg+Z`/`Strg+Y`, Leertaste + Ziehen zum Verschieben, `Strg` + Mausrad zum Zoomen.
3. **Bestellliste:** Stückzahlen je Farbe mit LEGO-Farb-ID und BrickLink-Farb-ID, wahlweise mit Reserve und den Platten für den Unterbau. Bei Ebenen kommen die Sockelplatten dazu, in einer Farbe nach Wahl (Standard Schwarz) oder „wie Oberfläche“, dann haben die sichtbaren Seiten der Stufen die Bildfarbe.
   Export als **CSV** und als **BrickLink Wanted List (XML)**. Drucken ist ebenfalls möglich.
4. **Anleitung:** Deckblatt mit Übersicht und Farblegende, je ein Plan für die beiden Lagen des Unterbaus und für jede Ebene, danach eine Seite pro 16×16-Abschnitt mit nummeriertem Raster und Teileliste. Über den Druckdialog lässt sie sich als PDF speichern.

Das Projekt wird automatisch im Browser gespeichert (IndexedDB). Über **Projekt → speichern/öffnen** lässt es sich als `.json` sichern, inklusive Foto. Die App funktioniert nach dem ersten Aufruf offline und kann installiert werden.

## Ebenen

Unter einer erhöhten Zelle liegen pro Stufe Platten: Stufe +1 sitzt auf dem Unterbau, Stufe +2 auf Stufe +1 usw. Die App deckt jede Stufe gierig mit möglichst großen Standard-Platten ab, ohne über die 16er-Abschnitte hinauszugehen (`js/layers.js`). Lange Fliesen werden nie über eine Stufenkante zusammengefasst. In den Abschnitten der Anleitung sind erhöhte Bereiche violett umrandet und mit **+1**, **+2** … beschriftet.

## Teile & Farben

- Steintypen: Platte rund 1×1 (BL 4073), Fliese rund 1×1 (BL 98138), Platte 1×1 (BL 3024), Fliese 1×1 (BL 3070b). Unterbau: automatisch geplant aus Standard-Platten (1×1 bis 16×16, siehe `js/substructure.js`).

## Unterbau

Da A-Formate keine Vielfachen von 16 Noppen sind, plant die App einen Unterbau aus zwei Lagen echter LEGO-Platten:

- **Lage 2 (oben)** trägt die Mosaiksteine, **Lage 1 (unten)** verbindet die Platten der oberen Lage.
- Jede Lage wird in Bänder gleicher Plattenhöhe zerlegt, waagrecht oder senkrecht, je nachdem, was weniger Platten braucht. Jedes Band wird dann mit möglichst wenigen Platten gefüllt (dynamische Programmierung).
- Die untere Lage meidet Fugen der oberen Lage. Bei allen A-Formaten liegt keine Fuge über einer anderen, und es entsteht keine durchgehende Knickkante.
- Konturen: Fliese 1×2 (BL 3069b), 1×3 (BL 63864), 1×4 (BL 2431); halbe Noppen: Fliese 1×1 Viertelkreis (BL 25269), Fliese 1×1 Halbkreis (BL 24246), jeweils auf Platte 1×1 (BL 3024).
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
| `js/pieces.js` | Formen je Zelle, Konturen, halbe Noppen, lange Fliesen, Stückliste (DOM-frei, getestet) |
| `js/substructure.js` | Unterbau-Planung aus LEGO-Platten (DOM-frei, getestet) |
| `js/orderlist.js` | Bestellliste, CSV, BrickLink-XML |
| `js/instructions.js` | Bauanleitung |
| `js/app.js` | Oberfläche und Zustand |
| `sw.js`, `manifest.webmanifest` | PWA |

LEGO® ist eine Marke der LEGO Gruppe, die dieses Projekt weder unterstützt noch autorisiert.

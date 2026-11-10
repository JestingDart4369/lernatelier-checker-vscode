# Datenschutz

Diese Erklärung gilt für die Erweiterung „Lernatelier Checker“ des Marketplace-Publishers `JestingDart4369`.

## Keine Datensammlung

- Die Erweiterung sammelt, speichert und sendet keine persönlichen Daten und keine Nutzungsdaten.
- Sie enthält keine Telemetrie und keine Analyse-Werkzeuge.
- Sie stellt keine Verbindung ins Internet her.
- Sie startet keine Programme und führt keine Skripte aus.

## Was sie liest und schreibt

- **Lesen**: nur Dateien im geöffneten Ordner, die zum Muster `lernatelier.filePattern` passen (Standard `Lernperiode-*.md`), und die Kalender-Dateien `lernperiode.json` und `lernperiode-N.json` im selben Ordner. Mit `lernatelier.checkWorkspace` aus nur die offenen Lernperiode-Dateien.
- **Schreiben**: nur wenn du einen Befehl ausführst:
  - „Neue Lernperiode erstellen“ legt `Lernperiode-N.md` an,
  - der Kalender-Editor schreibt `lernperiode.json` oder `lernperiode-N.json` (der Name steht im Titel), wenn du „Speichern“ drückst,
  - „Nächste Tagesplanung einfügen“ fügt Text in die offene Datei ein,
  - eine schnelle Korrektur (Glühbirne) ändert die offene Datei an der angezeigten Stelle.

  Eine bestehende `Lernperiode-N.md` wird nie überschrieben. Eine bestehende Kalender-Datei lädt der Kalender-Editor zuerst; ersetzt wird sie nur, wenn du dort „Speichern (ersetzt die bestehende Datei)“ drückst.

Der Kalender-Editor und die Seitenleiste sind Webansichten innerhalb von VS Code. Sie laden nichts aus dem Internet und dürfen nur die Befehle der Erweiterung ausführen.

Die Liste der ignorierten Lernperioden speichert VS Code lokal für den geöffneten Ordner (Arbeitsbereichsspeicher der Erweiterung). Sie verlässt deinen Computer nicht.

Die Ergebnisse der Prüfung bleiben in VS Code (Bereich „Probleme“, Statusleiste, Ausgabebereich) und werden nicht gespeichert.

## Kontakt

Fragen zum Datenschutz: https://github.com/JestingDart4369/lernatelier-checker-vscode/issues

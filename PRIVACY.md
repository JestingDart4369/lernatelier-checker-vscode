# Datenschutz

Diese Erklärung gilt für die Erweiterung „Lernatelier Checker“ des Marketplace-Publishers `JestingDart4369`.

## Keine Datensammlung

- Die Erweiterung sammelt, speichert und sendet keine persönlichen Daten und keine Nutzungsdaten.
- Sie enthält keine Telemetrie und keine Analyse-Werkzeuge.
- Sie stellt keine Verbindung ins Internet her.
- Sie startet keine Programme und führt keine Skripte aus.

## Was sie liest und schreibt

- **Lesen**: nur die geöffnete Datei, die zum Muster `lernatelier.filePattern` passt (Standard `Lernperiode-*.md`), und die Datei `lernperiode.json` im selben Ordner.
- **Schreiben**: nur wenn du einen Befehl ausführst:
  - „Neue Lernperiode erstellen“ legt `Lernperiode-N.md` an,
  - „lernperiode.json erstellen (Generator)“ legt `lernperiode.json` an,
  - „Nächste Tagesplanung einfügen“ fügt Text in die offene Datei ein.

  Eine bestehende `Lernperiode-N.md` wird nie überschrieben. Eine bestehende `lernperiode.json` wird nur ersetzt, wenn du in der Rückfrage „Ersetzen“ wählst.

Die Ergebnisse der Prüfung bleiben in VS Code (Bereich „Probleme“, Statusleiste, Ausgabebereich) und werden nicht gespeichert.

## Kontakt

Fragen zum Datenschutz: https://github.com/JestingDart4369/lernatelier-checker-vscode/issues

# Changelog

## 0.2.0

- **lernperiode.json-Generator**: „Lernatelier: lernperiode.json erstellen (Generator) …“ übernimmt Nummer und Zeitraum aus der offenen Lernperiode-Datei, fragt nach den Wochentagen des Lernateliers und zeigt alle Daten im Zeitraum als Liste, in der man Ferien und freie Tage abwählt. Eine bestehende lernperiode.json wird nur nach Rückfrage ersetzt.
- Erste Version, die automatisch über GitHub veröffentlicht wird.

## 0.1.0

- Erste Version.
- Prüft `Lernperiode-*.md` mit der Bibliothek lernatelier-checker-js (Stand b569902) beim Öffnen, Speichern und Tippen.
- Hinweise in der Datei und im Bereich „Probleme“; Hinweise ohne genaue Stelle erscheinen auf der passenden Zeile (Name, Zeitraum, Überschrift, Grobplanung, Tagesplanungen).
- Ampel in der Statusleiste und Bericht im Ausgabebereich.
- Kalenderprüfung mit `lernperiode.json` (gleiches Format wie das Python-Werkzeug), mit Vorschlägen und Prüfung beim Bearbeiten der Datei.
- Befehle: Neue Lernperiode aus der Vorlage, lernperiode.json erstellen, nächste Tagesplanung einfügen.

# Changelog

## 0.2.0

- **Kalender-Editor** für `lernperiode.json`: Formular mit Nummer und Zeitraum aus dem Dokument, Wochentagen, allen Daten im Zeitraum zum Abwählen der Ferien, zusätzlichen Tagen und Vorschau. Lädt und bearbeitet eine bestehende Datei.
- **Seitenleiste „Lernatelier“** mit Ampel, Hinweisen (Klick springt zur Zeile), Kalender und Knöpfen für alle Befehle.
- **Kalender-Knopf in der Statusleiste** neben der Ampel: „Kalender erstellen“ oder die Anzahl Unterrichtstage.
- Neuer Befehl „Lernperiode öffnen …“; Kalender-Symbol auch oben rechts im Editor.
- **Ganzer Ordner**: Alle `Lernperiode-*.md` im Ordner werden geprüft, auch ungeöffnete; Änderungen auf der Festplatte werden erkannt. Die Ampel zeigt weiterhin die aktive Datei. Einstellung `lernatelier.checkWorkspace`.
- **Ignorieren**: abgeschlossene Lernperioden pro Datei oder mit „Ältere ignorieren“ ausblenden; lokal gespeichert, mit „Prüfen“ wieder einschalten. Liste „Alle Lernperioden“ in der Seitenleiste.
- **Snippets** für Markdown: `lernperiode` (ganze Vorlage, aus der offiziellen Vorlage erzeugt), `planung` (Tagesplanung mit heutigem Datum), `tagesreflexion` und `arbeitspaket`.
- Erste Version, die automatisch über GitHub veröffentlicht wird.

## 0.1.0

- Erste Version.
- Prüft `Lernperiode-*.md` mit der Bibliothek lernatelier-checker-js (Stand b569902) beim Öffnen, Speichern und Tippen.
- Hinweise in der Datei und im Bereich „Probleme“; Hinweise ohne genaue Stelle erscheinen auf der passenden Zeile (Name, Zeitraum, Überschrift, Grobplanung, Tagesplanungen).
- Ampel in der Statusleiste und Bericht im Ausgabebereich.
- Kalenderprüfung mit `lernperiode.json` (gleiches Format wie das Python-Werkzeug), mit Vorschlägen und Prüfung beim Bearbeiten der Datei.
- Befehle: Neue Lernperiode aus der Vorlage, lernperiode.json erstellen, nächste Tagesplanung einfügen.

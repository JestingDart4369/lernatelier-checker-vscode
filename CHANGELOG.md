# Changelog

## 0.4.0

- **Offene Arbeitspakete übernehmen**: nicht abgehakte Arbeitspakete des letzten Tages in die nächste Tagesplanung kopieren (ersetzt zuerst Platzhalter, legt den Tag bei Bedarf an). Als Befehl, in der Seitenleiste und in der Glühbirne auf einer Tages-Überschrift.
- **Explorer**: ✓ hinter fertigen Lernperioden, – hinter ignorierten. Einstellung `lernatelier.explorerBadges`.
- **Erinnerung** einmal am Tag, wenn die Tagesplanung für heute oder den nächsten Unterrichtstag fehlt, mit „Jetzt einfügen“. Einstellung `lernatelier.reminder`.
- **Erste Schritte**: geführte Einführung in fünf Schritten (Befehl „Lernatelier: Erste Schritte“ und Knopf in der Seitenleiste).
- Für die Entwicklung: ein wöchentlicher GitHub-Workflow prüft, ob die Bibliothek lernatelier-checker-js neue Commits hat, probiert das Update aus und meldet es als Issue.

## 0.3.1

- **Mehrere Lernperioden im selben Ordner**: Die `lernperiode.json` gilt nur noch für die Lernperiode mit der Nummer aus `learningperiod`. Andere Lernperioden werden ohne Kalender geprüft statt rot markiert; die Seitenleiste sagt, warum.
- Eigene Kalender pro Lernperiode mit `lernperiode-N.json` (z. B. `lernperiode-4.json`); sie haben Vorrang. Der Kalender-Editor speichert automatisch in die passende Datei, die JSON-Prüfung gilt auch für diese Dateien.

## 0.3.0

- **Fortschritt** in der Seitenleiste: vollständige Tage, erledigte Arbeitspakete, Tagesreflexionen, Grobplanung und Lernperiodenreflexion als Balken, dazu alle Tage mit ihrem Stand; ein Klick springt zum Tag oder fügt einen fehlenden ein.
- **Schnelle Korrekturen** (Glühbirne): Namen eintragen, Nummer und Zeitraum übernehmen, fehlende Tagesplanung einfügen, Datum einsetzen, Arbeitspakete hinzufügen, Tag als abwesend markieren, leeres Arbeitspaket entfernen.
- **Hinweise am Zeilenende**: Arbeitspakete pro Tag, Wörter der Reflexionen und Zeichen der Grobplanung, live beim Tippen. Einstellung `lernatelier.inlineHints`.

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

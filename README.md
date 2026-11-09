# Lernatelier Checker

Prüft deine Lernatelier-Dokumentation (`Lernperiode-N.md`) direkt beim Schreiben auf formale Vollständigkeit. Fehlende Angaben erscheinen als Hinweise in der Datei und im Bereich **Probleme**, und eine Ampel in der Statusleiste zeigt, wie weit dein Dokument ist.

Die Regeln stammen aus der Bibliothek [lernatelier-checker-js](https://github.com/djlauk/lernatelier-checker-js) von Daniel J. Lauk. Die Erweiterung verwendet sie unverändert, du bekommst also dieselben Ergebnisse wie mit dem Prüfwerkzeug der Schule.

## Was du siehst

- **Hinweise in der Datei**: Wellenlinien genau an der Stelle, an der etwas fehlt, zum Beispiel unter `- Name:`, unter einer Tagesplanung mit zu wenig Arbeitspaketen oder unter einem Arbeitspaket, das nur `...Ihr Text...` enthält.
- **Bereich „Probleme“** (`Strg`+`Shift`+`M`, auf dem Mac `Cmd`+`Shift`+`M`): alle Fehler und Warnungen mit Zeilennummer. Ein Klick springt an die Stelle.
- **Ampel in der Statusleiste**, unten links, solange eine Lernperiode-Datei offen ist:
  - grünes Häkchen: alles in Ordnung,
  - gelbes Warnzeichen: Verbesserungsbedarf (nur Warnungen),
  - rotes Fehlerzeichen: Handlungsbedarf (mindestens ein Fehler).

  Die Zahl daneben ist die Anzahl der Hinweise. Ein Klick öffnet den Bericht.
- **Bericht**: dieselbe Übersicht wie beim Kommandozeilen-Werkzeug, mit Zeilennummern, im Ausgabebereich „Lernatelier Checker“.

Geprüft wird beim Öffnen, beim Speichern und, wenn du willst, schon beim Tippen.

## Was geprüft wird

- Nummer der Lernperiode in der Überschrift `# Lern-Periode N`
- `Name:` ist ausgefüllt (nicht „Exemplibus Exemplio“)
- `Zeitraum: TT.MM.JJJJ bis TT.MM.JJJJ` ist gültig
- Die vier Abschnitte der Grobplanung (Noten, Veränderungen, Projekte / neue Technologien, Generelle Ziele) enthalten je mindestens 20 Zeichen eigenen Text
- Jede Tagesplanung hat ein gültiges Datum, kommt nur einmal vor und liegt im Zeitraum
- Jede verlangte Tagesplanung hat 3 bis 5 ausgefüllte Arbeitspakete; Platzhalter zählen nicht
- Tagesreflexionen haben 50 bis 100 Wörter, die Lernperiodenreflexion 100 bis 200 Wörter
- Doppelte oder falsch eingeordnete Abschnitte werden gemeldet
- Abwesenheit: Steht direkt unter der Tagesüberschrift allein `krank`, `Krankheit`, `abwesend`, `Absenz`, `absent` oder `absence`, werden für diesen Tag keine Arbeitspakete und keine Reflexion verlangt.

Grün heisst **formal vollständig**. Die Qualität der Arbeitspakete, Ziele und Reflexionen beurteilt weiterhin deine Lehrperson.

## Kalender: lernperiode.json

Liegt im selben Ordner wie deine Lernperiode-Datei eine `lernperiode.json`, prüft die Erweiterung zusätzlich nach Kalender:

```json
{
  "learningperiod": 5,
  "days": ["2026-09-18", "2026-09-25", "2026-10-02"]
}
```

- `learningperiod`: Nummer der Lernperiode; sie muss zur Überschrift passen.
- `days`: die Unterrichtstage im Format JJJJ-MM-TT.

Mit Kalender werden Tagesplanungen bis heute und für den **nächsten** Unterrichtstag verlangt, spätere Tage dürfen noch Platzhalter enthalten. Tagesreflexionen sind am jeweiligen Tag fällig, die Lernperiodenreflexion am letzten Unterrichtstag. Ohne `lernperiode.json` wird das Dokument wie ein fertiges geprüft.

Es ist dasselbe Format wie beim Python-Werkzeug `lernatelier-checker`. Beim Bearbeiten der Datei schlägt VS Code die Felder vor und markiert falsche Daten.

## Befehle

Öffne die Befehlspalette (`Strg`+`Shift`+`P`, auf dem Mac `Cmd`+`Shift`+`P`) und tippe „Lernatelier“:

- **Lernatelier: Dokument prüfen** prüft die offene Datei sofort und zeigt den Bericht. Auch über das Häkchen-Symbol oben rechts im Editor.
- **Lernatelier: Bericht anzeigen** zeigt den Bericht der offenen Datei.
- **Lernatelier: Neue Lernperiode erstellen …** fragt nach der Nummer und legt `Lernperiode-N.md` aus der offiziellen Vorlage an. Bestehende Dateien werden nie überschrieben.
- **Lernatelier: lernperiode.json erstellen …** fragt nach der Nummer und den Unterrichtstagen (z. B. `18.09.2026, 25.09.2026`) und legt die Datei an.
- **Lernatelier: Nächste Tagesplanung einfügen** fügt vor „Lernperiode Reflexion“ eine neue Tagesplanung mit drei leeren Arbeitspaketen und einer Tagesreflexion ein. Mit `lernperiode.json` nimmt sie den nächsten Unterrichtstag, der noch fehlt, sonst fragt sie nach dem Datum.

## Einstellungen

- `lernatelier.enable`: automatisch prüfen (Standard: an)
- `lernatelier.filePattern`: welche Dateien geprüft werden (Standard: `**/Lernperiode-*.md`)
- `lernatelier.checkWhileTyping`: schon beim Tippen prüfen (Standard: an); aus = nur beim Öffnen und Speichern

## Datenschutz

Die Erweiterung liest nur die offene Lernperiode-Datei und die `lernperiode.json` daneben. Sie sendet nichts ins Internet, sammelt keine Daten und schreibt nur, wenn du einen der Befehle zum Erstellen oder Einfügen ausführst. Details stehen in [PRIVACY.md](PRIVACY.md).

## Hilfe und Fehler melden

Fragen und Fehler bitte als [GitHub Issue](https://github.com/JestingDart4369/lernatelier-checker-vscode/issues) melden, siehe [SUPPORT.md](SUPPORT.md). Wenn eine Regel deiner Meinung nach falsch prüft, ist das meist eine Frage an die Bibliothek: [lernatelier-checker-js](https://github.com/djlauk/lernatelier-checker-js).

## Lizenz

MIT, siehe [LICENSE](LICENSE). Die enthaltene Bibliothek lernatelier-checker-js und alle weiteren Bestandteile sind in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) mit ihren Lizenzen aufgeführt.

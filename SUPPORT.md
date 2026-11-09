# Hilfe

Die Erweiterung wird vom Marketplace-Publisher `JestingDart4369` in der Freizeit gepflegt.

## Fragen, Fehler und Ideen

Bitte als GitHub Issue melden: https://github.com/JestingDart4369/lernatelier-checker-vscode/issues

Hilfreich sind:

- die Version der Erweiterung (Erweiterungen → Lernatelier Checker) und von VS Code (Hilfe → Info),
- der Bericht aus **Lernatelier: Bericht anzeigen**,
- ein kurzer Ausschnitt der Stelle, an der etwas falsch geprüft wird (ohne persönliche Angaben).

## Falsch geprüft?

Die Regeln kommen aus der Bibliothek [lernatelier-checker-js](https://github.com/djlauk/lernatelier-checker-js). Wenn eine Regel selbst falsch ist, gehört das Issue dorthin. Wenn die Stelle in VS Code falsch markiert ist oder ein Befehl nicht funktioniert, hierher.

## Erste Schritte bei Problemen

- Heisst die Datei `Lernperiode-N.md`? Sonst passe `lernatelier.filePattern` an.
- Ist `lernatelier.enable` eingeschaltet?
- Hat `lernperiode.json` Fehler? Sie werden im Bereich „Probleme“ bei dieser Datei angezeigt.

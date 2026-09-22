# ZeichenLex

Installierbare Progressive Web App (PWA) für ein eigenes Gebärden-Wörterbuch.

## Funktionen

- Gebärden mit Wort + optionaler Notiz speichern
- Foto oder Video aus der Galerie
- Foto direkt aufnehmen
- Video direkt aufnehmen
- Suche
- Text → Gebärden: passende Videos werden nebeneinander angezeigt und nacheinander abgespielt
- Offline-fähig
- Als App installierbar

## GitHub Pages

Für die Installierbarkeit muss die App über HTTPS laufen. GitHub Pages ist dafür geeignet.

In GitHub:
1. **Settings**
2. **Pages**
3. Unter **Build and deployment**: `Deploy from a branch`
4. Branch `main`, Ordner `/ (root)`
5. Speichern

Danach die GitHub-Pages-Adresse im Browser öffnen. Unterstützte Browser zeigen dann „App installieren“ an.

## Speicherung

Die Einträge und hochgeladenen Medien werden derzeit lokal im Browser/auf dem Gerät mit IndexedDB gespeichert. Eine gemeinsame Online-Datenbank kann später ergänzt werden.

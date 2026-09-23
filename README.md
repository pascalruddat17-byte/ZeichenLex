# ZeichenLex v4

Installierbare PWA für ein eigenes Gebärden-Wörterbuch.

## Verbesserungen
- komplett neue mobile Oberfläche
- Schnellaufnahme von der Startseite
- nur das Wort ist Pflicht
- Videos, Fotos oder Galerie
- Favoriten
- Synonyme / alternative Wörter
- Suche, Filter und Sortierung
- Text → Gebärden mit automatischer Videokette
- fehlende Wörter direkt hinzufügen
- Vollbildansicht
- Datenexport und -import inklusive Medien
- Offline-Modus
- als App installierbar
- bestehende lokale ZeichenLex-Daten bleiben kompatibel

## GitHub Pages
Repository erstellen, alle Dateien hochladen und unter **Settings → Pages** `Deploy from a branch`, `main`, `/ (root)` aktivieren.

## Wichtig
Die Einträge liegen aktuell lokal in IndexedDB. Für Synchronisierung zwischen mehreren Geräten braucht die App später ein Online-Backend.


## Neu in v4: Ausschnitt anpassen
Nach einer Video- oder Fotoaufnahme kannst du das Medium direkt in einem 16:9-Rahmen:
- mit dem Finger verschieben
- zoomen
- um 90° drehen
- auf Querformat füllen oder komplett anzeigen
- wieder zentrieren/zurücksetzen

Die Einstellung wird pro Gebärde gespeichert und auch beim Übersetzen verwendet.


## Neu in v5
- helles blaues Design
- neues App-Logo
- hellere PWA-Farben für Browser und Homescreen


## v6: Cloud-Sync ohne Anmeldung

Diese Version kann **eine gemeinsame ZeichenLex-Sammlung** automatisch zwischen Handy, PC und installierter PWA synchronisieren.

### Einmalig einrichten
1. Auf **supabase.com** ein kostenloses Projekt erstellen.
2. Im **SQL Editor** die Datei `supabase-setup.sql` ausführen.
3. In Supabase unter **Project Settings → API** die **Project URL** und den **anon public key** kopieren.
4. `cloud-config.js` öffnen und beide Werte eintragen.
5. Dateien auf GitHub Pages hochladen.

Danach:
- neue/änderte Gebärden werden automatisch hochgeladen
- Fotos/Videos liegen im Supabase Storage
- andere Geräte laden die Sammlung automatisch
- offline gemachte Änderungen werden lokal gespeichert und beim nächsten Internetzugang synchronisiert
- zusätzlich gibt es unter **Mehr → Cloud-Sync** einen manuellen Sync-Button

### Wichtig bei „ohne Anmeldung“
Weil du ausdrücklich keine Anmeldung möchtest, erlauben die mitgelieferten Supabase-Regeln anonymes Lesen und Schreiben. Wenn die Website öffentlich erreichbar ist, können technisch auch andere Besucher die gemeinsame Sammlung verändern. Für eine private, wirklich geschützte Sammlung wäre später eine Anmeldung oder ein kleines geschütztes Backend nötig.

# 📺 mediathekwebloader

Ein leichtgewichtiges Web-Tool zum **Suchen, Auswählen und Weiterleiten von Sendungen aus öffentlich zugänglichen Mediatheken** an deinen eigenen Download-Manager (pyLoad).

Kein Hosting.
Kein Streaming-Proxy.
Nur strukturierte Auswahl und Übergabe.

---

## ✨ Funktionen

* 🔎 Suche nach Sendungen (Suchbegriff + Senderfilter)
* 📋 Ergebnisliste mit:

  * Titel
  * Sender
  * Datum
  * Dauer
  * Dateigröße
* 🎚 Auswahl von **Video, Untertiteln und Qualität** pro Treffer
* 📦 Merkliste zum Sammeln mehrerer Sendungen
* 📤 Export als reine Linkliste
* ⚡ Direktversand an **pyLoad**

  * Alle Einträge als ein Paket
  * Oder ein Paket pro Sendung (Paketname = Titel)
* ⚙ Konfigurierbar:

  * pyLoad Host / Port
  * Benutzer / Passwort
  * Treffer pro Seite

---

## 🛠 Architektur

* Backend: Python
* Frontend: Web UI (lokal betreibbar)
* Integration: pyLoad API
* Datenbasis: Öffentlich zugängliche Mediathek-Indexdaten

Die Anwendung:

* entschlüsselt keine Inhalte
* umgeht keine Schutzmechanismen
* hostet oder spiegelt keine Medien
* greift nicht in Streamingprozesse ein

---

## 🚀 Installation

```bash
git clone https://github.com/DEINUSER/mediathekwebloader.git
cd mediathekwebloader
pip install -r requirements.txt
```

Starten:

```bash
python app.py
```

Im Browser öffnen:

```
http://localhost:PORT
```

---

## 📦 Typischer Workflow

1. Sendung suchen
2. Qualität auswählen
3. Zur Merkliste hinzufügen
4. An pyLoad senden
5. Lokal archivieren

---

## ⚖ Rechtlicher Hinweis (Disclaimer)

`mediathekwebloader` ist ein technisches Organisationswerkzeug.

Es stellt selbst keine Inhalte bereit und verändert keine Medien.
Die Anwendung nutzt ausschließlich öffentlich erreichbare Metadaten und Download-URLs.

Wichtig:

* Es werden keine DRM- oder Kopierschutzmechanismen umgangen.
* Es findet keine Entschlüsselung oder Manipulation von Streams statt.
* Es erfolgt keine Weiterverbreitung oder öffentliche Bereitstellung durch diese Software.

Die Nutzung erfolgt in eigener Verantwortung.
Der Anwender ist selbst dafür verantwortlich:

* geltendes Urheberrecht einzuhalten
* Nutzungsbedingungen der jeweiligen Sender zu beachten
* Inhalte ausschließlich im rechtlich zulässigen Rahmen (z. B. privat) zu verwenden

Dieses Projekt bietet keine Rechtsberatung.

---

## 🛑 Projektprinzipien

Nicht Bestandteil dieses Projekts sind:

* DRM-Umgehung
* Geo-Bypass
* automatisierte Massenarchivierung gegen Plattformregeln
* Hosting oder Spiegelung von Medien

Wenn Inhalte nicht mehr öffentlich verfügbar sind, respektiert die Anwendung dies.

---

## 🤝 Mitwirken

Pull Requests sind willkommen, sofern sie:

* Stabilität verbessern
* die Benutzerfreundlichkeit erhöhen
* die nicht-invasive Architektur wahren

Beiträge zur Umgehung technischer Schutzmaßnahmen werden nicht aufgenommen.

---

## 🧭 Leitgedanke

> Öffentlich zugänglich bleibt öffentlich zugänglich.
> Dieses Tool hilft nur beim strukturierten Verwalten.

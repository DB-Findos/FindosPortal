# Persistenter Chat

Migration `011-chat-history` ergänzt vier historisierte Entities:

| Entity | Inhalt |
| --- | --- |
| `chat_conversations` | Nutzer, Titel und zuletzt verwendetes Modell/Reasoning-Effort |
| `chat_messages` | Nachrichtentext, Rolle, Sendezeit, Konversation, Frage-ID, Antwortdauer in Millisekunden, Modell/Effort, Status und Vorschläge |
| `chat_documents` | Dateiname, Zeitpunkt, Download-Link, Endung, MIME-Typ, Größe, Herkunft, SHA-256, Originaldatei und extrahierter Text |
| `chat_message_files` | Referenzen zwischen Nachrichten und Dokumenten |

Alle vier Entities verwenden die bestehenden Versionsfelder und Audit-Trigger. Die Tabellen werden über die Chat-API und spezialisierte MCP-Werkzeuge angesprochen. Generische Tabellenabfragen und Änderungswerkzeuge können keine privaten Chats lesen oder ändern. Jeder Zugriff auf Nachrichten und Dokumente prüft den Konversationsbesitzer – auch für Administratoren.

Der Server speichert zuerst die Nutzernachricht und lädt dann den **vollständigen gespeicherten Textverlauf**. Es gibt keine Begrenzung auf die letzten zwölf Nachrichten mehr. Ein überschrittenes Modell-Kontextfenster wird ausdrücklich als Fehler gespeichert; es wird nicht still gekürzt. Alte, bisher ausschließlich im Browser gehaltene Chats können nicht rückwirkend rekonstruiert werden.

`sent_at` der Frage ist die serverseitige Annahmezeit nach dem Dateiupload. `response_time_ms` ist die Differenz zur serverseitigen Antwortzeit einschließlich Werkzeugaufrufen. Auch Fehlerantworten bleiben gespeichert. Bei einem Prozessabbruch bleibt eine angenommene Frage erhalten; nach zehn Minuten darf eine neue Frage gesendet werden, wenn keine Antwort mehr eingetroffen ist.

Oben im Chat lassen sich ältere Konversationen laden und fortsetzen. Modell und Effort gelten für die nächste Nachricht und werden sowohl an der Konversation als auch an jeder Nachricht gespeichert. Standardmäßig verfügbar:

- `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`: none, low, medium, high, xhigh
- `gpt-5-mini`: minimal, low, medium, high
- `gpt-5`: minimal, low, medium, high
- `gpt-4.1`: none (kein Reasoning-Parameter)

`OPENAI_MODEL` bestimmt das vorausgewählte Modell. Optional kann `OPENAI_CHAT_MODELS_JSON` die serverseitige Auswahlliste ersetzen, beispielsweise:

```json
[{"id":"gpt-5-mini","label":"GPT-5 mini","efforts":["low","medium","high"]}]
```

Die Modell-IDs müssen für den verwendeten API-Key zugänglich sein und Chat Completions mit Tools/JSON unterstützen. Die gewählten Effort-Werte müssen vom jeweiligen Modell unterstützt werden. Referenz: [OpenAI Reasoning](https://developers.openai.com/api/docs/guides/reasoning).

Anhänge: maximal zehn Dateien je Nachricht mit jeweils bis zu 5 MB. Unterstützt werden PDF, DOCX, XLSX, TXT, MD, CSV und JSON. Originaldateien bleiben in Neon gespeichert und über authentifizierte Download-Links verfügbar. Text wird auf maximal zwei Millionen Zeichen extrahiert und über `read_document` in Abschnitten abgerufen. Gescannten PDFs ohne Textschicht fehlt eine OCR; Extraktionsfehler/-begrenzungen werden angezeigt. KI-generierte TXT-, MD-, CSV- und JSON-Dateien werden ebenfalls gespeichert und der Antwort zugeordnet.

Neue MCP-Werkzeuge: `list_conversations`, `read_conversation`, `read_document`, `create_document`. `create_document` benötigt extern Schreibberechtigung; der interne Chat darf angeforderte Dokumente innerhalb der aktuellen Konversation erzeugen. Änderungen an Fachdaten bleiben an die Übernahme der Vorschlagskarte gebunden. Gespeicherte Vorschläge können nach erneutem Laden übernommen werden; dafür wird ausschließlich das serverseitig gespeicherte, nutzergebundene Token erneuert und die Änderung erneut validiert.

Kurzer Speichercheck ohne bleibende Testdaten und ohne OpenAI-Aufrufe:

```powershell
npx tsx backend/src/tests/chat-storage-smoke.ts
```

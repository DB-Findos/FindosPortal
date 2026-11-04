# Zentrales Dokumentregister

`portal.documents` ist die zentrale versionierte Metadaten-Entity für Dokumente aller Anwendungsbereiche. Im Data Management erscheinen **Dokumente**, **Dokumenttypen** und **Dokumentherkünfte**. Typ und Herkunft werden als Referenzen auf pflegbare Stammdaten gespeichert, nicht als freie Textwerte.

Dokumente enthalten Name, Beschreibung, Dokumenttyp, Herkunft, Link, Endung, MIME-Typ, Größe und Uploadzeit sowie optionale Company-/Fund-Referenzen. Automatische Uploads ergänzen Hash, Speicheranbieter und Speicherreferenzen. Alle Änderungen verwenden die bestehende Historisierung und den angemeldeten Benutzer. In der allgemeinen Dokumentverwaltung können Administratoren Metadaten ändern und weitere Dokumentlinks anlegen; Lesezugriff wird über die vorhandenen Entity-Berechtigungen gesteuert.

Vorbelegte Typen: Vorlage, Bericht, Vertrag, Präsentation, Sonstiges. Herkünfte: Knowledge Management, Chat-Upload, KI-generiert, Manuell. Neue Klassifizierungen können über das übliche Plus im Data Management angelegt werden. Schlüssel bleiben nach der Anlage stabil; für automatische Registrierungen benötigte Stammdatensätze können nicht archiviert werden.

Migration `026-document-registry` übernimmt vorhandene Knowledge-/Chat-Dateireferenzen und registriert neue Uploads per Datenbanktrigger in derselben Transaktion. Die ursprünglichen Knowledge-/Chat-Datensätze bleiben als technische Anhänge und für vorhandene Download-/Chat-Funktionen erhalten; `source_entity` und `source_object_id` verbinden sie mit dem zentralen Dokument. Dateien werden dabei nicht kopiert. Knowledge-Dateien liegen weiterhin in SharePoint; bestehende Chat-Dateien behalten ihren bisherigen Speicherort.

Knowledge liest Name und Link aus dem zentralen Register. Das Entfernen einer Knowledge-Verknüpfung belässt das Dokument im Register. Ein noch verknüpftes Dokument kann dort nicht archiviert werden. Die frühere Entity Knowledge Templates wird im Data-Management-Tree zugunsten von Dokumente ausgeblendet.

Private Chat-Dateien sind im zentralen Register mit Besitzer und privater Sichtbarkeit hinterlegt. Sie bleiben ausschließlich über die vorhandenen, besitzergeprüften Chat-Funktionen verfügbar; die allgemeinen Data-/MCP-/Advanced-Search-Zugriffe liefern nur gemeinsame Dokumente. Es werden dadurch keine privaten Chatinhalte veröffentlicht.

SharePoint-Dateien werden über authentifizierte Backend-Endpunkte heruntergeladen: `/api/documents/:id/download` beziehungsweise `/api/knowledge/entries/:id/templates/:documentId/download`. Das Backend prüft Entity- und Knowledge-Berechtigungen, ruft die Datei mit der App-Registrierung ab und streamt sie als Attachment. Graph-Weiterleitungen werden nur serverseitig verfolgt; die App-Anmeldung und temporäre SharePoint-URLs gelangen nicht in den Browser. Die allgemeinen Data-/Search-/MCP-Antworten liefern für diese Dateien ebenfalls Anwendungslinks. Der gespeicherte SharePoint-Link bleibt eine technische Referenz; die Linkeingabe ist bei verwalteten SharePoint-Dateien in der Metadatenmaske ausgeblendet. Es werden keine Nutzerfreigaben angelegt und keine bestehenden Site-Berechtigungen geändert.

Der Upload akzeptiert eine von der Eingabedatei abweichende, gültige SharePoint-Speichergröße und speichert diese als `size_bytes`. Das vermeidet Fehlalarme bei Office-Dateien nach serverseitiger Verarbeitung. Die 25-MB-Grenze bleibt bestehen. `sha256` bezeichnet den ursprünglich hochgeladenen Byteinhalt.

Prüfung: vollständiger Build sowie gezielte Migration auf temporärem Neon-Zweig einschließlich automatischer Knowledge-/Chat-Registrierung, Klassifizierung, Audit-Referenzen und Ausschluss privater Dokumente aus allgemeinen Suchergebnissen. Testeinträge wurden zurückgerollt.

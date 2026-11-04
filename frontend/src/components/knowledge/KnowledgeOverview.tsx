import type { KnowledgeTree } from './types';

export default function KnowledgeOverview({
  overview,
}: {
  overview: NonNullable<KnowledgeTree['overview']>;
}) {
  return (
    <section className="km-overview" aria-label="Pflegestand">
      <div>
        <span>Einträge gesamt</span>
        <strong>{overview.total}</strong>
      </div>
      <div>
        <span>Inhalt gepflegt</span>
        <strong>
          {overview.maintained}
          <small> / {overview.total}</small>
        </strong>
      </div>
      <div>
        <span>Geprüft & aktuell</span>
        <strong>
          {overview.current}
          <small> / {overview.total}</small>
        </strong>
      </div>
      <div>
        <span>Prüfung offen</span>
        <strong>{overview.total - overview.current}</strong>
      </div>
    </section>
  );
}

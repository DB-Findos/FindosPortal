import { Link, useParams } from 'react-router-dom';
import { Database, Table2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useEffect } from 'react';
import PageHeading from '../components/common/PageHeading';
import DataTable from '../components/data/DataTable';
export default function DataManagementPage() {
  const { entity: entityName = 'funds' } = useParams();
  const { entities, refresh } = useAuth();
  const theme = useTheme();
  const entity = entities.find((e) => e.name === entityName);
  useEffect(() => {
    refresh();
  }, []);

  return (
    <>
      <PageHeading
        title="Data Management"
        description="Entities, aktuelle Datensätze und ihre Versionshistorie verwalten."
      />
      <div className="database-layout">
        <aside className="entity-tree">
          <div className="tree-heading">
            <Database size={15} /> portal <span>{entities.length}</span>
          </div>
          {entities.map((e) => (
            <Link
              key={e.name}
              className={e.name === entityName ? 'active' : ''}
              to={'/settings/data/' + e.name}
            >
              <Table2 size={14} />
              {e.label}
            </Link>
          ))}
        </aside>
        <section className="data-panel">
          <div className="entity-title">
            <Table2 size={18} />
            <h2>{entity?.label || 'Entity auswählen'}</h2>
            <code>portal.{entity?.name || '…'}</code>
          </div>
          {entity ? (
            <DataTable
              key={entity.name}
              fieldSelector
              entity={entity}
              entities={entities}
              onChange={() => {
                void refresh();
                if (['images', 'design_settings'].includes(entity.name)) void theme.refresh();
              }}
            />
          ) : (
            <div className="empty">Keine Leseberechtigung für diese Entity.</div>
          )}
        </section>
      </div>
    </>
  );
}

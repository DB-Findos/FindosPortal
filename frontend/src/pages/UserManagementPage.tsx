import { NavLink, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import PageHeading from '../components/common/PageHeading';
import DataTable from '../components/data/DataTable';
export default function UserManagementPage() {
  const { tab = 'users' } = useParams();
  const { entities, refresh } = useAuth();
  const entity = entities.find((e) => e.name === (tab === 'groups' ? 'user_groups' : 'users'));
  return (
    <>
      <PageHeading
        title="User Management"
        description="Benutzer, Gruppen und deren Zugriff verwalten."
      />
      <div className="tabs">
        <NavLink end to="/settings/users">
          User
        </NavLink>
        <NavLink to="/settings/users/groups">User-groups</NavLink>
      </div>
      {entity ? (
        <DataTable
          key={entity.name}
          entity={entity}
          entities={entities}
          onChange={() => void refresh()}
        />
      ) : (
        <div className="empty">Keine Leseberechtigung.</div>
      )}
    </>
  );
}

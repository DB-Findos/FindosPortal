import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { ApplicationModule } from '../../types/applications';
import ApplicationIcon from './ApplicationIcon';

export default function ApplicationTile({
  application,
  variant = 'external',
}: {
  application: ApplicationModule;
  variant?: 'primary' | 'external' | 'future';
}) {
  const available = Boolean(application.external_url || application.internal_path);
  const className = `application-tile application-tile-${variant}${available ? '' : ' is-unavailable'}`;
  const content = (
    <>
      <div className="application-tile-top">
        <span className="application-tile-icon">
          <ApplicationIcon application={application.key} />
        </span>
        {application.external_url ? (
          <ArrowUpRight size={19} />
        ) : available ? (
          <ArrowRight size={19} />
        ) : null}
      </div>
      <div className="application-tile-bottom">
        <h2>{application.name}</h2>
        {variant === 'primary' && <span>Bereich öffnen</span>}
      </div>
    </>
  );
  if (application.external_url)
    return (
      <a
        className={className}
        href={application.external_url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${application.name} in neuem Tab öffnen`}
      >
        {content}
      </a>
    );
  if (application.internal_path)
    return (
      <Link className={className} to={application.internal_path}>
        {content}
      </Link>
    );
  return (
    <article className={className} aria-disabled="true">
      {content}
    </article>
  );
}

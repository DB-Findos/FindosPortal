import { ChevronRight } from 'lucide-react';
export default function PageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <>
      <div className="breadcrumb">
        Einstellungen <ChevronRight size={13} /> {title}
      </div>
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <span className="environment">
          <span /> Neon PostgreSQL
        </span>
      </div>
    </>
  );
}

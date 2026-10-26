import { useTheme } from '../../contexts/ThemeContext';
export default function Brand() {
  const { design } = useTheme();
  return (
    <span className="brand">
      {design.logo ? (
        <img
          className="brand-logo"
          src={`data:${design.logo.mime_type};base64,${design.logo.data_base64}`}
          alt={design.logo.name}
        />
      ) : (
        <>
          <span className="brand-mark">f</span> FINDOS
        </>
      )}
      <span className="brand-light">PORTAL</span>
    </span>
  );
}

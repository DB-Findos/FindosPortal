import { useEffect, useRef, useState } from 'react';
import { ImagePlus, RotateCcw, Save, Trash2 } from 'lucide-react';
import PageHeading from '../components/common/PageHeading';
import { useTheme, defaultColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import type { Colors } from '../types/api';
import { useFormErrors } from '../hooks/useFormErrors';
import FieldError from '../components/common/FieldError';
const labels: Record<keyof Colors, string> = {
  primary: 'Primärfarbe',
  secondary: 'Sekundärfarbe',
  accent: 'Akzentfarbe',
  background: 'Hintergrund',
  surface: 'Oberflächen',
  text: 'Textfarbe',
};
type Upload = { name: string; mime_type: string; data_base64: string };
export default function DesignPage() {
  const { design, save } = useTheme();
  const { user } = useAuth();
  const {
    formRef,
    fieldErrors,
    setError,
    error,
    clearField,
    setFieldError,
    validate,
    handleError,
    inputProps,
    errorId,
  } = useFormErrors();
  const [colors, setColors] = useState<Colors>(design.colors),
    [logo, setLogo] = useState<Upload | null | undefined>(),
    [success, setSuccess] = useState(''),
    [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setColors(design.colors);
    setLogo(undefined);
  }, [design]);
  const currentLogo = logo === undefined ? design.logo : logo;
  const canSave = user?.permissions.design_settings?.[design.id ? 'can_update' : 'can_create'];
  const canUpload = user?.permissions.images?.[design.logo ? 'can_update' : 'can_create'];
  async function upload(selected?: File) {
    if (!selected) return;
    setError('');
    clearField('logo');
    setSuccess('');
    try {
      if (
        !['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) ||
        selected.size > 1048576
      )
        throw Error('Bitte PNG, JPEG oder WebP bis 1 MB auswählen.');
      const bitmap = await createImageBitmap(selected);
      if (bitmap.width > 8192 || bitmap.height > 8192) {
        bitmap.close();
        throw Error('Das Logo darf maximal 8192 × 8192 Pixel groß sein.');
      }
      bitmap.close();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(Error('Bild konnte nicht gelesen werden.'));
        reader.readAsDataURL(selected);
      });
      setLogo({ name: selected.name, mime_type: selected.type, data_base64: base64 });
    } catch (e) {
      setFieldError('logo', (e as Error).message);
    }
  }
  return (
    <>
      <PageHeading
        title="Design & Layout"
        description="Logo und die sechs zentralen Farben Ihrer Anwendung anpassen."
      />
      <form
        ref={formRef}
        noValidate
        className="design-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!validate(event.currentTarget)) return;
          setBusy(true);
          setError('');
          setSuccess('');
          try {
            await save(colors, logo);
            setSuccess('Design gespeichert. Die neue Version ist jetzt aktiv.');
          } catch (e) {
            handleError(e, (field) =>
              field === 'logo' || field.startsWith('logo.') ? 'logo' : field
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <section className="design-card">
          <div className="design-section-title">
            <div>
              <h2>Logo</h2>
              <p>Das Logo erscheint in der Topbar und auf der Loginseite.</p>
            </div>
            <span className="badge">Images</span>
          </div>
          <div className="logo-upload">
            <div className="logo-preview">
              {currentLogo ? (
                <img
                  src={`data:${currentLogo.mime_type};base64,${currentLogo.data_base64}`}
                  alt="Logo-Vorschau"
                />
              ) : (
                <ImagePlus size={34} />
              )}
            </div>
            <div>
              <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button
                {...inputProps('logo')}
                type="button"
                className="secondary"
                disabled={!canSave || !canUpload || busy}
                onClick={() => file.current?.click()}
              >
                <ImagePlus size={16} /> Logo auswählen
              </button>
              <p className="upload-hint">PNG, JPEG oder WebP · maximal 1 MB</p>
              <FieldError id={errorId('logo')} message={fieldErrors.logo} />
              {currentLogo && (
                <button
                  type="button"
                  className="text-button"
                  disabled={
                    !canSave || (!!design.logo && !user?.permissions.images?.can_delete) || busy
                  }
                  onClick={() => {
                    setLogo(null);
                    clearField('logo');
                  }}
                >
                  <Trash2 size={13} /> Logo entfernen
                </button>
              )}
            </div>
          </div>
        </section>
        <section className="design-card">
          <div className="design-section-title">
            <div>
              <h2>Farbschema</h2>
              <p>Sechs Farben für Navigation, Schaltflächen, Flächen und Texte.</p>
            </div>
            <button
              className="secondary"
              type="button"
              disabled={!canSave || busy}
              onClick={() => {
                setColors(defaultColors);
                for (const key of Object.keys(defaultColors)) clearField('colors.' + key);
              }}
            >
              <RotateCcw size={14} /> Standard
            </button>
          </div>
          <div className="color-grid">
            {(Object.keys(labels) as (keyof Colors)[]).map((key) => (
              <label key={key} className="color-field">
                <span>{labels[key]}</span>
                <div>
                  <input
                    aria-label={labels[key]}
                    type="color"
                    value={colors[key]}
                    disabled={!canSave || busy}
                    onChange={(e) => {
                      setColors({ ...colors, [key]: e.target.value });
                      clearField('colors.' + key);
                    }}
                  />
                  <input
                    {...inputProps('colors.' + key)}
                    aria-label={labels[key] + ' Hexwert'}
                    pattern="#[0-9a-fA-F]{6}"
                    required
                    value={colors[key]}
                    disabled={!canSave || busy}
                    onChange={(e) => {
                      setColors({ ...colors, [key]: e.target.value });
                      clearField('colors.' + key);
                    }}
                  />
                </div>
                <FieldError id={errorId('colors.' + key)} message={fieldErrors['colors.' + key]} />
              </label>
            ))}
          </div>
          <div
            className="theme-preview"
            style={{
              background: colors.background,
              color: colors.text,
              borderColor: colors.accent,
            }}
          >
            <div style={{ background: colors.surface }}>
              <strong>Vorschau</strong>
              <span style={{ color: colors.secondary }}>
                Ihre Anwendung mit dem neuen Farbschema
              </span>
              <span
                className="preview-button"
                style={{ background: colors.primary, color: colors.surface }}
              >
                Primärfarbe
              </span>
            </div>
          </div>
        </section>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {success && (
          <div className="success" role="status">
            {success}
          </div>
        )}
        {!canSave && <p>Keine Berechtigung zum Ändern des Designs.</p>}
        <div className="design-actions">
          <span>Änderungen werden mit Versionshistorie gespeichert.</span>
          <button className="primary" disabled={!canSave || busy}>
            <Save size={16} />
            {busy ? 'Speichern …' : 'Design speichern'}
          </button>
        </div>
      </form>
    </>
  );
}

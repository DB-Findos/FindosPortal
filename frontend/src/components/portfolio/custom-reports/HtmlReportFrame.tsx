import { useMemo } from 'react';
import { useTheme } from '../../../contexts/ThemeContext';

const stylesheet = `*{box-sizing:border-box}body{margin:0;padding:22px;background:var(--background);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1.55}h1{font-size:22px;margin:0 0 8px}h2{font-size:16px;margin:0 0 12px}h3{font-size:14px;margin:0 0 10px}p{margin:0 0 12px}header{margin-bottom:20px}.report-grid,.report-grid-3{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.report-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}.card{padding:18px;border:1px solid var(--border);border-radius:12px;background:var(--surface);min-width:0}.full-width{grid-column:1/-1}.metric-value,.metric{font-size:28px;font-weight:650;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.muted,small{color:var(--secondary)}.positive{color:var(--primary)}.negative{color:#b23b3b}svg{display:block;width:100%;height:auto;max-height:360px}svg text{fill:var(--secondary);font-size:10px}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:9px 10px;text-align:left;border-bottom:1px solid var(--border)}th{color:var(--secondary);font-weight:600}hr{border:0;border-top:1px solid var(--border);margin:20px 0}li{margin:4px 0}@media(max-width:650px){body{padding:14px}.report-grid,.report-grid-3{grid-template-columns:1fr}.card{padding:14px}.metric-value,.metric{font-size:23px}}`;

export default function HtmlReportFrame({
  html,
  title,
  preview = false,
}: {
  html: string;
  title: string;
  preview?: boolean;
}) {
  const { design } = useTheme();
  const document = useMemo(() => {
    const variables = Object.entries(design.colors)
      .filter(([, value]) => /^#[\da-fA-F]{6}$/.test(value))
      .map(([key, value]) => `--${key}:${value}`)
      .join(';');
    return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><style>:root{${variables};--border:color-mix(in srgb,var(--text) 14%,var(--surface))}${stylesheet}</style></head><body>${html}</body></html>`;
  }, [html, design.colors]);
  return (
    <iframe
      className={preview ? 'custom-html-frame is-preview' : 'custom-html-frame'}
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={document}
    />
  );
}

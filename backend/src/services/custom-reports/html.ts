import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { httpError } from '../../shared/errors.js';
import type { BindingResult } from './data.js';
import type { CustomReportInput } from './definition.js';

type Node = DefaultTreeAdapterMap['childNode'];
const allowed = new Set(
  'div section article header footer main aside p span h1 h2 h3 h4 h5 strong em b i small br hr ul ol li table thead tbody tfoot tr th td caption figure figcaption'.split(
    ' '
  )
);
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
const attribute = (node: DefaultTreeAdapterMap['element'], name: string) =>
  node.attrs.find((a) => a.name === name)?.value;
export function validateHtml(input: CustomReportInput) {
  const root = parseFragment(input.html);
  const keys = new Set(input.mapping.map((b) => b.key));
  const contexts = new Set(['company', 'date', 'currency', 'dimension']);
  const visit = (node: Node) => {
    if ('tagName' in node) {
      if (!allowed.has(node.tagName))
        throw httpError(
          400,
          `HTML-Tag ${node.tagName} ist nicht erlaubt. Verwende semantisches HTML mit Report-Klassen.`
        );
      for (const a of node.attrs) {
        if (
          ![
            'class',
            'title',
            'colspan',
            'rowspan',
            'scope',
            'data-value',
            'data-chart',
            'data-table',
            'data-kind',
          ].includes(a.name)
        )
          throw httpError(400, `HTML-Attribut ${a.name} ist nicht erlaubt.`);
        if (a.name === 'class' && !/^[a-zA-Z0-9_\s-]*$/.test(a.value))
          throw httpError(400, 'Ungültige Report-Klasse.');
        if (['data-value', 'data-chart', 'data-table'].includes(a.name) && !keys.has(a.value))
          throw httpError(400, `Mapping fehlt: ${a.value}`);
        if (
          ['data-value', 'data-chart'].includes(a.name) &&
          input.mapping.find((binding) => binding.key === a.value)?.kind !== 'value'
        )
          throw httpError(400, 'Einzelwerte und Charts benötigen ein value-Mapping.');
      }
    }
    if ('value' in node)
      for (const match of node.value.matchAll(/\{\{([^}]+)\}\}/g))
        if (!keys.has(match[1]) && !contexts.has(match[1]))
          throw httpError(400, `Unbekannter Platzhalter ${match[1]}.`);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return serialize(root);
}
function chart(binding: BindingResult, kind: string) {
  const points = binding.points || [];
  const values = points.map((p) => (p.value === null ? null : Number(p.value)));
  const available = values.filter((n): n is number => n !== null && Number.isFinite(n));
  if (!available.length) return '<p class="muted">Keine Werte verfügbar.</p>';
  const min = Math.min(0, ...available),
    max = Math.max(0, ...available),
    span = max - min || 1;
  const y = (n: number) => 28 + ((max - n) / span) * 170,
    step = 580 / Math.max(points.length, 1);
  let connected = false;
  const path = values
    .map((n, i) => {
      if (n === null) {
        connected = false;
        return '';
      }
      const command = connected ? 'L' : 'M';
      connected = true;
      return `${command}${50 + step * (i + 0.5)} ${y(n)}`;
    })
    .join(' ');
  const marks = points
    .map((p, i) => {
      const value = values[i];
      const x = 50 + step * (i + 0.5);
      return `${
        value === null
          ? ''
          : kind === 'line'
            ? `<circle cx="${x}" cy="${y(value)}" r="3" fill="var(--primary)"><title>${escape(p.month)}: ${escape(p.formatted)}</title></circle>`
            : `<rect x="${x - step * 0.32}" width="${step * 0.64}" y="${Math.min(y(0), y(value))}" height="${Math.max(1, Math.abs(y(value) - y(0)))}" fill="var(--primary)"><title>${escape(p.month)}: ${escape(p.formatted)}</title></rect>`
      }
     ${i % Math.max(1, Math.ceil(points.length / 8)) === 0 ? `<text x="${x}" y="222" text-anchor="middle">${escape(p.month.slice(2))}</text>` : ''}`;
    })
    .join('');
  return `<svg viewBox="0 0 650 240" role="img" aria-label="${escape(binding.label)}"><title>${escape(binding.label)}</title>
 <line x1="45" x2="635" y1="${y(0)}" y2="${y(0)}" stroke="var(--border)"/>
 <text x="40" y="32" text-anchor="end">${escape(new Intl.NumberFormat('de-DE', { notation: 'compact' }).format(max))}</text>
 <text x="40" y="198" text-anchor="end">${escape(new Intl.NumberFormat('de-DE', { notation: 'compact' }).format(min))}</text>
 ${kind === 'line' ? `<path d="${path}" fill="none" stroke="var(--primary)" stroke-width="3"/>` : ''}${marks}</svg>`;
}
function table(binding: BindingResult) {
  const rows =
    binding.rows || binding.points?.map((p) => ({ Monat: p.month, Wert: p.formatted })) || [];
  if (!rows.length) return '<p class="muted">Keine Daten vorhanden.</p>';
  const keys = Object.keys(rows[0]);
  return `<div class="table-scroll"><table><thead><tr>${keys.map((k) => `<th>${escape(k)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((k) => `<td>${escape((row as Record<string, unknown>)[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
export function renderHtml(
  input: CustomReportInput,
  results: BindingResult[],
  context: Record<string, string>
) {
  const root = parseFragment(validateHtml(input));
  const byKey = new Map(results.map((result) => [result.key, result]));
  const replace = (node: Node) => {
    if ('tagName' in node) {
      for (const kind of ['value', 'chart', 'table']) {
        const key = attribute(node, `data-${kind}`);
        if (!key) continue;
        const binding = byKey.get(key)!;
        const html =
          kind === 'chart'
            ? chart(binding, attribute(node, 'data-kind') || 'bar')
            : kind === 'table'
              ? table(binding)
              : escape(binding.formatted ?? '–');
        node.childNodes = parseFragment(html).childNodes;
        for (const child of node.childNodes) child.parentNode = node;
        return;
      }
    }
    if ('value' in node)
      node.value = node.value.replace(
        /\{\{([^}]+)\}\}/g,
        (_, key: string) => context[key] ?? byKey.get(key)?.formatted ?? '–'
      );
    if ('childNodes' in node) node.childNodes.forEach(replace);
  };
  root.childNodes.forEach(replace);
  return serialize(root);
}

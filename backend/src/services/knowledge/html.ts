import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
type Node = DefaultTreeAdapterMap['childNode'];
const tags = new Set(
  'p div span br strong b em i u s strike h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code table thead tbody tfoot tr td th caption hr a sup sub'.split(
    ' '
  )
);
const drop = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'meta',
  'link',
  'base',
  'img',
  'video',
  'audio',
]);
export function safeKnowledgeUrl(raw: string) {
  if (raw.startsWith('#') || /^\/knowledge(?:[/?#]|$)/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export function sanitizeKnowledgeHtml(html: string) {
  const root = parseFragment(html);
  const clean = (children: Node[]): Node[] =>
    children.flatMap((node) => {
      if (node.nodeName === '#comment') return [];
      if (!('tagName' in node)) return [node];
      if (drop.has(node.tagName)) return [];
      node.childNodes = clean(node.childNodes);
      if (!tags.has(node.tagName)) return node.childNodes;
      const attrs: typeof node.attrs = [];
      for (const a of node.attrs) {
        if (node.tagName === 'a' && a.name === 'href') {
          const url = safeKnowledgeUrl(a.value);
          if (url) attrs.push({ name: 'href', value: url });
        }
        if (a.name === 'title') attrs.push({ name: 'title', value: a.value.slice(0, 500) });
        if (
          ['td', 'th'].includes(node.tagName) &&
          ['colspan', 'rowspan'].includes(a.name) &&
          /^[1-9]\d?$/.test(a.value)
        )
          attrs.push(a);
        if (a.name === 'style') {
          // Preserve only semantic alignment used by the native editor; discard Word/OneNote styling.
          const alignment = a.value.match(
            /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i
          )?.[1];
          if (alignment)
            attrs.push({ name: 'class', value: `km-align-${alignment.toLowerCase()}` });
        }
        if (a.name === 'class' && /^km-align-(left|center|right|justify)$/.test(a.value))
          attrs.push(a);
      }
      if (node.tagName === 'a')
        attrs.push(
          { name: 'target', value: '_blank' },
          { name: 'rel', value: 'noopener noreferrer' }
        );
      node.attrs = attrs;
      return [node];
    });
  root.childNodes = clean(root.childNodes);
  const plain: string[] = [];
  const text = (node: Node) => {
    if ('value' in node) plain.push(node.value);
    if ('childNodes' in node) node.childNodes.forEach(text);
    if (
      'tagName' in node &&
      ['p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4'].includes(node.tagName)
    )
      plain.push('\n');
  };
  root.childNodes.forEach(text);
  return {
    html: serialize(root),
    text: plain
      .join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  };
}

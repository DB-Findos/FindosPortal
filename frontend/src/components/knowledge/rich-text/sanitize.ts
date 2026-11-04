const allowed = new Set(
  'p div span br strong b em i u s strike h1 h2 h3 h4 h5 h6 ul ol li blockquote pre code table thead tbody tfoot tr td th caption hr a sup sub'.split(
    ' '
  )
);
const blocked = new Set(
  'script style iframe object embed svg math form input button textarea select meta link base img video audio'.split(
    ' '
  )
);
export function safeEditorLink(value: string) {
  if (value.startsWith('#') || /^\/knowledge(?:[/?#]|$)/.test(value)) return value;
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export const escapeEditorText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
export function sanitizeEditorHtml(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const clean = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      const tag = child.tagName.toLowerCase();
      if (blocked.has(tag)) {
        child.remove();
        continue;
      }
      clean(child);
      if (!allowed.has(tag)) {
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      const href = tag === 'a' ? safeEditorLink(child.getAttribute('href') || '') : null;
      const align = child
        .getAttribute('style')
        ?.match(/text-align\s*:\s*(left|center|right|justify)/i)?.[1]
        ?.toLowerCase();
      const oldClass = child.getAttribute('class');
      const spans = ['colspan', 'rowspan'].map((name) => [name, child.getAttribute(name)]);
      for (const attribute of Array.from(child.attributes)) child.removeAttribute(attribute.name);
      if (href) {
        child.setAttribute('href', href);
        child.setAttribute('target', '_blank');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (align) child.className = `km-align-${align}`;
      else if (oldClass && /^km-align-(left|center|right|justify)$/.test(oldClass))
        child.className = oldClass;
      if (['td', 'th'].includes(tag))
        for (const [name, value] of spans)
          if (value && /^[1-9]\d?$/.test(value)) child.setAttribute(name!, value);
    }
  };
  clean(document.body);
  return document.body.innerHTML;
}

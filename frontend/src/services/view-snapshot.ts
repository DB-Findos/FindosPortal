import type { ViewSnapshot } from '../types/view-context';

function visible(element: Element) {
  const style = getComputedStyle(element);
  return (
    element.getClientRects().length > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    !element.closest('[aria-hidden="true"], .ai-chat')
  );
}

/** Render SVG charts as PNG, including computed theme styles. No external resources are loaded. */
async function chartImage(chart: SVGSVGElement): Promise<string | undefined> {
  const bounds = chart.getBoundingClientRect();
  const clone = chart.cloneNode(true) as SVGSVGElement;
  const originals = [chart, ...chart.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const properties = [
    'fill',
    'fill-opacity',
    'stroke',
    'stroke-width',
    'stroke-opacity',
    'stroke-dasharray',
    'opacity',
    'font-family',
    'font-size',
    'font-weight',
    'text-anchor',
    'dominant-baseline',
    'visibility',
    'display',
  ];
  originals.forEach((node, index) => {
    const style = getComputedStyle(node);
    properties.forEach((key) =>
      (copies[index] as SVGElement).style.setProperty(key, style.getPropertyValue(key))
    );
  });
  clone.querySelectorAll('image, foreignObject, script, style').forEach((node) => node.remove());
  clone.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes])
      if (
        /^on/i.test(attribute.name) ||
        /href/i.test(attribute.name) ||
        /url\(\s*['"]?https?:/i.test(attribute.value)
      )
        node.removeAttribute(attribute.name);
  });
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(bounds.width));
  clone.setAttribute('height', String(bounds.height));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' })
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(Error('Diagrammaufnahme abgelaufen')), 1500);
      image.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        clearTimeout(timeout);
        reject(Error('Diagrammaufnahme fehlgeschlagen'));
      };
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.min(1.5, 1400 / bounds.width, 1000 / bounds.height);
    canvas.width = Math.ceil(bounds.width * scale);
    canvas.height = Math.ceil(bounds.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function captureView(sources: ViewSnapshot['sources']): Promise<ViewSnapshot> {
  const capturedAt = new Date().toISOString();
  const candidates = [
    ...document.querySelectorAll('main, .topbar, .sidebar, .portfolio-sidebar, [role="dialog"]'),
  ];
  const roots = candidates.filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement &&
      !!visible(node) &&
      !candidates.some((parent) => parent !== node && parent.contains(node))
  );
  const limitations: string[] = [];
  const fullText = roots.map((root) => root.innerText).join('\n\n');
  if (fullText.length > 80000)
    limitations.push('Ansichtstext über 80.000 Zeichen; weitere Datensätze gezielt nachladen.');
  const controls = roots
    .flatMap((root) => [...root.querySelectorAll('input, select, textarea')])
    .filter(
      (node): node is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
        visible(node) && !['password', 'file', 'hidden'].includes((node as HTMLInputElement).type)
    )
    .map((node) => ({
      label: (
        node.getAttribute('aria-label') ||
        node.labels?.[0]?.innerText ||
        node.getAttribute('placeholder') ||
        node.name ||
        node.id ||
        'Eingabe'
      ).slice(0, 2000),
      value: (node instanceof HTMLSelectElement
        ? [...node.selectedOptions].map((option) => option.text).join(', ')
        : node instanceof HTMLInputElement && ['checkbox', 'radio'].includes(node.type)
          ? String(node.checked)
          : node.value
      ).slice(0, 20000),
    }))
    .slice(0, 500);
  // Include tables/charts that are inside a scrollable component, also below its current scroll position.
  const charts = roots
    .flatMap((root) => [...root.querySelectorAll<SVGSVGElement>('svg')])
    .filter(
      (node) =>
        visible(node) &&
        node.getBoundingClientRect().width > 150 &&
        node.getBoundingClientRect().height > 70
    );
  const chartCaptures = charts.slice(0, 30).map((chart, index) => {
    const title = (
      chart.getAttribute('aria-label') ||
      chart.querySelector('title')?.textContent ||
      'Diagramm'
    ).slice(0, 2000);
    const labels = [...chart.querySelectorAll('text, title, [aria-label]')]
      .map((node) => (node.getAttribute('aria-label') || node.textContent || '').slice(0, 4000))
      .filter(Boolean)
      .slice(0, 4000);
    return { title, labels, image: index < 6 ? chartImage(chart) : Promise.resolve(undefined) };
  });
  let sourceBytes = 0;
  const bounded = sources.map((source) => {
    const json =
      JSON.stringify(source.data, (key, value) =>
        /password|secret|token|base64/i.test(key) ? undefined : value
      ) || 'null';
    if (sourceBytes + json.length > 220000) {
      limitations.push(
        `Quelldaten „${source.name}“ überschreiten den Kontextumfang; gezielt über Datenbankwerkzeuge abfragen.`
      );
      return {
        name: source.name,
        data: { omitted: true, reason: 'context_size', characters: json.length },
      };
    }
    sourceBytes += json.length;
    return { name: source.name, data: JSON.parse(json) as unknown };
  });
  let imageBytes = 0;
  const rendered = await Promise.allSettled(chartCaptures.map((chart) => chart.image));
  const visuals = chartCaptures.map((chart, index) => {
    const result = rendered[index];
    const image =
      result.status === 'fulfilled' && result.value && imageBytes + result.value.length <= 2000000
        ? result.value
        : undefined;
    if (image) imageBytes += image.length;
    else
      limitations.push(
        `Diagramm „${chart.title}“ als Beschriftung und Quelldaten statt Bild verfügbar.`
      );
    return { title: chart.title, labels: chart.labels, ...(image ? { image } : {}) };
  });
  return {
    capturedAt,
    title: document.title.slice(0, 1000),
    text: fullText.slice(0, 80000),
    controls,
    visuals,
    sources: bounded,
    limitations,
  };
}

export function normalizeAnswerMarkdown(value: string) {
  let text = value.replace(/\r\n/g, '\n').trim();
  const fenced = text.match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  // Repair older answers that encoded a whole Markdown document as one literal line.
  if (!text.includes('\n') && /\\n(?:\\n|#{1,6}\s|\||[-*]\s|\d+\.\s)/.test(text))
    text = text.replace(/\\r\\n|\\n/g, '\n');
  return text;
}

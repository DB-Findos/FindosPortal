// Keep valid JSON and useful structure; never replace a large successful query by an error.
export function evidencePreview(value: unknown, maxCharacters = 45000): unknown {
  if ((JSON.stringify(value) || '').length <= maxCharacters) return value;
  const trim = (item: unknown, limit: number, depth = 0): unknown => {
    if (typeof item === 'string')
      return item.length > limit * 200 ? item.slice(0, limit * 200) + ' … [gekürzt]' : item;
    if (Array.isArray(item))
      return item.slice(0, limit).map((child) => trim(child, limit, depth + 1));
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .slice(0, 80)
          .map(([key, child]) => [
            key,
            depth > 8 ? '[über read_tool_result abrufen]' : trim(child, limit, depth + 1),
          ])
      );
    return item;
  };
  let preview: unknown;
  for (const limit of [30, 15, 5, 2, 1]) {
    preview = trim(value, limit);
    if ((JSON.stringify(preview) || '').length < maxCharacters) break;
  }
  if ((JSON.stringify(preview) || '').length > maxCharacters)
    preview = Array.isArray(value)
      ? { totalItems: value.length }
      : { availableKeys: Object.keys((value || {}) as object).slice(0, 60) };
  return {
    preview,
    truncated: true,
    hint: 'Vollständiges Ergebnis ist gespeichert. Mit read_tool_result(source_id,path,offset,limit) gezielt nachlesen. Eine gekürzte Vorschau ist kein Datenmangel.',
  };
}

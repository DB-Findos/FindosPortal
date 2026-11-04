import assert from 'node:assert/strict';
import path from 'node:path';
import JSZip from 'jszip';
import { SaxesParser } from 'saxes';

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}
export type ImportRow = Record<string, string | number | boolean | null> & { source_row: number };
const descendants = (node: XmlNode, name: string): XmlNode[] =>
  node.children.flatMap((child) => [
    ...(child.name === name ? [child] : []),
    ...descendants(child, name),
  ]);

// Read OOXML by namespace rather than prefix. Some valid exports use x:workbook,
// which ExcelJS cannot read. The source archive is never changed or rewritten.
export async function readImportWorkbook(bytes: Buffer): Promise<Record<string, ImportRow[]>> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  async function xml(filename: string): Promise<XmlNode> {
    const file = zip.file(filename);
    assert.ok(file, `Missing XLSX part: ${filename}`);
    const parser = new SaxesParser({ xmlns: true });
    const stack: XmlNode[] = [];
    let root: XmlNode | undefined;
    parser.on('opentag', (tag) => {
      const node: XmlNode = {
        name: tag.local,
        attributes: Object.fromEntries(
          Object.values(tag.attributes).map((a) => [a.local, a.value])
        ),
        children: [],
        text: '',
      };
      if (stack.length) stack.at(-1)!.children.push(node);
      else root = node;
      stack.push(node);
    });
    parser.on('text', (text) => {
      if (stack.length) stack.at(-1)!.text += text;
    });
    parser.on('closetag', () => {
      stack.pop();
    });
    parser.write(await file.async('string')).close();
    assert.ok(root, `Empty XML part: ${filename}`);
    return root;
  }
  const workbook = await xml('xl/workbook.xml');
  assert.ok(
    !descendants(workbook, 'workbookPr').some((n) => ['1', 'true'].includes(n.attributes.date1904)),
    '1904 date system is not supported by this importer.'
  );
  const strings = zip.file('xl/sharedStrings.xml')
    ? descendants(await xml('xl/sharedStrings.xml'), 'si').map((si) =>
        descendants(si, 't')
          .map((t) => t.text)
          .join('')
      )
    : [];
  const relationships = new Map(
    descendants(await xml('xl/_rels/workbook.xml.rels'), 'Relationship').map((r) => [
      r.attributes.Id,
      r.attributes.Target,
    ])
  );
  const result: Record<string, ImportRow[]> = {};
  for (const sheet of descendants(workbook, 'sheet')) {
    const target = relationships.get(sheet.attributes.id);
    assert.ok(target, `Missing worksheet relationship: ${sheet.attributes.name}`);
    const filename = target.startsWith('/')
      ? target.slice(1)
      : path.posix.normalize(`xl/${target}`);
    const rows = descendants(await xml(filename), 'row')
      .map((row) => {
        const values: (string | number | boolean | null)[] = [];
        for (const cell of row.children.filter((c) => c.name === 'c')) {
          const reference = cell.attributes.r;
          const letters = reference.match(/^[A-Z]+/)?.[0];
          assert.ok(letters, `Invalid cell address: ${reference}`);
          const column = [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
          const value = cell.children.find((c) => c.name === 'v')?.text ?? null;
          assert.notEqual(
            cell.attributes.t,
            'e',
            `Excel error at ${sheet.attributes.name}!${reference}: ${value}`
          );
          assert.ok(
            !cell.children.some((c) => c.name === 'f') || value !== null,
            `Uncalculated formula at ${reference}`
          );
          if (cell.attributes.t === 's') {
            assert.ok(
              value !== null && strings[Number(value)] !== undefined,
              `Invalid shared string at ${reference}`
            );
            values[column] = strings[Number(value)];
          } else if (cell.attributes.t === 'inlineStr')
            values[column] = descendants(cell, 't')
              .map((t) => t.text)
              .join('');
          else if (value === null) values[column] = null;
          else if (cell.attributes.t === 'b') values[column] = value === '1';
          else if (['str', 'd'].includes(cell.attributes.t)) values[column] = value;
          else {
            assert.ok(Number.isFinite(Number(value)), `Invalid number at ${reference}`);
            values[column] = Number(value);
          }
        }
        return { number: Number(row.attributes.r), values };
      })
      .filter((row) => row.values.some((v) => v !== null && v !== ''));
    assert.ok(rows.length, `Empty worksheet: ${sheet.attributes.name}`);
    const headers = rows[0].values.map(String);
    assert.equal(
      new Set(headers).size,
      headers.length,
      `Duplicate columns in ${sheet.attributes.name}`
    );
    result[sheet.attributes.name] = rows.slice(1).map((row) => ({
      ...Object.fromEntries(headers.map((header, index) => [header, row.values[index] ?? null])),
      source_row: row.number,
    }));
  }
  return result;
}

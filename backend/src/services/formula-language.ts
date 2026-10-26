import { Decimal } from 'decimal.js';

export const D = Decimal.clone({ precision: 40, maxE: 1000, minE: -1000 });
export type Expression =
  | { type: 'number'; value: string }
  | { type: 'variable'; name: string }
  | { type: 'unary'; op: string; value: Expression }
  | { type: 'binary'; op: string; left: Expression; right: Expression };
export class FormulaError extends Error {}
export function parseFormula(text: string) {
  if (!text.trim() || text.length > 4000)
    throw new FormulaError('Bitte eine Formel mit maximal 4.000 Zeichen erstellen.');
  const tokens: string[] = [];
  const scanner = /\s*([A-Z]+|(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/^()])/y;
  let position = 0;
  while (position < text.length) {
    if (!text.slice(position).trim()) break;
    scanner.lastIndex = position;
    const match = scanner.exec(text);
    if (!match)
      throw new FormulaError(
        'Ungültiges Zeichen in der Formel an Position ' + (position + 1) + '.'
      );
    tokens.push(match[1]);
    position = scanner.lastIndex;
  }
  if (tokens.length > 512)
    throw new FormulaError('Die Formel darf maximal 512 Bausteine enthalten.');
  let index = 0,
    depth = 0;
  const variables = new Set<string>();
  function atom(): Expression {
    if (++depth > 48) throw new FormulaError('Die Formel ist zu tief verschachtelt.');
    const token = tokens[index++];
    let node: Expression;
    if (token === '(') {
      node = sum();
      if (tokens[index++] !== ')') throw new FormulaError('Eine schließende Klammer fehlt.');
    } else if (token && /^[A-Z]+$/.test(token)) {
      variables.add(token);
      node = { type: 'variable', name: token };
    } else if (token && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) {
      if (token.length > 50) throw new FormulaError('Die Zahl ist zu lang.');
      node = { type: 'number', value: token };
    } else throw new FormulaError('Hier fehlt eine Zahl, Variable oder öffnende Klammer.');
    depth--;
    return node;
  }
  function power(): Expression {
    const left = atom();
    if (tokens[index] === '^') {
      index++;
      return { type: 'binary', op: '^', left, right: unary() };
    }
    return left;
  }
  let recursion = 0;
  function unary(): Expression {
    if (++recursion > 64) throw new FormulaError('Zu viele verschachtelte Operatoren.');
    let result: Expression;
    if (['+', '-'].includes(tokens[index])) {
      const op = tokens[index++];
      result = { type: 'unary', op, value: unary() };
    } else result = power();
    recursion--;
    return result;
  }
  function product(): Expression {
    let node = unary();
    while (['*', '/'].includes(tokens[index])) {
      const op = tokens[index++];
      node = { type: 'binary', op, left: node, right: unary() };
    }
    return node;
  }
  function sum(): Expression {
    let node = product();
    while (['+', '-'].includes(tokens[index])) {
      const op = tokens[index++];
      node = { type: 'binary', op, left: node, right: product() };
    }
    return node;
  }
  const ast = sum();
  if (index !== tokens.length)
    throw new FormulaError(
      'Zwischen den Bausteinen fehlt ein Operator oder eine Klammer ist überzählig.'
    );
  return { ast, tokens, identifiers: [...variables], TextEditor: tokens.join(' ') };
}
export function calculate(ast: Expression, variables: Record<string, string>): string {
  function visit(node: Expression): Decimal {
    if (node.type === 'number') return new D(node.value);
    if (node.type === 'variable') {
      if (variables[node.name] == null) throw new FormulaError('Variable ' + node.name + ' fehlt.');
      return new D(variables[node.name]);
    }
    if (node.type === 'unary') {
      const value = visit(node.value);
      return node.op === '-' ? value.negated() : value;
    }
    const a = visit(node.left),
      b = visit(node.right);
    let result: Decimal;
    switch (node.op) {
      case '+':
        result = a.plus(b);
        break;
      case '-':
        result = a.minus(b);
        break;
      case '*':
        result = a.times(b);
        break;
      case '/':
        if (b.isZero()) throw new FormulaError('Division durch null.');
        result = a.div(b);
        break;
      case '^':
        if (b.abs().gt(1000)) throw new FormulaError('Der Exponent darf maximal 1.000 betragen.');
        result = a.pow(b);
        break;
      default:
        throw new FormulaError('Unbekannter Operator.');
    }
    if (!result.isFinite() || result.isNaN())
      throw new FormulaError('Die Berechnung liefert kein endliches reelles Ergebnis.');
    return result;
  }
  const result = visit(ast);
  if (!result.isFinite() || result.isNaN())
    throw new FormulaError('Die Berechnung liefert kein endliches reelles Ergebnis.');
  return result.toString();
}
export function monthWindow(
  date: string,
  aggregation: 'MONTH' | 'LTM' | 'YTD',
  priorYear: boolean
) {
  const [year, month] = date.slice(0, 7).split('-').map(Number);
  const end = new Date(Date.UTC(year - (priorYear ? 1 : 0), month - 1, 1));
  const start = new Date(end);
  if (aggregation === 'LTM') start.setUTCMonth(start.getUTCMonth() - 11);
  if (aggregation === 'YTD') start.setUTCMonth(0);
  const months: string[] = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1))
    months.push(cursor.toISOString().slice(0, 10));
  const after = new Date(end);
  after.setUTCMonth(after.getUTCMonth() + 1);
  return { start: start.toISOString().slice(0, 10), end: after.toISOString().slice(0, 10), months };
}

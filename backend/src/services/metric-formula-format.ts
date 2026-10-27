import { Decimal } from 'decimal.js';

export const metricFormulaRules = {
  version: 1,
  reference:
    '|OPERATOR:Dynamo-Metric-UUID|; UUIDs refer to Metric.objectId, never a formula ID or version ID.',
  scope: 'References retain the selected company and dimension. No cross-company references.',
  monthly: {
    Data: 'Exact MetricData value for the requested month; missing values remain null.',
    Range:
      'Sum of immediate metrics in inclusive Range from/to; nested ranges and their details are counted once.',
    Formula: 'Evaluate Monthly formula (ID) recursively. Stored totals are not added again.',
  },
  operators: {
    VALUE: 'Monthly value at the last month of the selected period.',
    SUM: 'Sum monthly evaluated values over the selected period, inclusive.',
    AVG: 'Arithmetic mean of available monthly values over the selected period.',
    IVAP: 'Initial value of accumulation period: monthly value at the first month of the selected period.',
    PMV12: 'Monthly value at the selected month minus twelve months.',
    A12: 'Accumulation of the referenced metric for twelve months ending at the selected month.',
  },
  syntax:
    '+ - * / ^, parentheses, comparisons, IF(condition,then,else), AND(conditions). No JavaScript or SQL evaluation.',
  accumulation:
    'Evaluate Accumulation formula (ID), using monthly evaluation for self references (no self recursion).',
  currency:
    'Monetary inputs are converted at the report end month: source / EUR-source-index * EUR-target-index. Ratios and counts are unchanged.',
  missing:
    'No missing month is invented or forward-filled. Sparse SUM/AVG uses available values; arithmetic with a missing operand remains null. Division by zero is an error.',
  waterfall:
    'Follow the additive dependency path from Net Income to Revenue; other terms are signed movements and formula ancestors are subtotals. No costs are subtracted twice.',
} as const;

export type MetricExpression =
  | { type: 'number'; value: string }
  | { type: 'ref'; op: string; id: string }
  | { type: 'unary'; op: string; value: MetricExpression }
  | { type: 'binary'; op: string; left: MetricExpression; right: MetricExpression }
  | { type: 'call'; name: string; args: MetricExpression[] };

export function parseMetricExpression(text: string): MetricExpression {
  if (!text.trim() || text.length > 12000) throw new Error('Leere oder zu lange Metric-Formel.');
  const tokens: string[] = [];
  const scanner =
    /\s*(\|(?:SUM|VALUE|AVG|IVAP|PMV12|A12):[0-9a-f-]{36}\||\d+(?:\.\d*)?|\.\d+|IF|AND|<=|>=|<>|!=|[+\-*/^(),<>=])/giy;
  let offset = 0;
  while (text.slice(offset).trim()) {
    scanner.lastIndex = offset;
    const match = scanner.exec(text);
    if (!match) throw new Error(`Ungültige Metric-Formel an Position ${offset + 1}.`);
    tokens.push(match[1]);
    offset = scanner.lastIndex;
    if (tokens.length > 1024) throw new Error('Zu viele Formelbausteine.');
  }
  let index = 0,
    depth = 0;
  function atom(): MetricExpression {
    if (++depth > 64) throw new Error('Metric-Formel zu tief verschachtelt.');
    const token = tokens[index++];
    let result: MetricExpression;
    if (token === '(') {
      result = expression();
      if (tokens[index++] !== ')') throw new Error('Schließende Klammer fehlt.');
    } else if (token && /^\|/.test(token)) {
      const [op, id] = token.slice(1, -1).split(':');
      result = { type: 'ref', op: op.toUpperCase(), id: id.toLowerCase() };
    } else if (token && /^(IF|AND)$/i.test(token)) {
      if (tokens[index++] !== '(') throw new Error('Funktionsklammer fehlt.');
      const args = [expression()];
      while (tokens[index] === ',') {
        index++;
        args.push(expression());
      }
      if (tokens[index++] !== ')') throw new Error('Funktionsklammer fehlt.');
      const name = token.toUpperCase();
      if ((name === 'IF' && args.length !== 3) || (name === 'AND' && args.length < 2))
        throw new Error(`Ungültige Argumente für ${name}.`);
      result = { type: 'call', name, args };
    } else if (token && /^(?:\d|\.)/.test(token)) result = { type: 'number', value: token };
    else throw new Error('Ungültiger Formelbaustein.');
    depth--;
    return result;
  }
  function unary(): MetricExpression {
    if (++depth > 64) throw new Error('Metric-Formel zu tief verschachtelt.');
    let result: MetricExpression;
    if (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++];
      result = { type: 'unary', op, value: unary() };
    } else {
      result = atom();
      if (tokens[index] === '^') {
        index++;
        result = { type: 'binary', op: '^', left: result, right: unary() };
      }
    }
    depth--;
    return result;
  }
  function product(): MetricExpression {
    let result = unary();
    while (tokens[index] === '*' || tokens[index] === '/') {
      const op = tokens[index++];
      result = { type: 'binary', op, left: result, right: unary() };
    }
    return result;
  }
  function sum(): MetricExpression {
    let result = product();
    while (tokens[index] === '+' || tokens[index] === '-') {
      const op = tokens[index++];
      result = { type: 'binary', op, left: result, right: product() };
    }
    return result;
  }
  function expression(): MetricExpression {
    let result = sum();
    if (['<', '>', '<=', '>=', '=', '<>', '!='].includes(tokens[index])) {
      const op = tokens[index++];
      result = { type: 'binary', op, left: result, right: sum() };
    }
    return result;
  }
  const result = expression();
  if (index !== tokens.length) throw new Error('Unerwarteter Formelbaustein.');
  return result;
}

export function evaluateMetricExpression(
  node: MetricExpression,
  resolve: (op: string, id: string) => Decimal | null
): Decimal | null {
  const visit = (value: MetricExpression): Decimal | null =>
    evaluateMetricExpression(value, resolve);
  if (node.type === 'number') return new Decimal(node.value);
  if (node.type === 'ref') return resolve(node.op, node.id);
  if (node.type === 'unary') {
    const v = visit(node.value);
    return node.op === '-' ? (v?.negated() ?? null) : v;
  }
  if (node.type === 'call') {
    if (node.name === 'IF') {
      const condition = visit(node.args[0]);
      return condition === null ? null : visit(node.args[condition.isZero() ? 2 : 1]);
    }
    const values = node.args.map(visit);
    if (values.some((v) => v?.isZero())) return new Decimal(0);
    return values.some((v) => v === null) ? null : new Decimal(1);
  }
  const left = visit(node.left),
    right = visit(node.right);
  if (left === null || right === null) return null;
  let result: Decimal;
  switch (node.op) {
    case '+':
      result = left.plus(right);
      break;
    case '-':
      result = left.minus(right);
      break;
    case '*':
      result = left.mul(right);
      break;
    case '/':
      if (right.isZero()) throw new Error('Division durch null in Metric-Formel.');
      result = left.div(right);
      break;
    case '^':
      if (right.abs().gt(100)) throw new Error('Exponent zu groß.');
      result = left.pow(right);
      break;
    case '<':
      return new Decimal(left.lt(right) ? 1 : 0);
    case '>':
      return new Decimal(left.gt(right) ? 1 : 0);
    case '<=':
      return new Decimal(left.lte(right) ? 1 : 0);
    case '>=':
      return new Decimal(left.gte(right) ? 1 : 0);
    case '=':
      return new Decimal(left.eq(right) ? 1 : 0);
    default:
      return new Decimal(left.eq(right) ? 0 : 1);
  }
  if (!result.isFinite()) throw new Error('Ungültiges Ergebnis in Metric-Formel.');
  return result;
}

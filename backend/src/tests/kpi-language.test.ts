import test from 'node:test';
import assert from 'node:assert/strict';
import { calculate, monthWindow, parseFormula } from '../services/formula-language.js';
const evalFormula = (text: string, values: Record<string, string> = {}) =>
  calculate(parseFormula(text).ast, values);
test('operator precedence, nested brackets, unary and right-associative power', () => {
  assert.equal(evalFormula('2 + 3 * 4'), '14');
  assert.equal(evalFormula('(2+3)*(4-1)'), '15');
  assert.equal(evalFormula('2 ^ 3 ^ 2'), '512');
  assert.equal(evalFormula('-2^2'), '-4');
  assert.equal(evalFormula('2^-2'), '0.25');
  assert.equal(evalFormula('0.1 + 0.2'), '0.3');
  assert.equal(evalFormula('( A / B - 1 ) * 100', { A: '120', B: '100' }), '20');
  assert.equal(evalFormula('AA + B', { AA: '9007199254740993', B: '1' }), '9007199254740994');
});
test('malformed, injected, non-real and unbounded formulas rejected', () => {
  for (const expression of [
    'A; SELECT 1',
    'process.exit()',
    'Math.sqrt(2)',
    'A B',
    '( A + B',
    'A +',
    '2**3',
    'A)',
  ])
    assert.throws(() => parseFormula(expression));
  for (const expression of ['1/0', '(-1)^0.5', '2^1001', '999^999'])
    assert.throws(() => evalFormula(expression));
  assert.throws(() => parseFormula('('.repeat(80) + '1' + ')'.repeat(80)));
  assert.throws(() => parseFormula('1+'.repeat(300) + '1'));
});
test('MONTH, LTM, YTD and V12P use inclusive calendar months', () => {
  assert.deepEqual(monthWindow('2024-02-29', 'MONTH', true), {
    start: '2023-02-01',
    end: '2023-03-01',
    months: ['2023-02-01'],
  });
  assert.equal(monthWindow('2025-03-31', 'LTM', false).start, '2024-04-01');
  assert.equal(monthWindow('2025-03-31', 'LTM', false).months.length, 12);
  assert.deepEqual(monthWindow('2025-03-31', 'YTD', true).months, [
    '2024-01-01',
    '2024-02-01',
    '2024-03-01',
  ]);
  assert.equal(monthWindow('2025-01-01', 'YTD', false).months.length, 1);
  assert.equal(monthWindow('2025-03-01', 'LTM', true).start, '2023-04-01');
});

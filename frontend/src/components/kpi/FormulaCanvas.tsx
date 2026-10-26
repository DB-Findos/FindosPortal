import type { ReactNode } from 'react';
import type { KpiVariable } from '../../types/kpi';
interface Props {
  tokens: string[];
  variables: KpiVariable[];
  cursor: number;
  onCursor: (index: number) => void;
}
export default function FormulaCanvas({ tokens, variables, cursor, onCursor }: Props) {
  const matches = new Map<number, number>(),
    stack: number[] = [];
  tokens.forEach((token, index) => {
    if (token === '(') stack.push(index);
    if (token === ')' && stack.length) {
      const open = stack.pop()!;
      matches.set(open, index);
      matches.set(index, open);
    }
  });
  const names = Object.fromEntries(
    variables.map((v) => [v.identifier, v.name || `${v.entity}:${v.field}`])
  );
  function token(index: number) {
    const value = tokens[index];
    return (
      <button
        key={'t' + index}
        type="button"
        className={
          'formula-token ' +
          (names[value] ? 'variable-token ' : '') +
          ('()'.includes(value) && !matches.has(index) ? 'unmatched' : '')
        }
        aria-label={`${value}${names[value] ? ' ' + names[value] : ''}, Cursor dahinter`}
        onClick={() => onCursor(index + 1)}
      >
        {names[value] ? (
          <>
            <b>{value}</b>
            <span>{names[value]}</span>
          </>
        ) : (
          value
        )}
      </button>
    );
  }
  function render(start: number, end: number, depth: number): ReactNode[] {
    const result: ReactNode[] = [];
    for (let i = start; i < end; i++) {
      if (cursor === i)
        result.push(<span key={'c' + i} className="formula-caret" aria-label="Einfügeposition" />);
      const close = matches.get(i);
      if (tokens[i] === '(' && close !== undefined && close < end) {
        result.push(
          <span
            key={i}
            className={`formula-group depth-${depth % 4}`}
            title={`Klammerbereich ${depth + 1}`}
          >
            {token(i)}
            {render(i + 1, close, depth + 1)}
            {cursor === close && <span className="formula-caret" />}
            {token(close)}
          </span>
        );
        i = close;
      } else result.push(token(i));
    }
    return result;
  }
  return (
    <div className="formula-canvas" role="group" aria-label="Formelbausteine">
      <button
        type="button"
        className="cursor-start"
        aria-label="Cursor an den Anfang"
        onClick={() => onCursor(0)}
      >
        ↦
      </button>
      {render(0, tokens.length, 0)}
      {cursor === tokens.length && <span className="formula-caret" aria-label="Einfügeposition" />}
      {!tokens.length && <span className="muted">Variable, Zahl oder Operator anklicken</span>}
    </div>
  );
}

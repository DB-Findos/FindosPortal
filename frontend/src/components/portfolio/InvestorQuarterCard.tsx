import { Fragment } from 'react';

export type InvestorQuarter = {
  period: string;
  quarter: number;
  year: number;
  columns: string[];
  rows: {
    key: string;
    label: string;
    metricNumbers: number[];
    values: (number | null)[];
    margins: (number | null)[] | null;
    changePriorYear: number | null;
    changeCase: number | null;
  }[];
  comments: { objectId: string; comment_text: string; period: string }[];
};
const format = (value: number | null, percent = false) =>
  value === null
    ? '–'
    : new Intl.NumberFormat(
        'de-DE',
        percent
          ? { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }
          : { maximumFractionDigits: 0 }
      ).format(value);

export default function InvestorQuarterCard({
  quarter,
  currency,
}: {
  quarter: InvestorQuarter;
  currency: string;
}) {
  return (
    <article className="investor-quarter">
      <header>
        <h3>
          Q{quarter.quarter} {quarter.year}
        </h3>
        <span>in Tausend {currency}</span>
      </header>
      <div className="investor-quarter-content">
        <div className="investor-table-scroll">
          <table className="investor-metrics">
            <thead>
              <tr>
                <th scope="col">Kennzahl</th>
                {quarter.columns.map((column) => (
                  <th scope="col" key={column}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quarter.rows.map((row) => (
                <Fragment key={row.key}>
                  <tr className="investor-metric-main">
                    <th scope="row">{row.label}</th>
                    {row.values.map((value, index) => (
                      <td key={index} title={`Metric Number ${row.metricNumbers[index]}`}>
                        {format(value)}
                      </td>
                    ))}
                  </tr>
                  {row.margins && (
                    <tr className="investor-metric-detail">
                      <th scope="row">in % vom Umsatz</th>
                      {row.margins.map((value, index) => (
                        <td key={index}>{format(value, true)}</td>
                      ))}
                    </tr>
                  )}
                  <tr className="investor-metric-detail">
                    <th scope="row">Veränderung ggü. Vorjahr</th>
                    <td />
                    <td>{format(row.changePriorYear, true)}</td>
                    <td />
                  </tr>
                  <tr className="investor-metric-detail">
                    <th scope="row">Veränderung ggü. Findos Case</th>
                    <td />
                    <td>{format(row.changeCase, true)}</td>
                    <td />
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <section
          className="investor-comments"
          aria-label={`Kommentare Q${quarter.quarter} ${quarter.year}`}
        >
          <h4>Kommentar</h4>
          {quarter.comments.length ? (
            quarter.comments.map((comment) => (
              <div key={comment.objectId} className="investor-comment-text">
                {comment.comment_text}
              </div>
            ))
          ) : (
            <p className="investor-no-comments">
              Für dieses Quartal ist kein Kommentar hinterlegt.
            </p>
          )}
        </section>
      </div>
    </article>
  );
}

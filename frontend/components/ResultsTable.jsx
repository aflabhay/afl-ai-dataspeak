/**
 * frontend/components/ResultsTable.jsx
 */
export default function ResultsTable({ results, rowCount, truncated }) {
  if (!results || results.length === 0) return null;
  const columns = Object.keys(results[0]);

  return (
    <div className="message-row assistant" style={{ marginTop: -8 }}>
      <div style={{ width: 34, flexShrink: 0 }} />
      <div className="message-body" style={{ maxWidth: '90%', width: '100%' }}>
        <div className="results-wrapper">
          <div className="results-header">
            <div className="results-header-left">
              <span className="results-count">{rowCount.toLocaleString()} row{rowCount !== 1 ? 's' : ''}</span>
              {truncated && <span className="results-truncated">⚠ Capped at 100 rows</span>}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-light)' }}>{columns.length} columns</span>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>{columns.map(col => <th key={col}>{col}</th>)}</tr>
              </thead>
              <tbody>
                {results.map((row, i) => (
                  <tr key={i}>
                    {columns.map(col => (
                      <td key={col} title={String(row[col] ?? '')}>
                        {String(row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * frontend/components/ResultsTable.jsx
 * Renders query results as a scrollable HTML table.
 */
export default function ResultsTable({ results, rowCount }) {
  if (!results || results.length === 0) return null;
  const columns = Object.keys(results[0]);

  return (
    <div className="results-container">
      <p className="results-meta">{rowCount} row{rowCount !== 1 ? 's' : ''} returned</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{columns.map(col => <th key={col}>{col}</th>)}</tr>
          </thead>
          <tbody>
            {results.map((row, i) => (
              <tr key={i}>
                {columns.map(col => <td key={col}>{String(row[col] ?? '')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

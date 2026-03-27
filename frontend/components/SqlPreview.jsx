/**
 * frontend/components/SqlPreview.jsx
 * Shows the generated SQL + cost info in a collapsible block.
 */
import { useState } from 'react';

export default function SqlPreview({ sql, costInfo, executionMs }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="sql-preview">
      <button className="sql-toggle" onClick={() => setOpen(!open)}>
        {open ? '▼' : '▶'} View generated SQL
        {costInfo && <span className="cost-badge">
          {costInfo.estimatedGB.toFixed(3)} GB · {costInfo.estimatedCost} · {executionMs}ms
        </span>}
      </button>
      {open && <pre className="sql-code">{sql}</pre>}
    </div>
  );
}

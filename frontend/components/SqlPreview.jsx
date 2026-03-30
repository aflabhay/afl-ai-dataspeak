/**
 * frontend/components/SqlPreview.jsx
 */
import { useState } from 'react';

export default function SqlPreview({ sql, costInfo, aiCost, executionMs, fromSemanticCache, fromResultCache, cacheScore, confidenceScore, confidenceReason }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="message-row assistant" style={{ marginTop: -8 }}>
      <div style={{ width: 34, flexShrink: 0 }} />
      <div className="message-body" style={{ maxWidth: '72%' }}>
        <div className="sql-preview">
          <button className="sql-toggle" onClick={() => setOpen(!open)}>
            <span className="sql-toggle-icon">{open ? '▼' : '▶'}</span>
            <span className="sql-toggle-label">View generated SQL</span>
            <div className="cost-badges">
              {fromSemanticCache && <span className="badge vector-cache">⚡ Vector cache{cacheScore ? ` · ${cacheScore}` : ''}</span>}
              {!fromSemanticCache && fromResultCache && <span className="badge result-cache">◎ Result cache</span>}
              {!fromSemanticCache && !fromResultCache && <span className="badge fresh-query">↯ Fresh query</span>}
              {costInfo && <>
                <span className="badge scan">{costInfo.estimatedGB.toFixed(3)} GB</span>
                <span className="badge cost">BQ {costInfo.estimatedCost}</span>
              </>}
              {aiCost && <span className="badge ai-cost">AI {aiCost.estimatedCost}</span>}
              {confidenceScore != null && (
                <span
                  className={`badge confidence ${confidenceScore >= 80 ? 'high' : confidenceScore >= 60 ? 'mid' : 'low'}`}
                  title={confidenceReason || undefined}
                >
                  ◈ {confidenceScore}% confidence{confidenceReason ? ` — ${confidenceReason}` : ''}
                </span>
              )}
              {executionMs && <span className="badge time">{executionMs}ms</span>}
            </div>
          </button>
          {open && <pre className="sql-code-block">{sql}</pre>}
        </div>
      </div>
    </div>
  );
}

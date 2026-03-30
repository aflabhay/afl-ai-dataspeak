/**
 * frontend/components/SourceSelector.jsx
 * Sidebar panel for data source, dataset, and table configuration.
 * Includes a "View Columns" button that shows column metadata in a modal.
 */
import { useState, useEffect, useRef } from 'react';
import { useUser } from '../lib/UserContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export default function SourceSelector({
  source, dataset, table,
  onSourceChange, onDatasetChange, onTableChange,
}) {
  const { getAuthHeaders } = useUser();
  const [metaOpen,    setMetaOpen]    = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaData,    setMetaData]    = useState(null);
  const [metaError,   setMetaError]   = useState(null);
  const warmDebounce = useRef(null);

  // ── Silently warm metadata whenever table + dataset are both set ────────────
  // Calls /api/schema/metadata in the background (no loading state shown).
  // This triggers a one-time source table scan that populates
  // t_aida_table_column_metadata so it's ready before the user asks anything.
  useEffect(() => {
    if (!table || !dataset) return;
    clearTimeout(warmDebounce.current);
    warmDebounce.current = setTimeout(async () => {
      try {
        const authHeaders = await getAuthHeaders();
        await fetch(
          `${API_URL}/api/schema/metadata?dataset=${encodeURIComponent(dataset)}&table=${encodeURIComponent(table)}&source=${encodeURIComponent(source)}`,
          { headers: { 'Content-Type': 'application/json', ...authHeaders } }
        );
        // Fire-and-forget — result is not needed here; metadata is now cached in BQ
      } catch { /* non-critical */ }
    }, 800);
    return () => clearTimeout(warmDebounce.current);
  }, [table, dataset, source]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openMetadata() {
    if (!dataset || !table) return;
    setMetaOpen(true);
    setMetaLoading(true);
    setMetaError(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `${API_URL}/api/schema/metadata?dataset=${encodeURIComponent(dataset)}&table=${encodeURIComponent(table)}&source=${encodeURIComponent(source)}`,
        { headers: { 'Content-Type': 'application/json', ...authHeaders } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMetaData(data);
    } catch (err) {
      setMetaError(err.message);
    } finally {
      setMetaLoading(false);
    }
  }

  return (
    <>
      <div className="sidebar-section source-selector-compact">
        {/* Source toggle */}
        <div className="sidebar-section-title">Data Source</div>
        <div className="source-tabs">
          <button
            className={`source-tab ${source === 'bigquery' ? 'active' : ''}`}
            onClick={() => onSourceChange('bigquery')}
          >
            BigQuery
          </button>
          <button
            className={`source-tab ${source === 'fabric' ? 'active' : ''}`}
            onClick={() => onSourceChange('fabric')}
          >
            Fabric
          </button>
        </div>

        {/* Dataset + Table inline */}
        <div className="source-fields-row">
          <div className="source-field-item">
            <label className="sidebar-label-sm">{source === 'bigquery' ? 'Dataset' : 'Schema'}</label>
            <input
              className={`sidebar-input-sm ${dataset ? 'has-value' : ''}`}
              type="text"
              value={dataset}
              onChange={e => onDatasetChange(e.target.value)}
              placeholder={source === 'bigquery' ? 'DCOE_Production' : 'dcoe_gcp_prd'}
            />
          </div>
          <div className="source-field-item">
            <label className="sidebar-label-sm">Table</label>
            <input
              className={`sidebar-input-sm ${table ? 'has-value' : ''}`}
              type="text"
              value={table}
              onChange={e => onTableChange(e.target.value)}
              placeholder="auto-detect"
            />
          </div>
        </div>

        {/* View Columns button — only shown when table is set */}
        {table && dataset && (
          <button className="meta-view-btn" onClick={openMetadata} title="View column metadata for this table">
            ◈ View Columns &amp; Metadata
          </button>
        )}
      </div>

      {/* ── Metadata Modal ───────────────────────────────────────────────── */}
      {metaOpen && (
        <div className="meta-modal-overlay" onClick={() => setMetaOpen(false)}>
          <div className="meta-modal" onClick={e => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <div className="meta-modal-title">◈ {table}</div>
                <div className="meta-modal-sub">{dataset} · {source}</div>
              </div>
              <button className="meta-modal-close" onClick={() => setMetaOpen(false)}>✕</button>
            </div>

            {metaLoading && (
              <div className="meta-modal-loading">
                <span className="dot" /><span className="dot" /><span className="dot" />
                <span style={{ marginLeft: 8 }}>Loading column metadata…</span>
              </div>
            )}

            {metaError && (
              <div className="meta-modal-error">Failed to load metadata: {metaError}</div>
            )}

            {metaData && !metaLoading && (
              <>
                <div className="meta-modal-info">
                  {metaData.columns.length} columns
                  {metaData.fromMetadata
                    ? ' · enriched with sample values'
                    : ' · schema only (no samples yet — send a query to populate)'}
                </div>
                <div className="meta-table-scroll">
                  <table className="meta-table">
                    <thead>
                      <tr>
                        <th>Column</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Sample Values</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metaData.columns.map(col => (
                        <tr key={col.name}>
                          <td className="meta-col-name">{col.name}</td>
                          <td className="meta-col-type">{col.type}</td>
                          <td className="meta-col-desc">{col.description || <span style={{ color: '#94A3B8' }}>—</span>}</td>
                          <td className="meta-col-samples">
                            {col.samples && col.samples.length > 0
                              ? col.samples.map((s, i) => (
                                  <span key={i} className="meta-sample-chip">{String(s)}</span>
                                ))
                              : <span style={{ color: '#94A3B8' }}>—</span>
                            }
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

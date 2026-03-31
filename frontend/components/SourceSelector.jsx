/**
 * frontend/components/SourceSelector.jsx
 * Sidebar panel for data source, dataset, and table configuration.
 * Supports comma-separated table names.
 */
import { useState, useEffect, useRef } from 'react';
import { useUser } from '../lib/UserContext';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Parse a comma-separated table string into a clean array
function parseTables(raw) {
  return (raw || '').split(',').map(t => t.trim()).filter(Boolean);
}

export default function SourceSelector({
  source, dataset, table,
  onSourceChange, onDatasetChange, onTableChange,
}) {
  const { getAuthHeaders } = useUser();
  const [metaOpen,    setMetaOpen]    = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaData,    setMetaData]    = useState(null);  // array of { tableName, columns, fromMetadata }
  const [metaError,   setMetaError]   = useState(null);
  const [expanded,    setExpanded]    = useState({});    // { tableName: bool } for accordion
  const warmDebounce = useRef(null);

  const tables = parseTables(table);

  // ── Silently warm metadata for all tables whenever table + dataset change ────
  useEffect(() => {
    if (!table || !dataset) return;
    clearTimeout(warmDebounce.current);
    warmDebounce.current = setTimeout(async () => {
      try {
        const authHeaders = await getAuthHeaders();
        const tList = parseTables(table);
        if (tList.length === 0) return;
        await fetch(
          `${API_URL}/api/schema/metadata?dataset=${encodeURIComponent(dataset)}&tables=${encodeURIComponent(tList.join(','))}&source=${encodeURIComponent(source)}`,
          { headers: { 'Content-Type': 'application/json', ...authHeaders } }
        );
      } catch { /* non-critical */ }
    }, 800);
    return () => clearTimeout(warmDebounce.current);
  }, [table, dataset, source]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openMetadata() {
    if (!dataset || tables.length === 0) return;
    setMetaOpen(true);
    setMetaLoading(true);
    setMetaError(null);
    setMetaData(null);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(
        `${API_URL}/api/schema/metadata?dataset=${encodeURIComponent(dataset)}&tables=${encodeURIComponent(tables.join(','))}&source=${encodeURIComponent(source)}`,
        { headers: { 'Content-Type': 'application/json', ...authHeaders } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // Normalise: single table returns flat shape, multiple returns { tables: [...] }
      const tableResults = data.tables
        ? data.tables
        : [{ tableName: data.tableName, columns: data.columns, fromMetadata: data.fromMetadata }];

      setMetaData(tableResults);
      // Auto-expand all tables
      const exp = {};
      tableResults.forEach(t => { exp[t.tableName] = true; });
      setExpanded(exp);
    } catch (err) {
      setMetaError(err.message);
    } finally {
      setMetaLoading(false);
    }
  }

  function toggleTable(tableName) {
    setExpanded(prev => ({ ...prev, [tableName]: !prev[tableName] }));
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

        {/* Dataset + Tables inline */}
        <div className="source-fields-row">
          <div className="source-field-item">
            <label className="sidebar-label-sm">{source === 'bigquery' ? 'Dataset' : 'Schema'}</label>
            <input
              className={`sidebar-input-sm ${dataset ? 'has-value' : ''}`}
              type="text"
              value={dataset}
              onChange={e => onDatasetChange(e.target.value)}
              placeholder={source === 'bigquery' ? 'DCOE_Production' : 'dbo'}
            />
          </div>
          <div className="source-field-item">
            <label className="sidebar-label-sm">
              Tables
              <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 4, fontSize: 10 }}>(comma-separated)</span>
            </label>
            <input
              className={`sidebar-input-sm ${table ? 'has-value' : ''}`}
              type="text"
              value={table}
              onChange={e => onTableChange(e.target.value)}
              placeholder="table1, table2"
              title="Enter one or more table names separated by commas"
            />
          </div>
        </div>

        {/* Table chips — show parsed tables as tags */}
        {tables.length > 1 && (
          <div className="table-chips">
            {tables.map(t => (
              <span key={t} className="table-chip">◈ {t}</span>
            ))}
          </div>
        )}

        {/* View Columns button */}
        {tables.length > 0 && dataset && (
          <button className="meta-view-btn" onClick={openMetadata} title="View column metadata for selected tables">
            ◈ View Columns &amp; Metadata
            {tables.length > 1 && <span style={{ marginLeft: 4, opacity: 0.7 }}>({tables.length} tables)</span>}
          </button>
        )}
      </div>

      {/* ── Metadata Modal ────────────────────────────────────────────────── */}
      {metaOpen && (
        <div className="meta-modal-overlay" onClick={() => setMetaOpen(false)}>
          <div className="meta-modal" onClick={e => e.stopPropagation()}>
            <div className="meta-modal-header">
              <div>
                <div className="meta-modal-title">◈ Column Metadata</div>
                <div className="meta-modal-sub">{dataset} · {source} · {tables.length} table{tables.length > 1 ? 's' : ''}</div>
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
              <div className="meta-table-scroll">
                {metaData.map(tbl => (
                  <div key={tbl.tableName} className="meta-table-section">
                    {/* Table accordion header */}
                    <button
                      className="meta-table-header"
                      onClick={() => toggleTable(tbl.tableName)}
                    >
                      <span className="meta-table-name">◈ {tbl.tableName}</span>
                      <span className="meta-table-meta">
                        {tbl.columns.length} cols
                        {tbl.fromMetadata ? ' · enriched' : ' · schema only'}
                      </span>
                      <span className="meta-table-chevron">{expanded[tbl.tableName] ? '▲' : '▼'}</span>
                    </button>

                    {expanded[tbl.tableName] && (
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
                          {tbl.columns.map(col => (
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
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

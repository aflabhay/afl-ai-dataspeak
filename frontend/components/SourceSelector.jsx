/**
 * frontend/components/SourceSelector.jsx
 * Toggle between BigQuery and Fabric + dataset input.
 */
export default function SourceSelector({ source, dataset, onSourceChange, onDatasetChange }) {
  return (
    <div className="source-selector">
      <label>
        <input
          type="radio" value="bigquery"
          checked={source === 'bigquery'}
          onChange={() => onSourceChange('bigquery')}
        />
        {' '}Google BigQuery
      </label>
      <label>
        <input
          type="radio" value="fabric"
          checked={source === 'fabric'}
          onChange={() => onSourceChange('fabric')}
        />
        {' '}Microsoft Fabric
      </label>
      <input
        type="text"
        value={dataset}
        onChange={e => onDatasetChange(e.target.value)}
        placeholder={source === 'bigquery' ? 'Dataset (e.g. DCOE_Production)' : 'Schema (e.g. dcoe_gcp_prd)'}
      />
    </div>
  );
}

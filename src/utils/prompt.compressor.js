/**
 * src/utils/prompt.compressor.js
 * ────────────────────────────────
 * Strips audit/internal columns from schema before sending to the AI.
 *
 * Why: Every column sent costs tokens. Audit timestamps, row IDs, and
 * pipeline metadata are never useful for business SQL — removing them
 * shrinks the prompt 20-40% and reduces hallucinated column names.
 *
 * Usage:
 *   const { compressSchema } = require('./prompt.compressor');
 *   const lean = compressSchema(schema);
 */

const logger = require('./logger');

// ── Column name patterns to strip ────────────────────────────────────────────
// Matched against lowercased column name. Add more as you discover them.
const AUDIT_PATTERNS = [
  // Pipeline / ingestion metadata
  /^ingestion_/,
  /^_ingestion/,
  /^_loaded_at$/,
  /^_sdc_/,          // Stitch/Singer audit columns
  /^_fivetran_/,     // Fivetran audit columns
  /^_dbt_/,          // dbt internal columns

  // Generic audit timestamps — be specific so we don't strip business dates
  /^created_at$/,
  /^updated_at$/,
  /^modified_at$/,
  /^deleted_at$/,
  /^last_modified$/,
  /^last_updated$/,
  /^inserted_at$/,

  // Internal row identifiers (not business IDs)
  /^__row_id$/,
  /^_row_number$/,
  /^row_hash$/,
  /^record_hash$/,
  /^surrogate_key$/,
];

// ── Column types that are always safe to strip ────────────────────────────────
// These carry no semantic value for SQL generation.
const STRIP_TYPES = new Set(['BYTES', 'JSON']);

// ── Description max length ────────────────────────────────────────────────────
// Truncate long descriptions — they bloat the prompt with minimal benefit.
const MAX_DESC_LENGTH = 100;

/**
 * Remove audit/internal columns from each table's column list.
 * Truncate long descriptions. Drop BYTES/JSON typed columns.
 *
 * @param {Array<{ tableName: string, columns: Array }>} schema
 * @returns {Array<{ tableName: string, columns: Array }>}
 */
function compressSchema(schema) {
  if (!schema || schema.length === 0) return schema;

  let totalBefore = 0;
  let totalAfter  = 0;

  const compressed = schema.map(table => {
    const before = table.columns.length;
    totalBefore += before;

    const columns = table.columns
      .filter(col => {
        const name = col.name.toLowerCase();

        // Strip by type
        if (STRIP_TYPES.has(col.type)) return false;

        // Strip by name pattern
        if (AUDIT_PATTERNS.some(rx => rx.test(name))) return false;

        return true;
      })
      .map(col => ({
        ...col,
        // Truncate long descriptions
        description: col.description && col.description.length > MAX_DESC_LENGTH
          ? col.description.slice(0, MAX_DESC_LENGTH) + '…'
          : col.description,
      }));

    totalAfter += columns.length;
    return { ...table, columns };
  });

  const saved = totalBefore - totalAfter;
  if (saved > 0) {
    logger.info(`Prompt compressor: removed ${saved}/${totalBefore} columns (${Math.round(saved / totalBefore * 100)}% reduction)`);
  }

  return compressed;
}

module.exports = { compressSchema };

/**
 * src/bigquery/questions.store.js
 * ────────────────────────────────
 * Manages the `suggested_questions` BigQuery table.
 *
 * Schema:
 *   id           STRING  REQUIRED  — UUID
 *   category     STRING  REQUIRED  — display group name
 *   question     STRING  REQUIRED  — the question text
 *   input_tables STRING  NULLABLE  — JSON array of table names this applies to
 *                                    null / "[]" = applies to any table
 *   order_index  INTEGER NULLABLE  — sort order within category
 *   is_active    BOOLEAN REQUIRED  — soft-delete flag
 *   created_at   TIMESTAMP REQUIRED
 *
 * Auto-seeds 10 business analysis categories (+ general questions) on first run.
 */

const { randomUUID }  = require('crypto');
const { getClient }   = require('./bigquery.client');
const logger          = require('../utils/logger');

const DATASET = process.env.GCP_FEEDBACK_DATASET || 'AFL_AI';
const TABLE   = 't_aida_suggested_questions';

const TABLE_SCHEMA = {
  fields: [
    { name: 'id',           type: 'STRING',    mode: 'REQUIRED' },
    { name: 'category',     type: 'STRING',    mode: 'REQUIRED' },
    { name: 'question',     type: 'STRING',    mode: 'REQUIRED' },
    { name: 'input_tables', type: 'STRING',    mode: 'NULLABLE' },
    { name: 'order_index',  type: 'INTEGER',   mode: 'NULLABLE' },
    { name: 'is_active',    type: 'BOOLEAN',   mode: 'REQUIRED' },
    { name: 'created_at',   type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
};

// ── Default seed questions ────────────────────────────────────────────────────
// input_tables: [] or null  → shows for any table selection
// input_tables: ["tableName"] → shows only when that table is active
const SEED_QUESTIONS = [
  // ── General (shows for any table) ──────────────────────────────────────────
  { category: 'Getting Started',               order: 0, tables: [],                                     question: 'Show top 10 customers by revenue' },
  { category: 'Getting Started',               order: 1, tables: [],                                     question: 'What are the RFM cohort distributions?' },
  { category: 'Getting Started',               order: 2, tables: [],                                     question: 'Compare brand performance this month' },
  { category: 'Getting Started',               order: 3, tables: [],                                     question: 'Which cohort has the highest retention?' },

  // ── 1. Customer Behavior Analysis ──────────────────────────────────────────
  { category: 'Customer Behavior Analysis',    order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'How does purchase frequency distribute across customer segments?' },
  { category: 'Customer Behavior Analysis',    order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What percentage of customers are one-time vs repeat buyers?' },
  { category: 'Customer Behavior Analysis',    order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What is the average order value by RFM cohort segment?' },

  // ── 2. Acquisition Insights ────────────────────────────────────────────────
  { category: 'Acquisition Insights',          order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'How many new customers were acquired last month?' },
  { category: 'Acquisition Insights',          order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show new customer acquisition trend over the last 6 months' },
  { category: 'Acquisition Insights',          order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Compare new vs returning customer revenue this quarter' },

  // ── 3. Category Performance ────────────────────────────────────────────────
  { category: 'Category Performance',          order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Which product categories drive the most revenue?' },
  { category: 'Category Performance',          order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show top 5 performing categories by order count' },
  { category: 'Category Performance',          order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Which categories have the highest average discount rate?' },

  // ── 4. Sales Trends ────────────────────────────────────────────────────────
  { category: 'Sales Trends',                  order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show monthly sales trend for the past 12 months' },
  { category: 'Sales Trends',                  order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What is the week-over-week sales growth?' },
  { category: 'Sales Trends',                  order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Compare sales this month vs same month last year' },

  // ── 5. Discount Effectiveness ──────────────────────────────────────────────
  { category: 'Discount Effectiveness',        order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What is the average discount given across all orders?' },
  { category: 'Discount Effectiveness',        order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Do higher discounts correlate with larger basket sizes?' },
  { category: 'Discount Effectiveness',        order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Which customer segments receive the most discounts?' },

  // ── 6. Geographic Insights ────────────────────────────────────────────────
  { category: 'Geographic Insights',           order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Which cities generate the most revenue?' },
  { category: 'Geographic Insights',           order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show top 10 states by customer count' },
  { category: 'Geographic Insights',           order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Compare average order value across regions' },

  // ── 7. Customer Loyalty and Retention ────────────────────────────────────
  { category: 'Customer Loyalty & Retention',  order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What is the customer retention rate month over month?' },
  { category: 'Customer Loyalty & Retention',  order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show churn rate by RFM cohort segment' },
  { category: 'Customer Loyalty & Retention',  order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Which cohort has the best 90-day retention rate?' },

  // ── 8. Score and Performance Metrics ─────────────────────────────────────
  { category: 'Score & Performance Metrics',   order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show distribution of RFM scores across all customers' },
  { category: 'Score & Performance Metrics',   order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What is the average recency, frequency and monetary score?' },
  { category: 'Score & Performance Metrics',   order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Which segment has the highest customer lifetime value?' },

  // ── 9. Cross-Selling and Upselling ───────────────────────────────────────
  { category: 'Cross-Sell & Upsell Opportunities', order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Which segments have low frequency but high monetary value?' },
  { category: 'Cross-Sell & Upsell Opportunities', order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Identify high-value customers who have not purchased recently' },
  { category: 'Cross-Sell & Upsell Opportunities', order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show customers with single-category purchases eligible for cross-sell' },

  // ── 10. Overall Business Health ───────────────────────────────────────────
  { category: 'Overall Business Health',       order: 0, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What is the total GMV for the current month?' },
  { category: 'Overall Business Health',       order: 1, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'Show overall active customer count vs last month' },
  { category: 'Overall Business Health',       order: 2, tables: ['t_capillary_rfm_cohort_gold_layer'], question: 'What is the average order value and orders per customer this quarter?' },
];

let _tableEnsured = false;

async function ensureTable() {
  if (_tableEnsured) return;
  const bq = getClient();
  const dataset = bq.dataset(DATASET);
  const [dsExists] = await dataset.exists();
  if (!dsExists) {
    await dataset.create({ location: process.env.GCP_LOCATION || 'US' });
    logger.info(`Created BigQuery dataset: ${DATASET}`);
  }
  const table = dataset.table(TABLE);
  const [tblExists] = await table.exists();
  if (!tblExists) {
    await table.create({ schema: TABLE_SCHEMA });
    logger.info(`Created BigQuery table: ${DATASET}.${TABLE}`);
  }
  _tableEnsured = true;
}

/**
 * Seed default questions if the table is empty.
 * Safe to call on every server start — skips if rows already exist.
 */
async function seedDefaults() {
  try {
    await ensureTable();
    const bq = getClient();

    // Check if already seeded
    const [rows] = await bq.query({
      query: `SELECT COUNT(*) AS cnt FROM \`${DATASET}.${TABLE}\` WHERE is_active = TRUE LIMIT 1`,
    });
    if (rows[0].cnt > 0) {
      logger.info(`Suggested questions already seeded (${rows[0].cnt} rows) — skipping`);
      return;
    }

    const now  = new Date().toISOString();
    const batch = SEED_QUESTIONS.map(q => ({
      id:           randomUUID(),
      category:     q.category,
      question:     q.question,
      input_tables: q.tables.length > 0 ? JSON.stringify(q.tables) : null,
      order_index:  q.order,
      is_active:    true,
      created_at:   now,
    }));

    await bq.dataset(DATASET).table(TABLE).insert(batch);
    logger.info(`Seeded ${batch.length} suggested questions into ${DATASET}.${TABLE}`);
  } catch (err) {
    logger.warn(`Question seed failed (non-fatal): ${err.message}`);
  }
}

/**
 * Fetch active questions for the given table, grouped by category.
 * Returns questions that match the table name OR apply to all tables (null / empty input_tables).
 *
 * @param {string} tableName  — current focus table (may be empty string)
 * @returns {Promise<Array<{category: string, order: number, questions: Array}>>}
 */
async function fetchQuestions(tableName) {
  await ensureTable();
  const bq = getClient();

  // Build filter: match exact table name OR generic (null/empty)
  const tableFilter = tableName
    ? `AND (input_tables IS NULL OR input_tables = '[]' OR REGEXP_CONTAINS(input_tables, @tablePattern))`
    : `AND (input_tables IS NULL OR input_tables = '[]')`;

  const tablePattern = tableName ? `"${tableName.replace(/"/g, '')}"` : '';

  const query = `
    SELECT id, category, question, input_tables, order_index
    FROM \`${DATASET}.${TABLE}\`
    WHERE is_active = TRUE
    ${tableFilter}
    ORDER BY order_index ASC, category ASC
  `;

  const params = tableName ? { tablePattern } : {};
  const [rows]  = await bq.query({ query, params });

  // Group by category
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.category)) map.set(row.category, []);
    map.get(row.category).push({ id: row.id, question: row.question });
  }

  // Preserve natural category order from seed (order_index on first question per category)
  const CATEGORY_ORDER = [
    'Getting Started',
    'Customer Behavior Analysis',
    'Acquisition Insights',
    'Category Performance',
    'Sales Trends',
    'Discount Effectiveness',
    'Geographic Insights',
    'Customer Loyalty & Retention',
    'Score & Performance Metrics',
    'Cross-Sell & Upsell Opportunities',
    'Overall Business Health',
  ];

  return [...map.entries()]
    .sort(([a], [b]) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([category, questions]) => ({ category, questions }));
}

// ── Dynamic questions persistence ────────────────────────────────────────────
// Stores AI-generated questions per table+dataset+source so they survive restarts.
// Regenerated when older than DYNAMIC_QUESTIONS_TTL_DAYS days.

const DYNAMIC_TABLE = 't_aida_dynamic_questions';

const DYNAMIC_SCHEMA = {
  fields: [
    { name: 'id',            type: 'STRING',    mode: 'REQUIRED' },
    { name: 'table_name',    type: 'STRING',    mode: 'REQUIRED' },
    { name: 'dataset_name',  type: 'STRING',    mode: 'REQUIRED' },
    { name: 'source',        type: 'STRING',    mode: 'REQUIRED' },
    { name: 'category',      type: 'STRING',    mode: 'REQUIRED' },
    { name: 'questions_json',type: 'STRING',    mode: 'REQUIRED' }, // JSON array of strings
    { name: 'generated_at',  type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
};

let _dynamicTableEnsured = false;

async function ensureDynamicTable() {
  if (_dynamicTableEnsured) return;
  const bq = getClient();
  const ds = bq.dataset(DATASET);
  const [dsExists] = await ds.exists();
  if (!dsExists) await ds.create({ location: process.env.GCP_LOCATION || 'US' });
  const tbl = ds.table(DYNAMIC_TABLE);
  const [tblExists] = await tbl.exists();
  if (!tblExists) {
    await tbl.create({ schema: DYNAMIC_SCHEMA });
    logger.info(`Created BigQuery table: ${DATASET}.${DYNAMIC_TABLE}`);
  }
  _dynamicTableEnsured = true;
}

/**
 * Fetch previously generated questions for a table from BigQuery.
 * Returns null if no stored questions or they are older than TTL.
 *
 * @param {string} tableName
 * @param {string} dataset
 * @param {string} source
 * @returns {Promise<Array<{category: string, questions: string[]}>|null>}
 */
async function fetchGeneratedQuestions(tableName, dataset, source) {
  try {
    await ensureDynamicTable();
    const bq = getClient();

    const [rows] = await bq.query({
      query: `
        SELECT category, questions_json
        FROM \`${DATASET}.${DYNAMIC_TABLE}\`
        WHERE table_name   = @tableName
          AND dataset_name = @dataset
          AND source       = @source
        ORDER BY category ASC
      `,
      params: { tableName, dataset, source },
    });

    if (!rows || rows.length === 0) return null;

    // Reconstruct categories array — stored forever, no TTL
    return rows.map(row => ({
      category:  row.category,
      questions: JSON.parse(row.questions_json),
    }));
  } catch (err) {
    logger.warn(`fetchGeneratedQuestions failed for ${tableName}: ${err.message}`);
    return null;
  }
}

/**
 * Persist AI-generated questions for a table to BigQuery.
 * Deletes existing rows for the table first (full replacement).
 *
 * @param {string} tableName
 * @param {string} dataset
 * @param {string} source
 * @param {Array<{category: string, questions: string[]}>} categories
 */
async function saveGeneratedQuestions(tableName, dataset, source, categories) {
  if (!categories || categories.length === 0) return;
  try {
    await ensureDynamicTable();
    const bq  = getClient();
    const now = new Date().toISOString();

    // Delete existing rows for this table
    await bq.query({
      query: `
        DELETE FROM \`${DATASET}.${DYNAMIC_TABLE}\`
        WHERE table_name = @tableName AND dataset_name = @dataset AND source = @source
      `,
      params: { tableName, dataset, source },
    });

    // Insert new rows via DML
    for (const cat of categories) {
      await bq.query({
        query: `
          INSERT INTO \`${DATASET}.${DYNAMIC_TABLE}\`
            (id, table_name, dataset_name, source, category, questions_json, generated_at)
          VALUES
            (@id, @tableName, @dataset, @source, @category, @questionsJson, TIMESTAMP(@now))
        `,
        params: {
          id:            randomUUID(),
          tableName,
          dataset,
          source,
          category:      cat.category,
          questionsJson: JSON.stringify(cat.questions),
          now,
        },
      });
    }

    logger.info(`Saved ${categories.length} question categories for ${dataset}.${tableName} to BigQuery`);
  } catch (err) {
    logger.warn(`saveGeneratedQuestions failed for ${tableName}: ${err.message}`);
  }
}

module.exports = { seedDefaults, fetchQuestions, fetchGeneratedQuestions, saveGeneratedQuestions };

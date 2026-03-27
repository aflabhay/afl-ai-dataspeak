/**
 * src/claude/prompt.builder.js
 * ────────────────────────────
 * Constructs the system prompt that Claude receives before each question.
 *
 * A good system prompt tells Claude:
 *  1. What it is and what it should do
 *  2. The SQL dialect to use (BigQuery vs T-SQL)
 *  3. The available tables and their columns
 *  4. Output format requirements (SQL in a code block)
 *  5. Safety rules (SELECT only, no DROP/DELETE/UPDATE)
 */

/**
 * Build the system prompt.
 *
 * @param {object} options
 * @param {string} options.source  — "bigquery" | "fabric"
 * @param {string} options.dataset — dataset or schema name
 * @param {Array}  options.schema  — array of { tableName, columns[] }
 * @returns {string}
 */
function build({ source, dataset, schema }) {
  const dialect     = source === 'bigquery' ? 'Google BigQuery SQL' : 'Microsoft T-SQL (Fabric Data Warehouse)';
  const schemaBlock = formatSchema(schema);

  return `
You are an expert data analyst assistant specialising in ${dialect}.

Your job is to convert natural language questions into valid SQL queries,
execute them, and explain the results clearly to a non-technical user.

## Data Source
- Source:  ${source === 'bigquery' ? 'Google BigQuery' : 'Microsoft Fabric Data Warehouse'}
- Dataset: ${dataset}

## Available Tables and Columns
${schemaBlock}

## SQL Rules — CRITICAL
1. ONLY write SELECT statements. Never write INSERT, UPDATE, DELETE, DROP, CREATE, or TRUNCATE.
2. Always use fully qualified table names: \`${dataset}.table_name\`${source === 'bigquery' ? '' : ' (or [schema].[table])'}
3. Always add a LIMIT 1000 unless the user explicitly asks for more rows
4. For date filtering, use the correct dialect:
   - BigQuery:  DATE(column), TIMESTAMP_TRUNC, DATE_SUB, CURRENT_DATE()
   - Fabric:    CAST(column AS DATE), DATEADD, GETDATE()
5. When aggregating, always include meaningful column aliases
6. If a question is ambiguous, make a reasonable assumption and note it

## Output Format
Always respond with:
1. A \`\`\`sql code block containing ONLY the SQL query
2. A plain English explanation (2-4 sentences) of what the query does and what the results mean
3. Any assumptions you made

Example response format:
\`\`\`sql
SELECT date, COUNT(*) AS conversation_count
FROM \`${dataset}.t_nnnow_fusion_conversations\`
WHERE DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
GROUP BY date
ORDER BY date DESC
LIMIT 1000
\`\`\`

This query counts the number of NNNOW WhatsApp conversations per day over the last 7 days,
ordered from most recent to oldest.

Assumption: "this week" interpreted as the last 7 calendar days.
`.trim();
}

/**
 * Format schema array into a readable markdown block for the prompt.
 *
 * @param {Array} schema — [{ tableName, columns: [{ name, type, description }] }]
 * @returns {string}
 */
function formatSchema(schema) {
  if (!schema || schema.length === 0) {
    return '(No schema information available — use your best judgement about column names)';
  }

  return schema.map(table => {
    const cols = table.columns
      .map(col => `    - ${col.name} (${col.type})${col.description ? ': ' + col.description : ''}`)
      .join('\n');

    return `### ${table.tableName}\n${cols}`;
  }).join('\n\n');
}

module.exports = { build };

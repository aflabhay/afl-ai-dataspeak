/**
 * src/utils/column.enricher.js
 * ─────────────────────────────
 * Uses AI to auto-generate business descriptions for table columns
 * in the context of Arvind Fashions Limited (AFL).
 *
 * Called once per table after the first source sample is taken.
 * Runs in the background — does not block query responses.
 * Never overwrites descriptions that were manually set in BigQuery.
 */

const logger = require('./logger');

const AFL_BUSINESS_CONTEXT = `
Arvind Fashions Limited (AFL) is one of India's largest fashion retail conglomerates.

Brands owned/licensed by AFL:
- Arrow (formal menswear)
- US Polo Assn / USPA (casual/sportswear)
- Flying Machine (denim/youth)
- Club A / Excalibur (value menswear)
- Stride (footwear)
- Tommy Hilfiger — TH (licensed premium)
- Calvin Klein — CK (licensed premium)

Sales channels:
- D2C websites: uspaassn.com, nnnow.com (multi-brand), megamart.com (value)
- Offline: 1000+ exclusive brand outlets (EBOs) and multi-brand outlets (MBOs) across India
- B2B: wholesale to trade partners
- Modern Trade / Large Format: SJITs (Shop-in-Shop in large format), MPs (multi-purpose stores)
- B2B2C marketplaces: Flipkart, Amazon, Myntra, Ajio, CocoBlu, Zepto, Swiggy (quick commerce)

Key business metrics:
- GMV / Revenue: typically in INR
- RFM: Recency (days since last purchase), Frequency (number of purchases), Monetary (total spend)
- Cohort: customer segment based on loyalty/purchase behaviour
- AOV: Average Order Value
- LTV: Lifetime Value of a customer
- Returns/Cancellations tracked as negative fulfilment
`.trim();

/**
 * Ask the AI to infer a business description for each column in the table,
 * using AFL's business context.
 *
 * @param {string}   tableName
 * @param {object[]} columns    — [{ name, type, samples: string[] }]
 * @returns {Promise<Record<string, string>>}  { columnName: 'description' }
 */
async function enrichColumns(tableName, columns) {
  if (!columns || columns.length === 0) return {};

  const colLines = columns.map(col => {
    const sv = col.samples?.length > 0
      ? `  sample values: ${col.samples.map(s => `"${s}"`).join(', ')}`
      : '';
    return `- ${col.name} (${col.type})${sv ? '\n' + sv : ''}`;
  }).join('\n');

  const userMessage = `
You are a senior data analyst at Arvind Fashions Limited (AFL).

Business context:
${AFL_BUSINESS_CONTEXT}

Table: ${tableName}

Write a concise business description (max 12 words) for each column below.
Explain what the column means in AFL's retail/fashion operations — not just the data type.
If a column name is ambiguous, use the sample values to infer its meaning.

Columns:
${colLines}

Return ONLY a valid JSON object: { "column_name": "business description", ... }
No markdown, no explanation — just the raw JSON.
`.trim();

  try {
    const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
    let rawText;

    if (provider === 'openai') {
      const OpenAI = require('openai');
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const res = await client.chat.completions.create({
        model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages:    [{ role: 'user', content: userMessage }],
        temperature: 0.1,
        max_tokens:  1500,
      });
      rawText = res.choices[0].message.content;
    } else {
      const claude  = require('../claude/claude.client');
      const { text } = await claude.ask('', [{ role: 'user', content: userMessage }]);
      rawText = text;
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in AI response');
    const descriptions = JSON.parse(jsonMatch[0]);
    logger.info(`Column enrichment done for ${tableName}: ${Object.keys(descriptions).length} descriptions generated`);
    return descriptions;
  } catch (err) {
    logger.warn(`Column enrichment failed for ${tableName}: ${err.message}`);
    return {};
  }
}

module.exports = { enrichColumns };

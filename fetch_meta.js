// Fetches daily Meta Ads spend by country straight from the Marketing API, replacing the
// Power My Analytics-fed "Dati Meta" sheet (which often refreshed hours late, and is half-empty
// for minutes while PMA rewrites it).
// Run: META_ACCESS_TOKEN=... node fetch_meta.js <out_json>
const fs = require('fs');

const [, , outPath] = process.argv;
const TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT = 'act_184244048859015';
// Meta retires API versions about two years after release; bump this when calls fail with error #2635.
const API_VERSION = 'v26.0';
const START_DATE = '2026-01-01';

const TODAY_ROME = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function getPage(params) {
  const url = `https://graph.facebook.com/${API_VERSION}/${AD_ACCOUNT}/insights?` + new URLSearchParams(params);
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await resp.json();
    if (resp.ok) return body;
    const retryable = resp.status >= 500 || resp.status === 429;
    if (!retryable || attempt >= 3) throw new Error(`Meta API ${resp.status}: ${JSON.stringify(body.error || body)}`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}

async function main() {
  if (!TOKEN) throw new Error('META_ACCESS_TOKEN is not set');
  const params = {
    level: 'account',
    fields: 'spend',
    breakdowns: 'country',
    time_increment: '1',
    time_range: JSON.stringify({ since: START_DATE, until: TODAY_ROME }),
    limit: '500',
  };
  // Row: [date (YYYY-MM-DD), country code ('unknown' when Meta can't attribute it), spend]
  const rows = [];
  for (;;) {
    const page = await getPage(params);
    for (const r of page.data) rows.push([r.date_start, r.country, Number(r.spend)]);
    const after = page.paging && page.paging.cursors && page.paging.cursors.after;
    if (!page.paging || !page.paging.next || !after) break;
    params.after = after;
  }
  if (rows.length === 0) throw new Error('Meta API returned no rows');
  fs.writeFileSync(outPath, JSON.stringify(rows));
  const dates = rows.map((r) => r[0]).sort();
  console.log('meta rows:', rows.length, 'date range:', dates[0], '->', dates[dates.length - 1]);
}

main().catch((e) => {
  // Don't fail the build: aggregate.js falls back to the last deployed Meta figures and the
  // dashboard shows a red "source not updated" banner instead of silently going stale.
  console.error('Meta API fetch failed:', e.message);
  fs.writeFileSync(outPath, JSON.stringify({ error: e.message }));
});

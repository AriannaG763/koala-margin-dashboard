// Aggregates the 3 Google Sheet CSV exports plus the Meta Ads API JSON (from fetch_meta.js) into
// the compact JSON array the dashboard template needs: one row per (date, countryBucket) from
// 2026-01-01 onward with Revenue, Budget Meta, Budget Google and Margine di contribuzione.
// Countries are grouped into IT, DE_AT, ES, FR, OTHER.
// Run: node aggregate.js <sales_csv> <meta_json> <affiliate_csv> <google_ads_csv> <out_dir> [previous_dashboard_html]
const fs = require('fs');

const [, , salesCsvPath, metaJsonPath, affiliateCsvPath, googleAdsCsvPath, outDir, previousHtmlPath] = process.argv;

const START_DATE = '2026-01-01';

// Exclude today (Europe/Rome calendar date): today's sales are still coming in when the
// dashboard refreshes, so the last complete day shown is always yesterday.
const TODAY_ROME = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const YESTERDAY_ROME = addDays(TODAY_ROME, -1);

function parseCsv(text) {
  // Full-text CSV parser (handles quoted fields with embedded commas AND embedded newlines).
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cur); cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      rows.push(row); row = [];
    } else {
      cur += c;
    }
  }
  if (cur !== '' || row.length > 0) { row.push(cur); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function parseNumEu(s) {
  if (!s) return 0;
  s = String(s).trim().replace(/€/g, '').replace(/ /g, '').replace(/ /g, '');
  if (s === '') return 0;
  s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function parseNumUs(s) {
  if (!s) return 0;
  s = String(s).trim().replace(/€/g, '').replace(/\$/g, '').replace(/,/g, '').replace(/ /g, '').replace(/ /g, '');
  if (s === '') return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function isoFromMDY(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
  if (!m) return null;
  return m[3] + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
}

function isoFromDMY(s) {
  s = String(s).trim();
  // "Influencer Affiliate" has a mixed date column: older rows are "DD/MM/YYYY" text,
  // but the most recent rows (as new orders come in) are already "YYYY-MM-DD" -
  // handle both, or recent days silently lose all their affiliate cost.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
}

function countryBucket(code) {
  if (code === 'IT') return 'IT';
  if (code === 'DE' || code === 'AT') return 'DE_AT';
  if (code === 'ES') return 'ES';
  if (code === 'FR') return 'FR';
  return 'OTHER';
}

function keyOf(date, code) { return date + '|' + countryBucket(code); }

// ---------- Sales sheet: "Shopify_Daily_Sales_By_Country" ----------
// Columns used (0-indexed): P=15 Revenue, Q=16 Gross Profit, N=13 Shipping Cost,
// T=19 Packaging Cost, U=20 Increased Commission Fee (x1.1).
const salesAgg = new Map();
let salesLast = '';
{
  const rows = parseCsv(fs.readFileSync(salesCsvPath, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = r[0];
    if (!date || date < START_DATE || date >= TODAY_ROME) continue;
    if (date > salesLast) salesLast = date;
    const code = r[2] || 'ND';
    const k = keyOf(date, code);
    let e = salesAgg.get(k);
    if (!e) { e = { revenue: 0, grossProfit: 0, shipping: 0, packaging: 0, commissionRaw: 0 }; salesAgg.set(k, e); }
    e.revenue += parseNumEu(r[15]);
    e.grossProfit += parseNumEu(r[16]);
    e.shipping += parseNumEu(r[13]);
    e.packaging += parseNumEu(r[19]);
    e.commissionRaw += parseNumEu(r[20]);
  }
}

// ---------- Meta Ads: Marketing API JSON from fetch_meta.js ----------
// Rows: [date (YYYY-MM-DD), country code ('unknown' when Meta can't attribute it), spend],
// or {error} when the API call failed - then reuse the Meta figures of the last deployed dashboard.
const metaAgg = new Map();
let metaLast = '';
let metaError = null;
{
  const meta = JSON.parse(fs.readFileSync(metaJsonPath, 'utf8'));
  if (Array.isArray(meta)) {
    for (const [iso, country, spend] of meta) {
      if (iso < START_DATE || iso >= TODAY_ROME) continue;
      const k = keyOf(iso, country !== 'unknown' ? country : 'ND');
      metaAgg.set(k, (metaAgg.get(k) || 0) + spend);
    }
    // Fetched live, so it's complete through yesterday even if yesterday had no spend at all.
    metaLast = YESTERDAY_ROME;
  } else {
    metaError = meta.error;
    const prevHtml = previousHtmlPath && fs.existsSync(previousHtmlPath) ? fs.readFileSync(previousHtmlPath, 'utf8') : '';
    const m = /var daily = (\[\[.*?\]\]);/s.exec(prevHtml);
    if (!m) throw new Error(`Meta API failed (${metaError}) and there is no previous dashboard data to fall back on`);
    for (const [date, bucket, , budgetMeta] of JSON.parse(m[1])) {
      metaAgg.set(date + '|' + bucket, budgetMeta);
      if (date > metaLast) metaLast = date;
    }
  }
}

// ---------- Affiliate sheet: "Influencer Affiliate" ----------
// Columns used: A=0 Order Date (D/M/YYYY), D=3 Shipping Country Code, G=6 Affiliate fee.
const affiliateAgg = new Map();
let affiliateLast = '';
{
  const rows = parseCsv(fs.readFileSync(affiliateCsvPath, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const iso = isoFromDMY(r[0]);
    if (!iso || iso < START_DATE || iso >= TODAY_ROME) continue;
    if (iso > affiliateLast) affiliateLast = iso;
    const code = r[3] || 'ND';
    const k = keyOf(iso, code);
    affiliateAgg.set(k, (affiliateAgg.get(k) || 0) + parseNumEu(r[6]));
  }
}

// ---------- Google Ads sheet ----------
// Columns used: A=0 Date (M/D/YYYY), B=1 Country Code, C=2 Cost (US-style decimal).
const googleAdsAgg = new Map();
let googleAdsLast = '';
{
  const rows = parseCsv(fs.readFileSync(googleAdsCsvPath, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const iso = isoFromMDY(r[0]);
    if (!iso || iso < START_DATE || iso >= TODAY_ROME) continue;
    if (iso > googleAdsLast) googleAdsLast = iso;
    const code = r[1] || 'ND';
    const k = keyOf(iso, code);
    googleAdsAgg.set(k, (googleAdsAgg.get(k) || 0) + parseNumUs(r[2]));
  }
}

// ---------- Merge (union of every (date,bucket) key seen in any source) ----------
// Country bucket: IT, DE_AT (Germany + Austria merged), ES, FR kept separate; everything else -> OTHER.
const allKeys = new Set([...salesAgg.keys(), ...metaAgg.keys(), ...affiliateAgg.keys(), ...googleAdsAgg.keys()]);

function round2(n) { return Math.round(n * 100) / 100; }

const daily = [];
allKeys.forEach((k) => {
  const [date, bucket] = k.split('|');
  const s = salesAgg.get(k) || { revenue: 0, grossProfit: 0, shipping: 0, packaging: 0, commissionRaw: 0 };
  const metaAds = metaAgg.get(k) || 0;
  const googleAds = googleAdsAgg.get(k) || 0;
  const affiliateFee = affiliateAgg.get(k) || 0;
  const commission = s.commissionRaw * 1.1;
  const margin = s.grossProfit - s.shipping - s.packaging - commission - metaAds - googleAds - affiliateFee;
  // Row: [date, countryBucket, revenue, budgetMeta, budgetGoogle, margin]
  daily.push([date, bucket, round2(s.revenue), round2(metaAds), round2(googleAds), round2(margin)]);
});

daily.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

// ---------- Freshness: a source skipped its refresh if it has nothing for yesterday ----------
// (no 2026 day so far has had zero affiliate orders, so an empty yesterday there means a skipped refresh too).
// The report stops at the last day every source has, so a missing source never shows up as zero cost.
const sources = [
  { name: 'Shopify', last: salesLast },
  { name: 'Meta Ads', last: metaLast, error: metaError },
  { name: 'Google Ads', last: googleAdsLast },
  { name: 'Influencer Affiliate', last: affiliateLast },
];
const cutoff = sources.reduce((min, s) => (s.last < min ? s.last : min), YESTERDAY_ROME);
if (cutoff < START_DATE) throw new Error('A source has no data at all: ' + JSON.stringify(sources));
const checkedAt = TODAY_ROME + ' ' + new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' }).format(new Date());
const status = {
  checkedAt,
  expected: YESTERDAY_ROME,
  cutoff,
  sources: sources.map((s) => ({ name: s.name, last: s.last, ok: s.last >= YESTERDAY_ROME, error: s.error || null })),
};
const shown = daily.filter((r) => r[0] <= cutoff);

fs.writeFileSync(outDir + '/daily.json', JSON.stringify(shown));
fs.writeFileSync(outDir + '/status.json', JSON.stringify(status));

console.log('daily rows:', shown.length);
console.log('date range:', shown[0][0], '->', shown[shown.length - 1][0]);
console.log('status:', JSON.stringify(status));

// Aggregates the 4 Google Sheet CSV exports into the compact JSON array the dashboard
// template needs: one row per (date, countryBucket) from 2026-01-01 onward with Revenue,
// Budget Meta and Margine di contribuzione. Countries are grouped into IT, DE_AT, ES, FR, OTHER.
// Run: node aggregate.js <sales_csv> <meta_csv> <affiliate_csv> <google_ads_csv> <out_dir>
const fs = require('fs');

const [, , salesCsvPath, metaCsvPath, affiliateCsvPath, googleAdsCsvPath, outDir] = process.argv;

const START_DATE = '2026-01-01';

// Exclude today (Europe/Rome calendar date): today's sales are still coming in when the
// dashboard refreshes, so the last complete day shown is always yesterday.
const TODAY_ROME = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function parseCsv(text) {
  // Full-text CSV parser (handles quoted fields with embedded commas AND embedded
  // newlines, e.g. ad names copy-pasted from Instagram captions in "Dati Meta").
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
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s).trim());
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
{
  const rows = parseCsv(fs.readFileSync(salesCsvPath, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const date = r[0];
    if (!date || date < START_DATE || date >= TODAY_ROME) continue;
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

// ---------- Meta sheet: "Dati Meta" ----------
// Columns used: C=2 Date (M/D/YYYY), D=3 Amount Spent (US-style decimal).
const metaAgg = new Map();
{
  const rows = parseCsv(fs.readFileSync(metaCsvPath, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const iso = isoFromMDY(r[2]);
    if (!iso || iso < START_DATE || iso >= TODAY_ROME) continue;
    const code = (r[1] && r[1] !== 'unknown') ? r[1] : 'ND';
    const k = keyOf(iso, code);
    metaAgg.set(k, (metaAgg.get(k) || 0) + parseNumUs(r[3]));
  }
}

// ---------- Affiliate sheet: "Influencer Affiliate" ----------
// Columns used: A=0 Order Date (D/M/YYYY), D=3 Shipping Country Code, G=6 Affiliate fee.
const affiliateAgg = new Map();
{
  const rows = parseCsv(fs.readFileSync(affiliateCsvPath, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const iso = isoFromDMY(r[0]);
    if (!iso || iso < START_DATE || iso >= TODAY_ROME) continue;
    const code = r[3] || 'ND';
    const k = keyOf(iso, code);
    affiliateAgg.set(k, (affiliateAgg.get(k) || 0) + parseNumEu(r[6]));
  }
}

// ---------- Google Ads sheet ----------
// Columns used: A=0 Date (M/D/YYYY), B=1 Country Code, C=2 Cost (US-style decimal).
const googleAdsAgg = new Map();
{
  const rows = parseCsv(fs.readFileSync(googleAdsCsvPath, 'utf8'));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const iso = isoFromMDY(r[0]);
    if (!iso || iso < START_DATE || iso >= TODAY_ROME) continue;
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
  // Row: [date, countryBucket, revenue, budgetMeta, margin]
  daily.push([date, bucket, round2(s.revenue), round2(metaAds), round2(margin)]);
});

daily.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));

fs.writeFileSync(outDir + '/daily.json', JSON.stringify(daily));

console.log('daily rows:', daily.length);
console.log('date range:', daily[0][0], '->', daily[daily.length - 1][0]);

// Fetches daily TikTok Ads spend by country from the Marketing API's Audience Report
// (report_type=AUDIENCE, data_level=AUCTION_ADVERTISER, dimensions=[stat_time_day,country_code]),
// mirroring fetch_meta.js's approach for Meta. The API caps any single request using
// stat_time_day to a 30-day span, so the full range is fetched in 30-day chunks.
// Run: TIKTOK_ACCESS_TOKEN=... node fetch_tiktok.js <out_json>
const fs = require('fs');

const [, , outPath] = process.argv;
const TOKEN = process.env.TIKTOK_ACCESS_TOKEN;
const ADVERTISER_ID = '7171001846155247618';
const API_VERSION = 'v1.3';
const START_DATE = '2026-01-01';
const MAX_SPAN_DAYS = 30;

const TODAY_ROME = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dateChunks(start, end, spanDays) {
  const chunks = [];
  let chunkStart = start;
  while (chunkStart <= end) {
    const chunkEnd = addDays(chunkStart, spanDays - 1) > end ? end : addDays(chunkStart, spanDays - 1);
    chunks.push([chunkStart, chunkEnd]);
    chunkStart = addDays(chunkEnd, 1);
  }
  return chunks;
}

async function getPage(startDate, endDate, page) {
  const params = new URLSearchParams({
    advertiser_id: ADVERTISER_ID,
    report_type: 'AUDIENCE',
    data_level: 'AUCTION_ADVERTISER',
    dimensions: JSON.stringify(['stat_time_day', 'country_code']),
    metrics: JSON.stringify(['spend']),
    start_date: startDate,
    end_date: endDate,
    page: String(page),
    page_size: '1000',
  });
  const url = `https://business-api.tiktok.com/open_api/${API_VERSION}/report/integrated/get/?${params}`;
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(url, { headers: { 'Access-Token': TOKEN } });
    const body = await resp.json();
    if (resp.ok && body.code === 0) return body.data;
    const retryable = resp.status >= 500 || resp.status === 429;
    if (!retryable || attempt >= 3) throw new Error(`TikTok API error: ${JSON.stringify(body)}`);
    await new Promise((r) => setTimeout(r, attempt * 5000));
  }
}

async function main() {
  if (!TOKEN) throw new Error('TIKTOK_ACCESS_TOKEN is not set');
  // Row: [date (YYYY-MM-DD), country code ('unknown' when TikTok can't attribute it), spend]
  const rows = [];
  for (const [chunkStart, chunkEnd] of dateChunks(START_DATE, TODAY_ROME, MAX_SPAN_DAYS)) {
    let page = 1;
    let totalPage = 1;
    do {
      const data = await getPage(chunkStart, chunkEnd, page);
      for (const item of data.list) {
        const date = item.dimensions.stat_time_day.slice(0, 10);
        const code = item.dimensions.country_code;
        const country = code && code !== 'None' ? code : 'unknown';
        rows.push([date, country, Number(item.metrics.spend)]);
      }
      totalPage = data.page_info.total_page;
      page++;
    } while (page <= totalPage);
  }
  if (rows.length === 0) throw new Error('TikTok API returned no rows');
  fs.writeFileSync(outPath, JSON.stringify(rows));
  const dates = rows.map((r) => r[0]).sort();
  console.log('tiktok rows:', rows.length, 'date range:', dates[0], '->', dates[dates.length - 1]);
}

main().catch((e) => {
  // Don't fail the build: aggregate.js falls back to the last deployed TikTok figures and the
  // dashboard shows a red "source not updated" banner instead of silently going stale.
  console.error('TikTok API fetch failed:', e.message);
  fs.writeFileSync(outPath, JSON.stringify({ error: e.message }));
});

// Live Portfolio Tracker - zero-dependency Node server (Node 18+)
// Serves /public and proxies price quotes (Yahoo Finance chart endpoint).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const cache = new Map(); // symbol -> { t, data }
const TTL = 5000;

async function getQuote(sym) {
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.t < TTL) return hit.data;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error((j.chart && j.chart.error && j.chart.error.description) || 'No data');
  const m = res.meta;
  const closes = ((res.indicators && res.indicators.quote && res.indicators.quote[0].close) || []).filter(x => x != null);
  const data = {
    symbol: sym,
    name: m.longName || m.shortName || sym,
    price: m.regularMarketPrice,
    prevClose: m.chartPreviousClose != null ? m.chartPreviousClose : m.previousClose,
    currency: m.currency,
    exchange: m.exchangeName,
    time: m.regularMarketTime,
    spark: closes,
  };
  cache.set(sym, { t: Date.now(), data });
  return data;
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/api/quotes') {
    const symbols = [...new Set((u.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean))].slice(0, 60);
    const out = {};
    await Promise.all(symbols.map(async s => {
      try { out[s] = await getQuote(s); }
      catch (e) { out[s] = { symbol: s, error: e.message }; }
    }));
    return send(res, 200, JSON.stringify(out));
  }
  let p = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

server.listen(PORT, () => console.log(`Portfolio tracker running at http://localhost:${PORT}`));

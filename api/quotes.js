const cache = new Map();
const TTL = 5000;

async function getQuote(sym) {
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.t < TTL) return hit.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=5m&range=1d`;
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!response.ok) throw new Error('HTTP ' + response.status);

  const payload = await response.json();
  const result = payload.chart && payload.chart.result && payload.chart.result[0];
  if (!result) {
    throw new Error((payload.chart && payload.chart.error && payload.chart.error.description) || 'No data');
  }

  const meta = result.meta;
  const closes = ((result.indicators && result.indicators.quote && result.indicators.quote[0].close) || [])
    .filter(value => value != null);
  const data = {
    symbol: sym,
    name: meta.longName || meta.shortName || sym,
    price: meta.regularMarketPrice,
    prevClose: meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose,
    currency: meta.currency,
    exchange: meta.exchangeName,
    time: meta.regularMarketTime,
    spark: closes,
  };

  cache.set(sym, { t: Date.now(), data });
  return data;
}

module.exports = async (req, res) => {
  const symbols = [...new Set(String(req.query.symbols || '')
    .split(',')
    .map(symbol => symbol.trim())
    .filter(Boolean))]
    .slice(0, 60);
  const quotes = {};

  await Promise.all(symbols.map(async symbol => {
    try {
      quotes[symbol] = await getQuote(symbol);
    } catch (error) {
      quotes[symbol] = { symbol, error: error.message };
    }
  }));

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(quotes);
};

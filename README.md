# Portfolio Monitor

A small, dependency-free live P&L dashboard for your open positions.

## Run it

1. Install Node.js 18 or newer (https://nodejs.org).
2. In this folder run:

   ```
   npm start
   ```
   (or `node server.js`)
3. Open http://localhost:3000

Use a different port with `PORT=8080 npm start`.

## Deploy to Vercel

1. Push this folder to a GitHub, GitLab, or Bitbucket repository.
2. In [Vercel](https://vercel.com), select **Add New... → Project**, import the repository, and click **Deploy**.
3. Leave the framework preset as **Other** and leave the build command blank. Vercel will serve the `public` folder and run `api/quotes.js` as a serverless function.

The Vercel deployment uses the same Yahoo Finance quote endpoint as the local server. Quote data is cached briefly within each serverless function instance.

## What you get

- Total, day and unrealized P&L, return on capital, equity
- Gross / net / long / short exposure, win-loss count, best and worst position
- Per-position last price, day %, P&L, return %, market value, weight, intraday sparkline
- Session P&L line chart (builds while the page is open) and P&L-by-position bars
- Auto refresh (5 / 10 / 30 / 60 s), sortable columns, light and dark theme

## Adding your positions

Click **+ Add position** (the three sample positions are placeholders — use **Clear all** to remove them).

- **Ticker**: plain tickers work (`AAPL`). Bloomberg style also works and is converted automatically:
  `AAPL US Equity`, `VOD LN Equity` (→ `VOD.L`), `SAP GR Equity` (→ `SAP.DE`),
  `EURUSD Curncy` (→ `EURUSD=X`), `SPX Index` (→ `^GSPC`), `CL1 Comdty` (→ `CL=F`).
  The dialog shows the symbol that will be looked up.
- **Side**: long or short (short P&L is calculated inversely).
- **Multiplier**: contract size for futures (default 1).
- **Account settings**: set your starting capital and any realized P&L from closed trades.

Bulk load: **Import CSV** with columns `symbol,side,qty,entry,multiplier`
(see `sample-positions.csv`). **Export CSV** saves your current list.

Everything is stored in your browser's localStorage — nothing is sent anywhere except the ticker symbols to Yahoo Finance via the local server.

## Notes and limits

- Prices come from Yahoo Finance's public chart endpoint, not Bloomberg, and may be delayed or differ slightly from the challenge's own prices. If the challenge exposes an official price feed, replace `getQuote()` in `server.js` — the frontend only needs `{ price, prevClose, name, spark[] }` per symbol.
- All values are shown in `$`; positions in other currencies are not converted.
- If a symbol shows a red error under its name, adjust the ticker (check the "lookup symbol" preview in the dialog).
- Not investment advice.

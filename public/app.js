(() => {
  'use strict';

  // ---------- storage ----------
  const LS_POS = 'pf.positions.v1', LS_SET = 'pf.settings.v1', LS_HIST = 'pf.history.v1';
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const SAMPLE = [
    { id: 's1', raw: 'AAPL US Equity', side: 'long', qty: 100, entry: 220, mult: 1 },
    { id: 's2', raw: 'MSFT US Equity', side: 'long', qty: 50, entry: 500, mult: 1 },
    { id: 's3', raw: 'TSLA US Equity', side: 'short', qty: 40, entry: 430, mult: 1 },
  ];

  const state = {
    positions: load(LS_POS, SAMPLE),
    settings: Object.assign({ capital: 1000000, realized: 0, interval: 10 }, load(LS_SET, {})),
    history: load(LS_HIST, []),
    quotes: {},
    sort: { key: 'pnl', dir: -1 },
    lastUpdate: null,
    editingId: null,
    timer: null,
    fetching: false,
  };

  // ---------- Bloomberg -> Yahoo symbol mapping ----------
  const EXCH = { LN: '.L', GR: '.DE', GY: '.DE', FP: '.PA', NA: '.AS', IM: '.MI', SM: '.MC', SW: '.SW', SS: '.ST', DC: '.CO', NO: '.OL', FH: '.HE', BB: '.BR', ID: '.IR', PL: '.LS', AV: '.VI', JT: '.T', HK: '.HK', AU: '.AX', CN: '.TO', IN: '.NS', KS: '.KS', TT: '.TW', SP: '.SI', CH: '.SS', C1: '.SS', C2: '.SZ' };
  const US = new Set(['US', 'UN', 'UQ', 'UW', 'UA', 'UP', 'UR']);
  const INDEX = { SPX: '^GSPC', INDU: '^DJI', CCMP: '^IXIC', NDX: '^NDX', RTY: '^RUT', UKX: '^FTSE', DAX: '^GDAXI', CAC: '^FCHI', SX5E: '^STOXX50E', NKY: '^N225', HSI: '^HSI', VIX: '^VIX' };
  const COMDTY = { CL1: 'CL=F', CO1: 'BZ=F', XAU: 'GC=F', GC1: 'GC=F', SI1: 'SI=F', NG1: 'NG=F', HG1: 'HG=F', ES1: 'ES=F', NQ1: 'NQ=F', TY1: 'ZN=F' };

  function toYahoo(raw) {
    const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!s) return '';
    const parts = s.split(' ');
    const last = parts[parts.length - 1];
    if (last === 'CURNCY') return parts[0].length === 6 ? parts[0] + '=X' : parts[0];
    if (last === 'INDEX') return INDEX[parts[0]] || '^' + parts[0];
    if (last === 'COMDTY') return COMDTY[parts[0]] || parts[0];
    if (last === 'EQUITY') parts.pop();
    if (parts.length === 2) {
      const [t, ex] = parts;
      if (US.has(ex)) return t.replace('/', '-');
      if (EXCH[ex]) return t + EXCH[ex];
    }
    return parts.join('-');
  }

  // ---------- helpers ----------
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = (n, d = 2) => n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (n, d = 0) => n == null || !isFinite(n) ? '—' : (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (n, d = 0) => n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : '') + money(n, d);
  const pct = n => n == null || !isFinite(n) ? '—' : (n > 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
  const cls = n => n == null || !isFinite(n) || n === 0 ? '' : n > 0 ? 'pos' : 'neg';
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ---------- calculations ----------
  function calc(p) {
    const yf = toYahoo(p.raw);
    const q = state.quotes[yf];
    const ok = q && !q.error && q.price != null;
    const sgn = p.side === 'short' ? -1 : 1;
    const m = p.mult || 1;
    const price = ok ? q.price : null;
    const prev = ok ? q.prevClose : null;
    const cost = p.qty * p.entry * m;
    const mv = ok ? p.qty * price * m * sgn : null; // signed exposure
    const pnl = ok ? (price - p.entry) * p.qty * m * sgn : null;
    const dayPnl = ok && prev != null ? (price - prev) * p.qty * m * sgn : null;
    return {
      p, yf, q, ok, price, prev, mv, pnl,
      pnlPct: pnl != null && cost ? pnl / cost : null,
      dayPnl,
      dayPct: ok && prev ? (price - prev) / prev * sgn : null,
      err: q && q.error ? q.error : null,
    };
  }

  function computeAll() {
    const rows = state.positions.map(calc);
    const live = rows.filter(r => r.ok);
    const gross = live.reduce((a, r) => a + Math.abs(r.mv), 0);
    rows.forEach(r => { r.weight = r.ok && gross ? Math.abs(r.mv) / gross : null; });
    const sum = f => live.reduce((a, r) => a + (f(r) || 0), 0);
    const unreal = sum(r => r.pnl);
    const day = sum(r => r.dayPnl);
    const longMv = live.filter(r => r.p.side !== 'short').reduce((a, r) => a + r.mv, 0);
    const shortMv = live.filter(r => r.p.side === 'short').reduce((a, r) => a + r.mv, 0);
    const wins = live.filter(r => r.pnl > 0).length;
    const sorted = [...live].sort((a, b) => b.pnl - a.pnl);
    const total = unreal + (Number(state.settings.realized) || 0);
    const cap = Number(state.settings.capital) || 0;
    return {
      rows, live, gross, unreal, day, total, cap,
      equity: cap + total,
      ret: cap ? total / cap : null,
      net: longMv + shortMv, longMv, shortMv,
      wins, losses: live.length - wins,
      best: sorted[0], worst: sorted[sorted.length - 1],
    };
  }

  // ---------- fetching ----------
  async function refresh() {
    if (state.fetching) return;
    const syms = [...new Set(state.positions.map(p => toYahoo(p.raw)).filter(Boolean))];
    if (!syms.length) { setStatus('idle', 'no positions'); render(); return; }
    state.fetching = true;
    setStatus('busy', 'updating…');
    try {
      const r = await fetch('/api/quotes?symbols=' + encodeURIComponent(syms.join(',')), { cache: 'no-store' });
      if (!r.ok) throw new Error('server ' + r.status);
      state.quotes = await r.json();
      state.lastUpdate = new Date();
      const bad = Object.values(state.quotes).filter(q => q.error).length;
      setStatus(bad === syms.length ? 'bad' : 'ok', (bad ? bad + ' symbol(s) failed · ' : '') + 'updated ' + state.lastUpdate.toLocaleTimeString());
      pushHistory();
    } catch (e) {
      setStatus('bad', 'offline — ' + (location.protocol === 'file:' ? 'run via npm start' : e.message));
    } finally {
      state.fetching = false;
      render();
    }
  }

  function pushHistory() {
    const c = computeAll();
    if (!c.live.length) return;
    state.history.push({ t: Date.now(), pnl: c.total });
    if (state.history.length > 3000) state.history = state.history.slice(-3000);
    save(LS_HIST, state.history);
  }

  function setStatus(kind, text) {
    $('#dot').className = 'dot ' + (kind === 'ok' ? 'ok' : kind === 'bad' ? 'bad' : '');
    $('#statusText').textContent = text;
  }

  function schedule() {
    clearInterval(state.timer);
    state.timer = setInterval(refresh, Math.max(3, state.settings.interval) * 1000);
  }

  // ---------- rendering ----------
  function render() {
    const c = computeAll();
    renderCards(c);
    renderTable(c);
    renderHist();
    renderBars(c);
    $('#posCount').textContent = '(' + state.positions.length + ')';
    $('#emptyHint').hidden = state.positions.length > 0;
    $('#subtitle').textContent = 'Trading challenge · ' + (state.lastUpdate ? 'last update ' + state.lastUpdate.toLocaleTimeString() : 'live P&L');
  }

  function card(label, val, sub, c) {
    return `<div class="card"><div class="lbl">${label}</div><div class="val ${c || ''}">${val}</div><div class="sm">${sub || '&nbsp;'}</div></div>`;
  }

  function renderCards(c) {
    const n = c.live.length;
    $('#cards').innerHTML = [
      card('Total P&L', signed(c.total), 'unrealized ' + signed(c.unreal) + ' · realized ' + signed(Number(state.settings.realized) || 0), cls(c.total)),
      card('Day P&L', signed(c.day), 'vs previous close', cls(c.day)),
      card('Return', pct(c.ret), 'on ' + money(c.cap) + ' capital', cls(c.ret)),
      card('Equity', money(c.equity), 'capital + total P&L'),
      card('Gross exposure', money(c.gross), c.cap ? (c.gross / c.cap).toFixed(2) + 'x capital' : ''),
      card('Net exposure', signed(c.net), 'long ' + money(c.longMv) + ' · short ' + money(Math.abs(c.shortMv))),
      card('Win / loss', n ? c.wins + ' / ' + c.losses : '—', n ? Math.round(c.wins / n * 100) + '% of positions green' : ''),
      card('Best', c.best ? esc(c.best.p.raw.split(' ')[0]) + ' ' + signed(c.best.pnl) : '—', c.best ? pct(c.best.pnlPct) : '', c.best ? cls(c.best.pnl) : ''),
      card('Worst', c.worst ? esc(c.worst.p.raw.split(' ')[0]) + ' ' + signed(c.worst.pnl) : '—', c.worst ? pct(c.worst.pnlPct) : '', c.worst ? cls(c.worst.pnl) : ''),
    ].join('');
  }

  function spark(arr, up) {
    if (!arr || arr.length < 2) return '<span class="muted">—</span>';
    const w = 90, h = 24, mn = Math.min(...arr), mx = Math.max(...arr), span = mx - mn || 1;
    const pts = arr.map((v, i) => (i / (arr.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - mn) / span * (h - 4)).toFixed(1)).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="var(--${up ? 'pos' : 'neg'})" stroke-width="1.5" points="${pts}"/></svg>`;
  }

  function renderTable(c) {
    const { key, dir } = state.sort;
    const val = r => {
      if (key === 'symbol') return r.p.raw.toUpperCase();
      if (key === 'side') return r.p.side;
      if (key === 'qty') return r.p.qty;
      if (key === 'entry') return r.p.entry;
      return r[key];
    };
    const rows = [...c.rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    document.querySelectorAll('th[data-k]').forEach(th => {
      th.classList.toggle('sorted', th.dataset.k === key);
      th.classList.toggle('asc', th.dataset.k === key && dir === 1);
    });
    $('#tbody').innerHTML = rows.map(r => {
      const p = r.p;
      const dp = r.q && r.q.spark && r.q.spark.length ? r.q.spark : null;
      const up = dp ? dp[dp.length - 1] >= dp[0] : true;
      return `<tr>
        <td class="sym"><b>${esc(p.raw)}</b><small>${r.err ? '<span class="err">' + esc(r.err) + ' (' + esc(r.yf) + ')</span>' : esc(r.q && r.q.name ? r.q.name : r.yf)}</small></td>
        <td><span class="tag ${p.side}">${p.side.toUpperCase()}</span></td>
        <td class="num">${nf(p.qty, p.qty % 1 ? 2 : 0)}</td>
        <td class="num">${nf(p.entry, 4).replace(/0{1,2}$/, '')}</td>
        <td class="num">${r.ok ? nf(r.price, 2) : '—'}</td>
        <td class="num ${cls(r.dayPct)}">${pct(r.dayPct)}</td>
        <td class="num ${cls(r.dayPnl)}">${signed(r.dayPnl)}</td>
        <td class="num ${cls(r.pnl)}"><b>${signed(r.pnl)}</b></td>
        <td class="num ${cls(r.pnlPct)}">${pct(r.pnlPct)}</td>
        <td class="num">${r.ok ? money(r.mv) : '—'}</td>
        <td class="num">${r.weight != null ? (r.weight * 100).toFixed(1) + '%' : '—'}</td>
        <td>${spark(dp, up)}</td>
        <td><button class="rowbtn" data-edit="${p.id}" title="Edit">✎</button><button class="rowbtn" data-del="${p.id}" title="Remove">✕</button></td>
      </tr>`;
    }).join('');
  }

  function renderHist() {
    const el = $('#histChart');
    const h = state.history;
    if (h.length < 2) { el.innerHTML = '<div class="empty">Collecting data… the line builds up while this page is open.</div>'; $('#histNote').textContent = ''; return; }
    const W = 640, H = 220, L = 58, R = 12, T = 10, B = 24;
    const xs = h.map(d => d.t), ys = h.map(d => d.pnl);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let y0 = Math.min(0, ...ys), y1 = Math.max(0, ...ys);
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const sx = t => L + (t - x0) / ((x1 - x0) || 1) * (W - L - R);
    const sy = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const pts = h.map(d => sx(d.t).toFixed(1) + ',' + sy(d.pnl).toFixed(1)).join(' ');
    const last = ys[ys.length - 1];
    const col = last >= 0 ? 'var(--pos)' : 'var(--neg)';
    const ticks = [y0, (y0 + y1) / 2, y1];
    const fmt = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Session P&L over time">
      ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${sy(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${signed(v)}</text>`).join('')}
      <line x1="${L}" x2="${W - R}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--muted)" stroke-dasharray="3 3"/>
      <polyline fill="none" stroke="${col}" stroke-width="2" points="${pts}"/>
      <text x="${L}" y="${H - 6}" font-size="10" fill="var(--muted)">${fmt(x0)}</text>
      <text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--muted)">${fmt(x1)}</text>
    </svg>`;
    $('#histNote').textContent = h.length + ' samples';
  }

  function renderBars(c) {
    const el = $('#barChart');
    const rows = c.live.slice().sort((a, b) => b.pnl - a.pnl);
    if (!rows.length) { el.innerHTML = '<div class="empty">No live prices yet.</div>'; return; }
    const rh = 26, W = 640, L = 90, R = 80, H = rows.length * rh + 8;
    const mx = Math.max(...rows.map(r => Math.abs(r.pnl)), 1);
    const zero = L + (W - L - R) / 2, half = (W - L - R) / 2;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Unrealized P&L by position">
      <line x1="${zero}" x2="${zero}" y1="0" y2="${H}" stroke="var(--line)"/>
      ${rows.map((r, i) => {
        const w = Math.abs(r.pnl) / mx * half, y = 4 + i * rh;
        const x = r.pnl >= 0 ? zero : zero - w;
        return `<text x="${L - 8}" y="${y + 15}" text-anchor="end" font-size="11" fill="var(--text)">${esc(r.p.raw.split(' ')[0])}</text>
          <rect x="${x}" y="${y + 3}" width="${Math.max(w, 1)}" height="16" rx="3" fill="var(--${r.pnl >= 0 ? 'pos' : 'neg'})"/>
          <text x="${W - R + 8}" y="${y + 15}" font-size="11" fill="var(--muted)">${signed(r.pnl)}</text>`;
      }).join('')}
    </svg>`;
  }

  // ---------- dialogs ----------
  const posDlg = $('#posDialog'), posForm = $('#posForm'), setDlg = $('#setDialog'), setForm = $('#setForm');

  function openPos(id) {
    state.editingId = id || null;
    const p = state.positions.find(x => x.id === id);
    $('#dlgTitle').textContent = p ? 'Edit position' : 'Add position';
    posForm.symbol.value = p ? p.raw : '';
    posForm.side.value = p ? p.side : 'long';
    posForm.qty.value = p ? p.qty : '';
    posForm.entry.value = p ? p.entry : '';
    posForm.mult.value = p ? (p.mult || 1) : 1;
    updatePreview();
    posDlg.showModal();
  }
  function updatePreview() {
    const y = toYahoo(posForm.symbol.value);
    $('#symPreview').textContent = y ? 'Price lookup symbol: ' + y : '';
  }
  posForm.symbol.addEventListener('input', updatePreview);
  $('#cancelDlg').onclick = () => posDlg.close();
  posForm.addEventListener('submit', e => {
    e.preventDefault();
    const rec = {
      id: state.editingId || uid(),
      raw: posForm.symbol.value.trim(),
      side: posForm.side.value,
      qty: Math.abs(parseFloat(posForm.qty.value)),
      entry: parseFloat(posForm.entry.value),
      mult: parseFloat(posForm.mult.value) || 1,
    };
    if (!rec.raw || !isFinite(rec.qty) || !isFinite(rec.entry)) return;
    const i = state.positions.findIndex(x => x.id === rec.id);
    if (i >= 0) state.positions[i] = rec; else state.positions.push(rec);
    save(LS_POS, state.positions);
    posDlg.close();
    render();
    refresh();
  });

  $('#settingsBtn').onclick = () => {
    setForm.capital.value = state.settings.capital;
    setForm.realized.value = state.settings.realized;
    setDlg.showModal();
  };
  $('#cancelSet').onclick = () => setDlg.close();
  setForm.addEventListener('submit', e => {
    e.preventDefault();
    state.settings.capital = parseFloat(setForm.capital.value) || 0;
    state.settings.realized = parseFloat(setForm.realized.value) || 0;
    save(LS_SET, state.settings);
    setDlg.close();
    render();
  });

  // ---------- events ----------
  $('#addBtn').onclick = () => openPos();
  $('#refreshBtn').onclick = refresh;
  $('#interval').value = String(state.settings.interval);
  $('#interval').onchange = e => { state.settings.interval = +e.target.value; save(LS_SET, state.settings); schedule(); };

  $('#tbody').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
    if (ed) openPos(ed.dataset.edit);
    if (dl && confirm('Remove this position?')) {
      state.positions = state.positions.filter(p => p.id !== dl.dataset.del);
      save(LS_POS, state.positions);
      render();
    }
  });
  document.querySelector('#table thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-k]');
    if (!th) return;
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'symbol' || k === 'side' ? 1 : -1) };
    render();
  });
  $('#clearBtn').onclick = () => {
    if (!confirm('Remove ALL positions and reset the P&L history?')) return;
    state.positions = []; state.history = [];
    save(LS_POS, []); save(LS_HIST, []);
    render();
  };

  // CSV import / export
  $('#exportBtn').onclick = () => {
    const lines = ['symbol,side,qty,entry,multiplier'].concat(state.positions.map(p => [JSON.stringify(p.raw), p.side, p.qty, p.entry, p.mult || 1].join(',')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = 'positions.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#importBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const rows = (await f.text()).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const out = [];
    for (const line of rows) {
      const cells = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());
      if (!cells.length || /^symbol$/i.test(cells[0])) continue;
      const [raw, side, qty, entry, mult] = cells;
      const q = parseFloat(qty), en = parseFloat(entry);
      if (raw && isFinite(q) && isFinite(en)) out.push({ id: uid(), raw, side: /^s/i.test(side) || q < 0 ? 'short' : 'long', qty: Math.abs(q), entry: en, mult: parseFloat(mult) || 1 });
    }
    if (!out.length) { alert('No valid rows found. Expected columns: symbol,side,qty,entry,multiplier'); return; }
    if (confirm('Import ' + out.length + ' positions? OK = replace existing, Cancel = add to existing.')) state.positions = out;
    else state.positions = state.positions.concat(out);
    save(LS_POS, state.positions);
    render(); refresh();
  };

  // ---------- go ----------
  render();
  refresh();
  schedule();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();

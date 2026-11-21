// astra-data.js: fills the ASTRA dashboard from data/dashboard.json.
// Add ONE line to index.html, AFTER the existing inline <script> and before </body>:
//     <script src="astra-data.js"></script>
// If the data file cannot be loaded, the page keeps its built-in sample values
// and says so in the note under the dashboard.
(function () {
  const DATA_URL = 'data/dashboard.json';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const setNote = msg => { const n = $('.demo'); if (n) n.textContent = msg; };

  // Same look as the original chart, but driven by real data
  function installChart(D) {
    const draw = function () {
      const c = document.getElementById('chart');
      if (!c) return;
      const x = c.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = c.clientWidth, H = c.clientHeight;
      c.width = W * dpr; c.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.clearRect(0, 0, W, H);
      const act = D.active, deb = D.debris, labels = D.labels;
      const pad = 26, bw = (W - pad * 2) / act.length;
      const max = Math.max(...act, ...deb, 1) * 1.1;
      x.font = '11px system-ui'; x.textAlign = 'center';
      act.forEach((v, i) => {
        const bx = pad + i * bw;
        [[v, '#22d3ee', 0], [deb[i], '#fbbf24', 1]].forEach(([val, col, k]) => {
          const h = (val / max) * (H - pad - 10);
          x.fillStyle = col;
          x.fillRect(bx + bw * .1 + k * bw * .4, H - pad - h, bw * .36, h);
        });
        x.fillStyle = '#8fa3c0'; x.fillText(labels[i], bx + bw / 2, H - 8);
      });
      x.strokeStyle = '#1e2f4d'; x.beginPath();
      x.moveTo(pad, H - pad); x.lineTo(W - pad, H - pad); x.stroke();
    };
    // stop the page's original (sample) chart from redrawing over ours on resize
    if (typeof window.drawChart === 'function') window.removeEventListener('resize', window.drawChart);
    window.drawChart = draw;
    window.addEventListener('resize', draw);
    draw();
  }

  async function load() {
    let d;
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      d = await res.json();
    } catch (err) {
      console.warn('ASTRA: could not load ' + DATA_URL + ' (' + err + '). Showing sample values. ' +
        'If you opened index.html by double-clicking it, serve it instead: python -m http.server');
      setNote('Showing built-in sample values: the live data file could not be loaded.');
      return;
    }

    // 1) KPI counters (the page animates them from data-to when scrolled into view)
    const k = d.kpis;
    const vals = [k.active_satellites, k.inactive_or_debris, k.stale_tracking, k.near_reentry];
    $$('.kpi strong').forEach((el, i) => {
      el.dataset.to = vals[i];
      if (el.closest('.reveal.in')) el.textContent = Number(vals[i]).toLocaleString();
    });

    // 2) Risk-zone bars (same order as the four bars in the page)
    $$('.bar').forEach((bar, i) => {
      const z = d.zones[i];
      if (!z) return;
      bar.children[0].textContent = z.zone;
      const fill = $('.fill', bar);
      fill.dataset.w = z.index;
      if (bar.closest('.reveal.in')) fill.style.width = z.index + '%';
      $('b', bar).textContent = z.index;
    });

    // 3) Re-entry candidates (heuristic list, lowest perigee first)
    const table = $('.panel table');
    if (table) {
      const rows = (d.reentry_candidates || []).slice(0, 5).map(r =>
        '<tr><td>' + esc(r.name) + '</td><td>' + r.perigee_km + ' km</td><td>' +
        esc(String(r.type).replace('_', ' ')) + '</td></tr>').join('');
      table.innerHTML = '<tr><th>Object</th><th>Perigee</th><th>Type</th></tr>' +
        (rows || '<tr><td colspan="3">None below threshold</td></tr>');
    }

    // 4) Density chart
    if (d.density) installChart(d.density);

    // 5) Honest note about where the numbers come from
    setNote(d.sample
      ? 'SAMPLE data for layout testing. The scheduled update has not run yet.'
      : 'CelesTrak public catalogue, updated ' + new Date(d.generated_at).toUTCString() +
        '. Zone score is relative to the busiest zone (=100), not a collision probability.');
  }

  load();
})();

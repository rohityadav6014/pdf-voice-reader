/* Sunotes admin panel: sign in with the admin password, then show the analytics summary. */
(() => {
  const $ = id => document.getElementById(id);
  const KEY = 'sunotes.admin';
  const fmt = n => Number(n || 0).toLocaleString('en-IN');

  const EVENT_NAMES = {
    page_view: 'Page views', open_file: 'Files opened', open_file_failed: 'Files that failed to open',
    choose_file: 'Files chosen', start_listening: 'Listening sessions', play: 'Play pressed', pause: 'Pause pressed',
    stop: 'Stop pressed', skip: 'Skips', start_from_word: 'Started from a word (double-click)',
    finished_reading: 'Finished a whole file', change_language: 'Changed audio language', change_voice: 'Changed voice',
    change_speed: 'Changed speed', auto_scroll: 'Toggled auto-scroll', keyboard_shortcut: 'Keyboard shortcuts',
    zoom: 'Zoomed', toggle_panel: 'Hid/showed side panel', open_tab: 'Switched tab (Listen/Notes)',
    notes_language: 'Changed notes language', download_notes: 'Notes downloaded', copy_notes: 'Notes copied',
    listen_from_notes: 'Listened from a note', go_home: 'Clicked logo (home)', back_to_reading: 'Back to reading',
    resume_continue: 'Continued where they left off', resume_start_over: 'Started over',
    recent_open: 'Reopened a recent file', recent_remove: 'Removed a recent file',
    music_toggle: 'Toggled background music', music_volume: 'Changed music volume', music_source: 'Changed music source',
    error: 'Problems',
  };
  const LABELS = {
    device: { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' },
    browser: { chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari', opera: 'Opera', samsung: 'Samsung Internet', other: 'Other' },
    referrer: { direct: 'Direct / typed link', internal: 'Within Sunotes' },
    file_type: { pdf: 'PDF', docx: 'Word (.docx)' },
    listen_language: { en: 'English', hi: 'हिन्दी (Hindi)' },
    download_format: { doc: 'Word', txt: 'Text', pdf: 'PDF' },
    skip_type: { next_sentence: 'Next sentence', prev_sentence: 'Previous sentence', next_page: 'Next page', prev_page: 'Previous page', slider: 'Slider' },
    error_type: { speech: 'Voice problems', music: 'Music problems' },
  };
  const METRICS = { visitors: 'Visitors', page_views: 'Page views', files_opened: 'Files opened', listening: 'Listening sessions' };

  let regionNames = null;
  try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* old browser */ }

  const state = { days: 7, metric: 'visitors', data: null, timer: null };

  function show(view) {
    ['loginView', 'setupView', 'elsewhereView', 'dashView'].forEach(v => { $(v).hidden = v !== view; });
    $('adminActions').hidden = view !== 'dashView';
  }

  let toastTimer;
  function toast(msg) {
    $('toast').textContent = msg;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4000);
  }

  // The login ({ email, password }) is kept only for this browser tab.
  const getKey = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const setKey = k => { try { k ? sessionStorage.setItem(KEY, JSON.stringify(k)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

  /* ---------- Data ---------- */
  async function load(login, quiet) {
    if (!login || !login.password) { show('loginView'); return false; }
    let res;
    try {
      res = await fetch(`/api/stats?days=${state.days}`, {
        headers: { 'X-Admin-Key': login.password, 'X-Admin-Email': login.email || '' },
        cache: 'no-store',
      });
    } catch {
      if (!quiet) toast('Could not reach the server. Check your connection.');
      return false;
    }
    if (res.status === 404) { show('elsewhereView'); return false; }
    const body = await res.json().catch(() => ({}));
    if (res.status === 503 && body.error === 'setup') { showSetup(body.missing || []); return false; }
    if (res.status === 401 || res.status === 429) {
      setKey(null);
      show('loginView');
      $('loginError').textContent = body.error === 'wrong login' ? 'That email or password is not right.' : (body.error || 'Please sign in again.');
      return false;
    }
    if (!res.ok) { if (!quiet) toast(body.error || 'Something went wrong loading the stats.'); return false; }
    state.data = body;
    render();
    show('dashView');
    return true;
  }

  function showSetup(missing) {
    const items = [];
    if (missing.includes('storage')) {
      items.push('<b>Analytics storage:</b> in Vercel open the project → <b>Storage</b> → <b>Create Database</b> → choose <b>Upstash for Redis</b> (free plan) → connect it to the <b>sunotes</b> project.');
    }
    if (missing.includes('ADMIN_PASSWORD')) {
      items.push('<b>Your admin password:</b> in Vercel open the project → <b>Settings</b> → <b>Environment Variables</b> → add <code>ADMIN_PASSWORD</code> with a strong password only you know (Production).');
    }
    $('setupList').innerHTML = items.map(i => `<li>${i}</li>`).join('');
    show('setupView');
  }

  /* ---------- Rendering ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dateLabel = (iso, opts) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', opts || { day: 'numeric', month: 'short' });

  function render() {
    const d = state.data;
    const t = d.totals || {};
    $('rangeLabel').textContent = d.range.days === 1
      ? `Today, ${dateLabel(d.range.to, { day: 'numeric', month: 'long', year: 'numeric' })}`
      : `${dateLabel(d.range.from)} – ${dateLabel(d.range.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;

    const kpis = [
      { label: '<span class="live-dot"></span>Active now', value: d.activeNow, sub: 'last 5 minutes' },
      { label: 'Visitors', value: d.uniqueVisitors, sub: 'unique, this period' },
      { label: 'Page views', value: t.page_view },
      { label: 'Files opened', value: t.open_file },
      { label: 'Listening sessions', value: t.start_listening },
      { label: 'Notes downloads', value: t.download_notes },
    ];
    $('kpis').innerHTML = kpis.map(k => `<div class="kpi"><div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${fmt(k.value)}</div>${k.sub ? `<div class="kpi-sub">${k.sub}</div>` : ''}</div>`).join('');

    renderChart();
    renderTable();

    const actions = (d.topActions || []).map(a => ({ name: EVENT_NAMES[a.name] || a.name.replace(/_/g, ' '), count: a.count }));
    meters($('actions'), actions);
    for (const [dim, list] of Object.entries(d.breakdowns || {})) {
      const el = $(`b-${dim}`);
      if (!el) continue;
      meters(el, list.map(x => ({ name: labelFor(dim, x.name), count: x.count })));
    }
  }

  function labelFor(dim, value) {
    if (dim === 'country') {
      if (value === 'unknown' || !/^[a-z]{2}$/.test(value)) return 'Unknown';
      try { return regionNames ? regionNames.of(value.toUpperCase()) : value.toUpperCase(); } catch { return value.toUpperCase(); }
    }
    if (dim === 'speed') return `${value}×`;
    return (LABELS[dim] && LABELS[dim][value]) || value;
  }

  function meters(el, list) {
    if (!list.length) { el.innerHTML = '<p class="empty">No data yet</p>'; return; }
    const max = Math.max(...list.map(x => x.count), 1);
    el.innerHTML = list.map(x => `<div class="meter">
      <span class="meter-name" title="${esc(x.name)}">${esc(x.name)}</span><span class="meter-count">${fmt(x.count)}</span>
      <div class="meter-bar"><div style="width:${(x.count / max * 100).toFixed(1)}%"></div></div></div>`).join('');
  }

  // Four gridline steps of a whole "nice" size (1, 2, 5 × 10ⁿ), so axis labels are round numbers.
  function niceMax(v) {
    const raw = Math.max(v, 1) / 4;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / p;
    const step = Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p);
    return step * 4;
  }

  function renderChart() {
    const el = $('chart');
    const daily = state.data.daily || [];
    const metric = state.metric;
    $('chartTitle').textContent = `${METRICS[metric]} per day`;
    const values = daily.map(x => x[metric] || 0);
    if (!values.some(v => v > 0)) { el.innerHTML = '<div class="chart-empty">No data for this period yet</div>'; return; }

    const W = el.clientWidth || 800;
    const H = el.clientHeight || 240;
    const pad = { l: 36, r: 8, t: 10, b: 24 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const max = niceMax(Math.max(...values));
    const n = values.length;
    const slot = innerW / n;
    const barW = Math.max(2, Math.min(36, slot - 2)); // ≥2px gap between bars
    const y = v => pad.t + innerH - (v / max) * innerH;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${METRICS[metric]} per day">`;
    for (let k = 0; k <= 4; k++) {
      const v = (max / 4) * k;
      const yy = y(v);
      svg += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}"/>`;
      svg += `<text class="axis-label" x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${fmt(Math.round(v))}</text>`;
    }
    const every = Math.ceil(n / Math.max(1, Math.floor(innerW / 64))); // thin out date labels
    values.forEach((v, i) => {
      const x = pad.l + i * slot + (slot - barW) / 2;
      const top = y(v);
      const h = pad.t + innerH - top;
      const r = Math.min(4, barW / 2, h);
      if (v > 0) {
        // Rounded top, flat bottom on the baseline.
        svg += `<path class="bar" data-i="${i}" d="M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z"/>`;
      }
      svg += `<rect class="hit" data-i="${i}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${innerH}"/>`;
      if (i % every === 0 || i === n - 1) {
        svg += `<text class="axis-label" x="${x + barW / 2}" y="${H - 6}" text-anchor="middle">${dateLabel(daily[i].date)}</text>`;
      }
    });
    el.innerHTML = svg + '</svg>';
  }

  function renderTable() {
    const daily = state.data.daily || [];
    $('chartTable').innerHTML = `<table><thead><tr><th>Date</th>${Object.values(METRICS).map(m => `<th>${m}</th>`).join('')}</tr></thead>
      <tbody>${daily.slice().reverse().map(r => `<tr><td>${dateLabel(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
      ${Object.keys(METRICS).map(k => `<td>${fmt(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  /* ---------- Chart hover ---------- */
  $('chart').addEventListener('mousemove', e => {
    const hit = e.target.closest('.hit');
    const tip = $('chartTip');
    $('chart').querySelectorAll('.bar').forEach(b => b.classList.toggle('dim', hit && b.dataset.i !== hit?.dataset.i));
    if (!hit) { tip.hidden = true; return; }
    const row = state.data.daily[+hit.dataset.i];
    tip.innerHTML = `<b>${dateLabel(row.date, { weekday: 'short', day: 'numeric', month: 'short' })}</b>${METRICS[state.metric]}: ${fmt(row[state.metric])}`;
    tip.hidden = false;
    const card = $('chart').closest('.card').getBoundingClientRect();
    const left = Math.min(e.clientX - card.left + 12, card.width - tip.offsetWidth - 8);
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${e.clientY - card.top - tip.offsetHeight - 10}px`;
  });
  $('chart').addEventListener('mouseleave', () => {
    $('chartTip').hidden = true;
    $('chart').querySelectorAll('.bar').forEach(b => b.classList.remove('dim'));
  });

  /* ---------- Controls ---------- */
  function setActive(groupId, attr, value) {
    $(groupId).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset[attr] === String(value)));
  }

  $('rangeToggle').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    state.days = +b.dataset.days;
    setActive('rangeToggle', 'days', state.days);
    load(getKey());
  });
  $('metricToggle').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !state.data) return;
    state.metric = b.dataset.metric;
    setActive('metricToggle', 'metric', state.metric);
    renderChart();
  });
  $('tableToggle').addEventListener('click', () => {
    const open = $('chartTable').hidden;
    $('chartTable').hidden = !open;
    $('tableToggle').textContent = open ? 'Hide table' : 'Show as table';
    $('tableToggle').setAttribute('aria-expanded', open);
  });
  $('refreshBtn').addEventListener('click', () => load(getKey()));
  $('signOutBtn').addEventListener('click', () => {
    setKey(null);
    state.data = null;
    $('password').value = '';
    $('loginError').textContent = '';
    show('loginView');
  });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const login = { email: $('email').value.trim(), password: $('password').value };
    if (!login.password) return;
    $('loginBtn').disabled = true;
    $('loginError').textContent = '';
    const ok = await load(login);
    $('loginBtn').disabled = false;
    if (ok) { setKey(login); $('password').value = ''; }
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state.data && !$('dashView').hidden) renderChart(); }, 150);
  });

  // Keep "active now" and today's numbers fresh while the panel is open.
  setInterval(() => {
    if (!document.hidden && !$('dashView').hidden && getKey()) load(getKey(), true);
  }, 60000);

  /* ---------- Start ---------- */
  if (/github\.io$/.test(location.hostname)) {
    show('elsewhereView');
  } else if (getKey()) {
    load(getKey());
  } else {
    show('loginView');
    $('email').focus();
  }
})();

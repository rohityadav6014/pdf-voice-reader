/* Renders PDF pages (lazily) with a transparent, clickable text layer on top. */
const Viewer = (() => {
  let pdf = null;
  let container = null;
  let pages = [];          // app page data: { width, height, items, styles }
  let els = [];            // per page: { root, canvas, layer, spans: Map(itemIdx → span), rendered, rendering }
  let scale = 1;
  let zoom = 1;
  let observer = null;
  let onDouble = () => {};
  let highlight = { page: -1, items: [] };
  const measureCtx = document.createElement('canvas').getContext('2d');

  function init(pdfDoc, viewerEl, pageData, onDoubleClick) {
    pdf = pdfDoc;
    container = viewerEl;
    pages = pageData;
    onDouble = onDoubleClick;
    zoom = 1;
    container.innerHTML = '';
    els = [];
    if (observer) observer.disconnect();

    computeScale();
    pages.forEach((p, i) => {
      const root = document.createElement('div');
      root.className = 'page';
      root.dataset.page = i;
      const num = document.createElement('span');
      num.className = 'page-num';
      num.textContent = i + 1;
      root.appendChild(num);
      container.appendChild(root);
      els.push({ root, canvas: null, layer: null, spans: new Map(), rendered: false, rendering: null });
      sizePage(i);
    });

    observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) render(+e.target.dataset.page); });
    }, { root: container, rootMargin: '600px 0px' });
    els.forEach(e => observer.observe(e.root));

    bindEvents();
  }

  function computeScale() {
    const maxW = Math.max(...pages.map(p => p.width), 1);
    const avail = Math.max(container.clientWidth - 40, 280);
    scale = Math.min(avail / maxW, 2.4) * zoom; // fit the page to the full width for comfortable reading
  }

  function sizePage(i) {
    const p = pages[i];
    els[i].root.style.width = Math.floor(p.width * scale) + 'px';
    els[i].root.style.height = Math.floor(p.height * scale) + 'px';
  }

  async function render(i) {
    const el = els[i];
    if (el.rendered || el.rendering) return el.rendering;
    const myScale = scale;
    let stale = false;
    el.rendering = (async () => {
      const page = await pdf.getPage(i + 1);
      const viewport = page.getViewport({ scale: myScale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      }).promise;
      if (myScale !== scale) { stale = true; return; } // zoom changed while rendering

      const layer = buildTextLayer(i, viewport);
      el.root.querySelectorAll('canvas, .text-layer').forEach(n => n.remove());
      el.root.appendChild(canvas);
      el.root.appendChild(layer);
      el.canvas = canvas;
      el.layer = layer;
      el.rendered = true;
      el.root.classList.add('is-rendered');
      el.root.classList.toggle('no-text', el.spans.size === 0);
      if (highlight.page === i) applyHighlight();
    })().finally(() => {
      el.rendering = null;
      if (stale) render(i);
    });
    return el.rendering;
  }

  function buildTextLayer(i, viewport) {
    const { items, styles } = pages[i];
    const layer = document.createElement('div');
    layer.className = 'text-layer';
    const spans = new Map();
    items.forEach((item, idx) => {
      if (!item.str || !item.str.trim()) return;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      if (fontHeight < 1) return;
      const style = styles[item.fontName] || {};
      const family = style.fontFamily || 'sans-serif';
      const ascent = style.ascent ? style.ascent : style.descent ? 1 + style.descent : 0.8;
      const angle = Math.atan2(tx[1], tx[0]);
      const left = angle === 0 ? tx[4] : tx[4] + fontHeight * ascent * Math.sin(angle);
      const top = angle === 0 ? tx[5] - fontHeight * ascent : tx[5] - fontHeight * ascent * Math.cos(angle);

      const span = document.createElement('span');
      span.textContent = item.str;
      span.dataset.i = idx;
      span.style.left = left + 'px';
      span.style.top = top + 'px';
      span.style.fontSize = fontHeight + 'px';
      span.style.fontFamily = family;

      measureCtx.font = `${fontHeight}px ${family}`;
      const measured = measureCtx.measureText(item.str).width;
      const target = (style.vertical ? item.height : item.width) * viewport.scale;
      let transform = '';
      if (angle !== 0) transform += `rotate(${angle}rad) `;
      if (measured > 0 && target > 0) transform += `scaleX(${target / measured})`;
      if (transform) span.style.transform = transform;

      layer.appendChild(span);
      spans.set(idx, span);
    });
    els[i].spans = spans;
    return layer;
  }

  /* ---------- Highlight & follow ---------- */
  function setHighlight(page, itemIdxs, follow) {
    clearHighlight();
    highlight = { page, items: itemIdxs };
    els.forEach((e, i) => e.root.classList.toggle('reading-page', i === page));
    if (page < 0) return;
    const el = els[page];
    if (!el) return;
    if (el.rendered) applyHighlight();
    else render(page);
    if (follow) scrollTo(page, itemIdxs[0]);
  }

  function applyHighlight() {
    const el = els[highlight.page];
    if (!el) return;
    highlight.items.forEach(idx => { const s = el.spans.get(idx); if (s) s.classList.add('reading'); });
  }

  function clearHighlight() {
    if (highlight.page >= 0 && els[highlight.page]) {
      els[highlight.page].spans.forEach(s => s.classList.remove('reading'));
    }
    highlight = { page: -1, items: [] };
  }

  function scrollTo(page, itemIdx) {
    const el = els[page];
    if (!el) return;
    const span = itemIdx != null ? el.spans.get(itemIdx) : null;
    const target = span || el.root;
    const c = container.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const visible = span
      ? r.top >= c.top + 40 && r.bottom <= c.bottom - 40
      : r.top < c.bottom && r.bottom > c.top;
    if (visible) return;
    if (span) span.scrollIntoView({ block: 'center', behavior: 'smooth' });
    else el.root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function scrollToPage(page) {
    if (els[page]) els[page].root.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /* ---------- Zoom ---------- */
  function setZoom(z) {
    const ratio = container.scrollTop / Math.max(container.scrollHeight, 1);
    zoom = Math.min(Math.max(z, 0.5), 3);
    computeScale();
    els.forEach((el, i) => {
      el.rendered = false;
      el.root.classList.remove('is-rendered');
      sizePage(i);
      el.root.querySelectorAll('canvas, .text-layer').forEach(n => n.remove());
      el.spans = new Map();
    });
    container.scrollTop = ratio * container.scrollHeight;
    els.forEach(e => { observer.unobserve(e.root); observer.observe(e.root); });
    return zoom;
  }

  function getZoom() { return zoom; }

  /* ---------- Double click / double tap ---------- */
  let bound = false;
  let lastTap = { t: 0, x: 0, y: 0 };
  let lastFire = 0;

  function bindEvents() {
    if (bound) return;
    bound = true;
    container.addEventListener('dblclick', e => handleDouble(e.target, e.clientX, e.clientY));
    container.addEventListener('touchend', e => {
      if (e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const now = Date.now();
      if (now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 30) {
        e.preventDefault();
        handleDouble(document.elementFromPoint(t.clientX, t.clientY), t.clientX, t.clientY);
        lastTap.t = 0;
      } else {
        lastTap = { t: now, x: t.clientX, y: t.clientY };
      }
    }, { passive: false });
  }

  function handleDouble(target, x, y) {
    const now = Date.now();
    if (now - lastFire < 400) return; // touch + synthetic dblclick
    lastFire = now;
    const pageEl = target && target.closest ? target.closest('.page') : null;
    if (!pageEl) return;
    const page = +pageEl.dataset.page;
    let span = target.closest('.text-layer span');
    let charOffset = 0;

    if (span) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && span.contains(sel.getRangeAt(0).startContainer)) {
        charOffset = sel.getRangeAt(0).startOffset;
      } else if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        if (r && span.contains(r.startContainer)) charOffset = r.startOffset;
      }
    } else {
      span = nearestSpan(page, x, y);
    }
    if (window.getSelection) window.getSelection().removeAllRanges();
    onDouble(page, span ? +span.dataset.i : null, charOffset);
  }

  function nearestSpan(page, x, y) {
    let best = null;
    let bestD = Infinity;
    els[page].spans.forEach(s => {
      const r = s.getBoundingClientRect();
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const d = dy * 3 + dx; // prefer the same line
      if (d < bestD) { bestD = d; best = s; }
    });
    return best;
  }

  return { init, setHighlight, clearHighlight, scrollToPage, setZoom, getZoom };
})();

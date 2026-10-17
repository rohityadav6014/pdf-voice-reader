/*
 * Word (.docx) documents: converted to HTML with mammoth.js, split into page-sized parts,
 * with every sentence wrapped in a span so it can be highlighted and double-clicked.
 */
const DocView = (() => {
  const MAMMOTH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
  const PAGE_CHARS = 3000;   // about one printed page of text
  const BLOCKS = 'p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,caption,pre';

  let container = null;
  let zoom = 1;
  let onDouble = () => {};
  let spans = new Map();     // sentence index → [span, …]
  let current = -1;
  let pageEls = [];
  let mammothLoading = null;

  function loadMammoth() {
    if (window.mammoth) return Promise.resolve();
    if (mammothLoading) return mammothLoading;
    mammothLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MAMMOTH_URL;
      s.onload = resolve;
      s.onerror = () => { mammothLoading = null; reject(new Error('Could not load the Word reader. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return mammothLoading;
  }

  // Only allow ordinary links; drop anything else the document might carry.
  function sanitize(root) {
    root.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        const name = a.name.toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(a.name);
      });
    });
    root.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href').trim();
      if (/^(https?:|mailto:|#)/i.test(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      else a.removeAttribute('href');
    });
    root.querySelectorAll('img').forEach(img => {
      if (!/^data:image\//i.test(img.getAttribute('src') || '')) img.remove();
    });
  }

  /** Convert a .docx into page parts and sentences. */
  async function parse(arrayBuffer) {
    await loadMammoth();
    const result = await mammoth.convertToHtml({ arrayBuffer });
    const tmp = document.createElement('div');
    tmp.innerHTML = result.value;
    sanitize(tmp);

    // Group top-level blocks into pages, preferring to start a new page at a heading.
    const parts = [];
    let cur = null;
    let size = 0;
    [...tmp.children].forEach(el => {
      const len = el.textContent.length;
      const heading = /^H[1-3]$/.test(el.tagName);
      if (!cur || (size > 0 && (size + len > PAGE_CHARS || (heading && size > PAGE_CHARS * 0.4)))) {
        cur = document.createElement('div');
        parts.push(cur);
        size = 0;
      }
      cur.appendChild(el);
      size += len;
    });
    if (!parts.length) parts.push(document.createElement('div'));

    const sentences = [];
    const pages = parts.map((el, p) => {
      const first = sentences.length;
      leafBlocks(el).forEach(block => wrapSentences(block, p, sentences));
      const h = el.querySelector('h1,h2,h3');
      return { num: p + 1, heading: h ? h.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '', first, last: sentences.length - 1, el };
    });
    return { pages, sentences };
  }

  function leafBlocks(root) {
    return [...root.querySelectorAll(BLOCKS)].filter(el => !el.querySelector(BLOCKS));
  }

  function wrapSentences(block, page, sentences) {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let text = '';
    while (walker.nextNode()) {
      nodes.push({ node: walker.currentNode, start: text.length });
      text += walker.currentNode.nodeValue;
    }
    if (!text.trim()) return;

    const ranges = TextUtils.splitSentences(text, new Set()).map(r => {
      const raw = text.slice(r.start, r.end);
      const clean = raw.replace(/\s+/g, ' ').trim();
      if (!clean) return null;
      const id = sentences.length;
      sentences.push({ page, text: clean, raw, start: r.start, end: r.end });
      return { ...r, id };
    }).filter(Boolean);

    // Replace each text node with plain text + sentence spans (a sentence may cross bold/italic runs).
    nodes.forEach(({ node, start }) => {
      const end = start + node.nodeValue.length;
      const frag = document.createDocumentFragment();
      let pos = start;
      for (const r of ranges) {
        if (r.end <= start || r.start >= end) continue;
        const a = Math.max(r.start, start);
        const b = Math.min(r.end, end);
        if (a > pos) frag.appendChild(document.createTextNode(text.slice(pos, a)));
        const span = document.createElement('span');
        span.className = 'sent';
        span.dataset.s = r.id;
        span.dataset.o = a - r.start; // where this piece starts inside the sentence
        span.textContent = text.slice(a, b);
        frag.appendChild(span);
        pos = b;
      }
      if (pos < end) frag.appendChild(document.createTextNode(text.slice(pos, end)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  /* ---------- Rendering ---------- */
  function render(viewerEl, pages, onDoubleClick) {
    container = viewerEl;
    onDouble = onDoubleClick;
    current = -1;
    container.innerHTML = '';
    container.classList.add('doc-mode');
    setZoom(1);
    pageEls = pages.map(p => {
      const page = document.createElement('article');
      page.className = 'doc-page';
      page.dataset.page = p.num - 1;
      const num = document.createElement('span');
      num.className = 'page-num';
      num.textContent = p.num;
      const body = document.createElement('div');
      body.className = 'doc-body';
      body.appendChild(p.el);
      page.append(num, body);
      container.appendChild(page);
      return page;
    });
    spans = new Map();
    container.querySelectorAll('.sent').forEach(s => {
      const id = +s.dataset.s;
      if (!spans.has(id)) spans.set(id, []);
      spans.get(id).push(s);
    });
    bindEvents();
  }

  function highlight(idx, follow) {
    if (current >= 0) (spans.get(current) || []).forEach(s => s.classList.remove('reading'));
    current = idx;
    const list = spans.get(idx) || [];
    list.forEach(s => s.classList.add('reading'));
    const page = list[0] ? list[0].closest('.doc-page') : null;
    pageEls.forEach(p => p.classList.toggle('reading-page', p === page));
    if (follow && list[0]) {
      const c = container.getBoundingClientRect();
      const r = list[0].getBoundingClientRect();
      if (r.top < c.top + 60 || r.bottom > c.bottom - 60) list[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  function clearHighlight() { highlight(-1, false); }

  function scrollToPage(i) {
    if (pageEls[i]) pageEls[i].scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function setZoom(z) {
    zoom = Math.min(Math.max(z, 0.7), 1.8);
    if (container) container.style.setProperty('--doc-zoom', zoom);
    return zoom;
  }

  function getZoom() { return zoom; }

  function detach() {
    if (container) { container.classList.remove('doc-mode'); container.style.removeProperty('--doc-zoom'); }
    spans = new Map();
    pageEls = [];
  }

  /* ---------- Double click / double tap ---------- */
  let bound = false;
  let lastTap = { t: 0, x: 0, y: 0 };
  let lastFire = 0;

  function bindEvents() {
    if (bound) return;
    bound = true;
    container.addEventListener('dblclick', e => {
      if (container.classList.contains('doc-mode')) handleDouble(e.target, e.clientX, e.clientY);
    });
    container.addEventListener('touchend', e => {
      if (!container.classList.contains('doc-mode') || e.changedTouches.length !== 1) return;
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
    if (now - lastFire < 400) return;
    lastFire = now;
    if (!target || !target.closest) return;
    const span = target.closest('.sent');
    const page = target.closest('.doc-page');
    let caret = null;
    const sel = window.getSelection ? window.getSelection() : null;
    if (sel) {
      if (sel.rangeCount && span && span.contains(sel.getRangeAt(0).startContainer)) caret = sel.getRangeAt(0).startOffset;
      sel.removeAllRanges();
    }
    if (span) {
      if (caret == null && document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        if (r && span.contains(r.startContainer)) caret = r.startOffset;
      }
      onDouble(+span.dataset.s, +span.dataset.o + (caret || 0));
    } else if (page) {
      onDouble(null, 0, +page.dataset.page);
    }
  }

  return { parse, render, highlight, clearHighlight, scrollToPage, setZoom, getZoom, detach };
})();

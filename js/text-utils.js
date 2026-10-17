/* Turns pdf.js text items into page text, sentences and speech-friendly strings. */
const TextUtils = (() => {
  const END_PUNCT = '.!?।';
  const CLOSERS = '"\')]”’»';
  const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'fig', 'figs', 'no', 'nos', 'vol',
    'pp', 'p', 'eq', 'eqs', 'e.g', 'i.e', 'cf', 'al', 'approx', 'dept', 'est', 'inc', 'ltd', 'co',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'govt', 'rs',
  ]);
  const MAX_SENTENCE = 200;

  function itemHeight(item) {
    if (!item.transform) return item.height || 0;
    return Math.hypot(item.transform[2], item.transform[3]) || item.height || 0;
  }

  /**
   * Concatenate a page's text items into one string.
   * Returns the text plus, for every item, its [start, end) range in that string,
   * the offsets where a new block starts (headings / paragraph gaps) and
   * the positions of end-of-line hyphens that should be dropped when speaking.
   */
  function buildPage(items) {
    let text = '';
    const ranges = new Array(items.length);
    const breaks = new Set();
    const softHyphens = new Set();

    const heights = items.filter(it => it.str && it.str.trim()).map(itemHeight).sort((a, b) => a - b);
    const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;

    let prev = null;
    let prevH = 0;
    let headingSize = 0;
    let headingParts = [];

    items.forEach((item, i) => {
      const str = item.str || '';
      if (!str.trim()) {
        ranges[i] = [text.length, text.length];
        if (item.hasEOL && text && !/\s$/.test(text)) text += ' ';
        return;
      }
      const h = itemHeight(item);
      const x = item.transform ? item.transform[4] : 0;
      const y = item.transform ? item.transform[5] : 0;

      let newBlock = false;
      if (prev) {
        const px = prev.transform ? prev.transform[4] + prev.width : 0;
        const py = prev.transform ? prev.transform[5] : 0;
        const sameLine = Math.abs(py - y) < Math.max(h, prevH) * 0.5;
        if (!sameLine) {
          const gap = Math.abs(py - y);
          if (gap > Math.max(h, prevH) * 1.9) newBlock = true;
          if (median && Math.abs(h - prevH) / median > 0.2) newBlock = true;
        }
        if (text && !/\s$/.test(text) && !/^\s/.test(str)) {
          const endsWithHyphen = /[A-Za-z]-$/.test(text) && (prev.hasEOL || !sameLine);
          if (endsWithHyphen && /^[a-z]/.test(str)) {
            softHyphens.add(text.length - 1);
          } else if (prev.hasEOL || !sameLine || x - px > h * 0.15) {
            text += ' ';
          }
        }
      }
      if (newBlock) breaks.add(text.length);

      ranges[i] = [text.length, text.length + str.length];
      text += str;
      if (item.hasEOL && !softHyphenCandidate(text)) text += ' ';

      // Track the largest text on the page as a heading candidate.
      if (median && h >= median * 1.25 && str.trim().length > 1) {
        if (h > headingSize * 1.05) { headingSize = h; headingParts = [str.trim()]; }
        else if (Math.abs(h - headingSize) / headingSize < 0.05) headingParts.push(str.trim());
      }

      prev = item;
      prevH = h;
    });

    const heading = headingParts.join(' ').replace(/\s+/g, ' ').trim();
    return { text, ranges, breaks, softHyphens, heading: heading.length <= 120 ? heading : '' };
  }

  // Keep "infor-" glued to the next line so it can become "information".
  function softHyphenCandidate(text) {
    return /[A-Za-z]-$/.test(text);
  }

  function isAbbreviation(text, start, dotIdx) {
    const before = text.slice(start, dotIdx);
    const m = before.match(/([A-Za-z.]+)$/);
    if (!m) return false;
    const word = m[1].toLowerCase().replace(/^\.+/, '');
    if (ABBREVIATIONS.has(word)) return true;
    if (/^[a-z]$/i.test(word) && /[A-Z]/.test(m[1])) return true; // initials like "A."
    if (/^([a-z]\.)+[a-z]$/i.test(word)) return true;            // "U.S", "e.g"
    return false;
  }

  /** Split page text into sentence ranges [{start, end}]. */
  function splitSentences(text, breaks) {
    const raw = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (breaks.has(i) && i > start) { raw.push([start, i]); start = i; }
      const ch = text[i];
      if (!END_PUNCT.includes(ch)) continue;
      let j = i + 1;
      while (j < text.length && (END_PUNCT.includes(text[j]) || CLOSERS.includes(text[j]))) j++;
      if (j < text.length && !/\s/.test(text[j])) continue;
      if (ch === '.' && isAbbreviation(text, start, i)) continue;
      raw.push([start, j]);
      start = j;
      i = j - 1;
    }
    if (start < text.length) raw.push([start, text.length]);

    const trimmed = [];
    for (const [s, e] of raw) {
      let a = s, b = e;
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b <= a) continue;
      const piece = text.slice(a, b);
      // Pieces without letters (page numbers, "1.", "•") are glued onto the next sentence.
      if (!/\p{L}/u.test(piece)) {
        trimmed.push({ start: a, end: b, glue: true });
        continue;
      }
      trimmed.push({ start: a, end: b });
    }

    const merged = [];
    let pending = null;
    for (const s of trimmed) {
      if (s.glue) { if (!pending) pending = { start: s.start, end: s.end }; else pending.end = s.end; continue; }
      if (pending) { s.start = pending.start; pending = null; }
      merged.push({ start: s.start, end: s.end });
    }
    if (pending && merged.length) merged[merged.length - 1].end = pending.end;

    const out = [];
    for (const s of merged) splitLong(text, s.start, s.end, out);
    return out;
  }

  // Long sentences are split at a comma/semicolon so speech stays natural and translation stays accurate.
  function splitLong(text, start, end, out) {
    if (end - start <= MAX_SENTENCE) { out.push({ start, end }); return; }
    const mid = start + Math.floor((end - start) / 2);
    let best = -1;
    let bestDist = Infinity;
    const re = /[;,:–—)]\s|\s(and|but|which|because|while|whereas|or)\s/g;
    const slice = text.slice(start, end);
    let m;
    while ((m = re.exec(slice))) {
      const pos = start + m.index + (m[0][0] === ' ' ? 1 : m[0].length - 1);
      if (pos - start < 50 || end - pos < 30) continue;
      const d = Math.abs(pos - mid);
      if (d < bestDist) { bestDist = d; best = pos; }
    }
    if (best < 0) {
      best = text.lastIndexOf(' ', start + MAX_SENTENCE);
      if (best <= start) { out.push({ start, end }); return; }
    }
    let b = best;
    while (b > start && /\s/.test(text[b - 1])) b--;
    let a = best;
    while (a < end && /\s/.test(text[a])) a++;
    splitLong(text, start, b, out);
    splitLong(text, a, end, out);
  }

  /** Text between two offsets with end-of-line hyphens removed and whitespace collapsed. */
  function plainText(page, start, end) {
    let s = '';
    for (let i = start; i < end; i++) {
      if (page.softHyphens.has(i)) continue;
      s += page.text[i];
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  /** Make text pleasant to listen to. */
  function forSpeech(str, lang) {
    let s = str
      .replace(/https?:\/\/\S+|www\.\S+/gi, lang === 'hi' ? ' ' : ' link ')
      .replace(/\S+@\S+\.\w+/g, ' ')
      .replace(/\[\d+(?:[,–-]\s*\d+)*\]/g, '')   // citation markers [12], [3-5]
      .replace(/[•▪◦●■□➢►✓✔·]/g, ' ')
      .replace(/\.{3,}|…{2,}|_{3,}|-{3,}/g, ' ')    // table-of-contents leaders
      .replace(/\be\.g\./gi, 'for example,')
      .replace(/\bi\.e\./gi, 'that is,')
      .replace(/\betc\./gi, 'etcetera.')
      .replace(/\s+/g, ' ')
      .trim();
    if (lang !== 'hi') s = s.replace(/\s&\s/g, ' and ');
    return s;
  }

  return { buildPage, splitSentences, plainText, forSpeech, itemHeight };
})();

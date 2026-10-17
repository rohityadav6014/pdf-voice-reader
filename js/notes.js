/* Page-by-page study notes built locally from the PDF text (no data leaves the browser). */
const Notes = (() => {
  const STOP = new Set(`a about above after again against all also am an and any are as at be because been before being
    below between both but by can could did do does doing down during each few for from further had has have having he
    her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not
    now of off on once only or other our ours ourselves out over own same she should so some such than that the their
    theirs them themselves then there these they this those through to too under until up upon very was we were what
    when where which while who whom why will with would you your yours yourself yourselves may might must shall one two
    three also however thus therefore hence page figure fig table et al use used using within without among like well
    get got make made many much new first second via per etc even still yet since whether either neither every another
    let us often usually including include includes based given see shown show shows called able`.split(/\s+/));

  const DEFINITION_RE = /\b(is defined as|are defined as|refers to|refer to|is known as|are known as|is called|are called|means|is the process|is a|is an|are the)\b/i;

  function words(text) {
    return (text.toLowerCase().match(/[\p{L}][\p{L}\p{N}'-]*/gu) || [])
      .map(w => w.replace(/^'+|'+$/g, ''))
      .filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  }

  function tidy(s, max = 260) {
    s = s.replace(/^[\s\-–—•·*\d.)]+(?=\p{L})/u, '').trim();
    if (s.length > max) {
      const cut = s.lastIndexOf(' ', max);
      s = s.slice(0, cut > 80 ? cut : max).replace(/[,;:]$/, '') + '…';
    }
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /**
   * pages: [{ num, heading, sentences: [string] }]
   * returns [{ page, title, points[], definitions[], empty }]
   */
  function generate(pages) {
    // Document-wide frequencies so very common words don't dominate every page.
    const docFreq = new Map();
    pages.forEach(p => {
      new Set(words(p.sentences.join(' '))).forEach(w => docFreq.set(w, (docFreq.get(w) || 0) + 1));
    });
    const N = Math.max(pages.length, 1);

    return pages.map(p => {
      const sents = p.sentences.filter(s => (s.match(/\p{L}+/gu) || []).length >= 3);
      if (!sents.length) {
        return { page: p.num, title: p.heading || `Page ${p.num}`, points: [], definitions: [], empty: true };
      }

      const tf = new Map();
      words(sents.join(' ')).forEach(w => tf.set(w, (tf.get(w) || 0) + 1));
      const weight = w => (tf.get(w) || 0) * Math.log(1 + N / (docFreq.get(w) || 1));

      const scored = sents.map((s, i) => {
        const ws = words(s);
        if (!ws.length) return { s, i, score: 0 };
        let score = ws.reduce((a, w) => a + weight(w), 0) / Math.sqrt(ws.length);
        if (i < 2) score *= 1.2;                       // opening lines usually set the topic
        if (/\d/.test(s)) score *= 1.1;                // facts & figures
        if (DEFINITION_RE.test(s)) score *= 1.25;
        if (s.length < 40) score *= 0.6;
        return { s, i, score };
      });

      const definitions = sents
        .filter(s => DEFINITION_RE.test(s) && s.length < 260 && s.length > 30)
        .slice(0, 3);

      const k = Math.min(6, Math.max(2, Math.round(sents.length * 0.3)));
      const points = scored
        .filter(x => !definitions.includes(x.s))
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .sort((a, b) => a.i - b.i)
        .map(x => tidy(x.s));

      let title = p.heading;
      if (!title) {
        const first = sents[0];
        title = first.length <= 70 && !/[.!?]$/.test(first) ? first : `Page ${p.num}`;
      }

      return { page: p.num, title: tidy(title, 100), points, definitions: definitions.map(d => tidy(d)), empty: false };
    });
  }

  /* ---------- Export helpers ---------- */
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function labels(lang) {
    return lang === 'hi'
      ? { page: 'पृष्ठ', points: 'मुख्य बिंदु', defs: 'परिभाषाएँ', empty: 'इस पृष्ठ पर पढ़ने योग्य टेक्स्ट नहीं है।', notes: 'नोट्स' }
      : { page: 'Page', points: 'Key points', defs: 'Definitions', empty: 'No readable text on this page.', notes: 'Notes' };
  }

  function toText(notes, docName, lang) {
    const L = labels(lang);
    const lines = [`${L.notes}: ${docName}`, '='.repeat(40), ''];
    notes.forEach(n => {
      lines.push(`${L.page} ${n.page} — ${n.title}`);
      lines.push('-'.repeat(40));
      if (n.empty) lines.push(L.empty);
      if (n.definitions.length) { lines.push(`${L.defs}:`); n.definitions.forEach(d => lines.push(`  • ${d}`)); }
      if (n.points.length) { lines.push(`${L.points}:`); n.points.forEach(d => lines.push(`  • ${d}`)); }
      lines.push('');
    });
    return lines.join('\r\n');
  }

  function sectionHtml(n, lang) {
    const L = labels(lang);
    const cls = lang === 'hi' ? ' class="hi"' : '';
    let h = `<section${cls}><h2>${L.page} ${n.page} — ${esc(n.title)}</h2>`;
    if (n.empty) h += `<p>${L.empty}</p>`;
    if (n.definitions.length) h += `<h3>${L.defs}</h3><ul>${n.definitions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`;
    if (n.points.length) h += `<h3>${L.points}</h3><ul>${n.points.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`;
    return h + '</section>';
  }

  function toHtmlBody(notes, docName, lang) {
    return `<h1>${labels(lang).notes}: ${esc(docName)}</h1>` + notes.map(n => sectionHtml(n, lang)).join('');
  }

  function toWordDoc(notes, docName, lang) {
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset="utf-8"><title>${esc(docName)} notes</title>
<style>
  body{font-family:Calibri,"Nirmala UI","Mangal",sans-serif;font-size:11pt;line-height:1.4}
  h1{font-size:20pt;color:#4b2fd1} h2{font-size:14pt;color:#222;border-bottom:1px solid #ccc;padding-bottom:3pt;margin-top:18pt}
  h3{font-size:10pt;color:#666;text-transform:uppercase;margin:8pt 0 2pt} li{margin:2pt 0}
</style></head><body>${toHtmlBody(notes, docName, lang)}</body></html>`;
  }

  return { generate, toText, toWordDoc, toHtmlBody, labels, esc };
})();

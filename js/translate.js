/* English → Hindi translation (Google Translate web endpoint), batched and cached. */
const Translator = (() => {
  const cache = new Map();
  const MAX_CHUNK = 1500;

  async function translateChunk(text, target) {
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
      encodeURIComponent(target) + '&dt=t&q=' + encodeURIComponent(text);
    let res;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new Error('Could not reach the translation service. Check your internet connection.');
    }
    if (!res.ok) throw new Error(`Translation service error (${res.status}). Please try again in a moment.`);
    const data = await res.json();
    return (data[0] || []).map(seg => seg[0] || '').join('');
  }

  /** Translate many short strings, keeping their order. */
  async function translateMany(texts, target = 'hi') {
    const result = new Array(texts.length);
    const todo = [];
    texts.forEach((t, i) => {
      const key = target + '|' + t;
      if (!t || !t.trim()) result[i] = t;
      else if (cache.has(key)) result[i] = cache.get(key);
      else todo.push(i);
    });

    let batch = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const current = batch;
      batch = [];
      size = 0;
      const joined = current.map(i => texts[i].replace(/\n/g, ' ')).join('\n');
      let parts = (await translateChunk(joined, target)).split('\n');
      if (parts.length !== current.length) {
        // Line structure got lost; fall back to one request per string.
        parts = await Promise.all(current.map(i => translateChunk(texts[i], target)));
      }
      current.forEach((i, k) => {
        result[i] = (parts[k] || '').trim();
        cache.set(target + '|' + texts[i], result[i]);
      });
    };

    for (const i of todo) {
      if (size + texts[i].length > MAX_CHUNK) await flush();
      batch.push(i);
      size += texts[i].length + 1;
    }
    await flush();
    return result;
  }

  return { translateMany };
})();

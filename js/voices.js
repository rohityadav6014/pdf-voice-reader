/* Finds the device's speech voices and ranks clear female voices first. */
const Voices = (() => {
  let all = [];

  const FEMALE = ['female', 'woman', 'zira', 'heera', 'neerja', 'swara', 'kalpana', 'aria', 'jenny', 'sonia', 'libby',
    'emma', 'ava', 'ana', 'samantha', 'veena', 'lekha', 'karen', 'moira', 'tessa', 'fiona', 'susan', 'hazel', 'catherine',
    'michelle', 'natasha', 'clara', 'salli', 'joanna', 'kendra', 'kimberly', 'ivy', 'aditi', 'raveena', 'kajal', 'priya',
    'ananya', 'kavya', 'sara', 'linda', 'eva', 'elsa', 'isabella', 'jessa', 'nancy', 'allison', 'serena', 'victoria',
    'google हिन्दी', 'google us english', 'google uk english female', 'हिन्दी'];
  const MALE = ['male', 'man', 'david', 'mark', 'ravi', 'hemant', 'prabhat', 'madhur', 'guy', 'ryan', 'george', 'daniel',
    'rishi', 'james', 'alex', 'fred', 'thomas', 'william', 'christopher', 'eric', 'roger', 'steffan', 'brian', 'arnav',
    'kunal', 'aarav', 'richard', 'sean', 'aaron', 'oliver', 'tom', 'arthur', 'gordon', 'lee', 'rocko', 'reed', 'eddy'];

  function load() {
    return new Promise(resolve => {
      if (!('speechSynthesis' in window)) { resolve([]); return; }
      const done = () => { all = speechSynthesis.getVoices(); resolve(all); };
      const now = speechSynthesis.getVoices();
      if (now.length) { all = now; resolve(all); return; }
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 3000);
    });
  }

  function refresh() { if ('speechSynthesis' in window) all = speechSynthesis.getVoices(); return all; }

  function gender(v) {
    const n = v.name.toLowerCase();
    if (/female|woman/.test(n)) return 'female';
    if (MALE.some(m => new RegExp(`(^|[^a-z])${m}([^a-z]|$)`).test(n))) return 'male';
    if (FEMALE.some(f => n.includes(f))) return 'female';
    return 'unknown';
  }

  const norm = lang => (lang || '').toLowerCase().replace('_', '-');

  function score(v, lang) {
    const g = gender(v);
    let s = g === 'female' ? 100 : g === 'unknown' ? 40 : 0;
    const n = v.name.toLowerCase();
    if (/natural|neural|online|enhanced|premium/.test(n)) s += 30;      // smoother, more human voices
    const l = norm(v.lang);
    if (lang === 'en') {
      if (l === 'en-in') s += 15;
      else if (l === 'en-us' || l === 'en-gb') s += 10;
    }
    if (n.includes('google')) s += 8;
    return s;
  }

  /** Voices for a language ('en' | 'hi'), best female voice first. */
  function forLang(lang) {
    return all
      .filter(v => norm(v.lang).startsWith(lang))
      .map(v => ({ voice: v, gender: gender(v), score: score(v, lang) }))
      .sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name));
  }

  return { load, refresh, forLang, gender };
})();

/*
 * Estimates how long the rest of the PDF will take to read aloud.
 * Starts from typical speaking speeds and then learns the real speed of the voice in use,
 * so the estimate follows skips (less text left), the speed setting and the language.
 */
const Timing = (() => {
  // Seconds per character of the (English) source text at 1× speed.
  const DEFAULTS = { en: 1 / 14.5, hi: 1 / 11 };
  const GAP = 0.3;          // pause between sentences, in seconds
  const KEY = 'pdfreader.timing';
  let perChar = { ...DEFAULTS };

  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) ['en', 'hi'].forEach(l => { if (saved[l] > 0.02 && saved[l] < 0.25) perChar[l] = saved[l]; });
  } catch { /* storage unavailable */ }

  /** Feed one finished sentence: how many source characters took how long at what speed. */
  function learn(lang, chars, seconds, rate) {
    if (chars < 25 || seconds < 0.5) return;
    const v = (seconds * rate) / chars;
    if (v < 0.02 || v > 0.25) return; // ignore glitches (voice cut off, stalled, etc.)
    perChar[lang] = perChar[lang] * 0.75 + v * 0.25;
    try { localStorage.setItem(KEY, JSON.stringify(perChar)); } catch { /* ignore */ }
  }

  /** Seconds to speak `chars` characters spread over `count` sentences. */
  function secondsFor(chars, count, lang, rate) {
    return (chars * perChar[lang]) / rate + count * GAP;
  }

  /** Seconds left from sentence `from` (optionally skipping the first `fromChar` characters of it). */
  function remaining(sentences, from, lang, rate, fromChar = 0) {
    let chars = -fromChar;
    for (let i = Math.max(from, 0); i < sentences.length; i++) chars += sentences[i].text.length;
    return secondsFor(Math.max(chars, 0), Math.max(sentences.length - from, 0), lang, rate);
  }

  function total(sentences, lang, rate) { return remaining(sentences, 0, lang, rate); }

  /** "4:05", "1:02:30" */
  function clock(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }

  /** "45 sec", "12 min", "1 h 05 min" */
  function words(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return `${sec} sec`;
    const m = Math.round(sec / 60);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  }

  /** Wall-clock time when reading would finish, e.g. "3:45 PM". */
  function finishAt(sec) {
    return new Date(Date.now() + sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  return { learn, remaining, total, secondsFor, clock, words, finishAt };
})();

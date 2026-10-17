/* Sentence-by-sentence text-to-speech player (English or Hindi). */
const Reader = (() => {
  let sentences = [];      // { page, start, end, text, hi? }
  let idx = 0;
  let playing = false;
  let lang = 'en';
  let rate = 1;
  const voice = { en: null, hi: null };
  let token = 0;
  let utterance = null;    // keep a reference: Chrome drops events of garbage-collected utterances
  let keepAlive = null;
  let quickEnds = 0;
  const hindiJobs = new Map();
  const handlers = {};

  const on = (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); };
  const emit = (evt, data) => (handlers[evt] || []).forEach(fn => fn(data));

  function load(list) {
    stop();
    sentences = list;
    idx = 0;
    hindiJobs.clear();
    emit('position', { idx, sentence: sentences[0] });
  }

  /* ---------- Hindi ---------- */
  function translatePage(page) {
    if (hindiJobs.has(page)) return hindiJobs.get(page);
    const targets = sentences.filter(s => s.page === page && !s.hi);
    const job = Translator.translateMany(targets.map(s => s.text), 'hi')
      .then(res => { targets.forEach((s, k) => { s.hi = res[k]; }); })
      .catch(err => { hindiJobs.delete(page); throw err; });
    hindiJobs.set(page, job);
    return job;
  }

  async function hindiFor(i) {
    const s = sentences[i];
    if (!s.hi) await translatePage(s.page);
    // Warm up the next page so playback doesn't pause at page turns.
    const nextPage = sentences.find(x => x.page > s.page);
    if (nextPage) translatePage(nextPage.page).catch(() => {});
    return s.hi;
  }

  /* ---------- Speaking ---------- */
  async function speak(i, fromChar = 0) {
    const my = ++token;
    speechSynthesis.cancel();
    clearInterval(keepAlive);
    if (!sentences.length) return;
    idx = Math.max(0, Math.min(i, sentences.length - 1));
    const s = sentences[idx];
    emit('position', { idx, sentence: s, fromChar });

    let text;
    if (lang === 'hi') {
      emit('busy', true);
      try {
        text = await hindiFor(idx);
      } catch (err) {
        if (my !== token) return;
        emit('busy', false);
        emit('error', err.message);
        pause();
        return;
      }
      if (my !== token) return;
      emit('busy', false);
      emit('hindi', { idx, text });
    } else {
      text = fromChar > 0 ? s.text.slice(fromChar) : s.text;
    }
    text = TextUtils.forSpeech(text || '', lang);

    if (!text) { advance(my); return; }

    // A short gap after cancel() avoids Chrome swallowing the next utterance.
    setTimeout(() => {
      if (my !== token || !playing) return;
      const u = new SpeechSynthesisUtterance(text);
      const v = voice[lang];
      if (v) u.voice = v;
      u.lang = v ? v.lang : lang === 'hi' ? 'hi-IN' : 'en-IN';
      u.rate = rate;
      u.pitch = 1.05;
      u.volume = 1; // the voice stays at full volume; background music sits underneath
      const t0 = performance.now();
      // Timing is measured against the English source text, whatever language is spoken.
      const srcChars = lang === 'hi' ? s.text.length : s.text.length - fromChar;
      let startedAt = 0;
      const markStart = () => {
        startedAt = performance.now();
        emit('speaking', { idx, chars: srcChars, at: startedAt });
      };
      // Some voices never fire onstart, so the time speech was requested is used until (if) it does.
      u.onstart = markStart;
      const finished = failed => {
        if (my !== token) return;
        if (!failed && startedAt) {
          emit('spoken', { lang, chars: srcChars, seconds: (performance.now() - startedAt) / 1000, rate });
        }
        // A voice that can't speak this language "finishes" instantly; stop instead of racing through the PDF.
        if (failed || (text.length > 25 && performance.now() - t0 < text.length * 20)) quickEnds++;
        else quickEnds = 0;
        if (quickEnds >= 2) {
          quickEnds = 0;
          emit('error', lang === 'hi'
            ? 'Your device has no working Hindi voice. Open this site in Microsoft Edge or Google Chrome, or add Hindi in Windows Settings → Time & language → Speech.'
            : 'The selected voice is not speaking. Please pick another voice from the list.');
          pause();
          return;
        }
        advance(my);
      };
      u.onend = () => finished(false);
      u.onerror = e => {
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        finished(true);
      };
      utterance = u;
      speechSynthesis.speak(u);
      markStart();

      // Chrome's online voices stop after ~15 s of continuous speech; nudging keeps them going.
      if (v && /google/i.test(v.name)) {
        keepAlive = setInterval(() => {
          if (my !== token || !speechSynthesis.speaking) { clearInterval(keepAlive); return; }
          speechSynthesis.pause();
          speechSynthesis.resume();
        }, 10000);
      }
    }, 60);
  }

  function advance(my) {
    if (my !== token || !playing) return;
    clearInterval(keepAlive);
    if (idx < sentences.length - 1) speak(idx + 1);
    else { playing = false; token++; emit('state', { playing }); emit('finished'); }
  }

  /* ---------- Controls ---------- */
  function play() {
    if (!sentences.length) return;
    playing = true;
    emit('state', { playing });
    speak(idx);
  }

  function pause() {
    playing = false;
    token++;
    clearInterval(keepAlive);
    speechSynthesis.cancel();
    emit('state', { playing });
  }

  function stop() {
    pause();
    emit('stopped');
  }

  function toggle() { playing ? pause() : play(); }

  function goTo(i, fromChar = 0) {
    if (!sentences.length) return;
    i = Math.max(0, Math.min(i, sentences.length - 1));
    if (playing) speak(i, fromChar);
    else { idx = i; emit('position', { idx, sentence: sentences[idx], fromChar }); }
  }

  /** Start playing from a sentence (used by double-click). */
  function startAt(i, fromChar = 0) {
    playing = true;
    emit('state', { playing });
    speak(i, lang === 'hi' ? 0 : fromChar);
  }

  const nextSentence = () => goTo(idx + 1);
  const prevSentence = () => goTo(idx - 1);

  function nextPage() {
    const cur = sentences[idx]?.page ?? 0;
    const i = sentences.findIndex(s => s.page > cur);
    if (i >= 0) goTo(i);
  }

  function prevPage() {
    const cur = sentences[idx]?.page ?? 0;
    let prev = -1;
    for (let k = idx - 1; k >= 0; k--) { if (sentences[k].page < cur) { prev = sentences[k].page; break; } }
    if (prev < 0) { goTo(0); return; }
    goTo(sentences.findIndex(s => s.page === prev));
  }

  function restartIfPlaying() { if (playing) speak(idx); }

  function setLang(l) { lang = l; restartIfPlaying(); }
  function setRate(r) { rate = r; restartIfPlaying(); }
  function setVoice(l, v) { voice[l] = v; if (l === lang) restartIfPlaying(); }

  return {
    on, load, play, pause, stop, toggle, goTo, startAt,
    nextSentence, prevSentence, nextPage, prevPage,
    setLang, setRate, setVoice, translatePage,
    get index() { return idx; },
    get playing() { return playing; },
    get lang() { return lang; },
    get sentences() { return sentences; },
  };
})();

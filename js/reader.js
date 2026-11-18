/*
 * Sentence-by-sentence text-to-speech player (English or Hindi).
 * The next sentence is queued while the current one is spoken, so the device's speech engine
 * (especially on phones) flows from sentence to sentence without stopping and restarting.
 */
const Reader = (() => {
  let sentences = [];      // { page, start, end, text, hi? }
  let idx = 0;
  let playing = false;
  let lang = 'en';
  let rate = 1;
  const voice = { en: null, hi: null };
  let token = 0;           // bumps on every jump/pause; events from older utterances are ignored
  let current = null;      // utterance being spoken: { i, u, text, srcChars, started, t0, realStart }
  let queued = null;       // the next sentence, already handed to the speech engine
  let keepAlive = null;
  let quickEnds = 0;
  let translating = false;
  let lastActivity = 0;    // last time speech was requested, started or ended (for the stall check)
  const hindiJobs = new Map();
  const handlers = {};
  const mobile = Voices.isMobile;

  const on = (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); };
  const emit = (evt, data) => (handlers[evt] || []).forEach(fn => fn(data));
  const touch = () => { lastActivity = performance.now(); };

  const NO_HINDI_VOICE = Voices.isAndroid
    ? 'Your phone has no Hindi voice yet. Open Settings → search "Text-to-speech" → Speech Services by Google → Install voice data → Hindi.'
    : Voices.isIOS
      ? 'Your iPhone has no Hindi voice yet. Open Settings → Accessibility → Spoken Content → Voices → Hindi and download a voice (e.g. Lekha).'
      : 'Your device has no working Hindi voice. Open this site in Microsoft Edge or Google Chrome, or add Hindi in Windows Settings → Time & language → Speech.';

  /* ---------- Phones: use the built-in speech engine reliably ---------- */
  // iPhone/iPad only allow speech that starts from a tap. Speaking a silent, empty sentence during the
  // first tap "unlocks" the phone's speech engine so later sentences (started after a delay) are heard.
  let unlocked = false;
  function unlock() {
    if (unlocked || !('speechSynthesis' in window)) return;
    unlocked = true;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* older Safari */ }
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  // Phone speech engines sometimes stop without telling the page (screen off, app switch, engine hiccup).
  // Judged by time, not by speechSynthesis.speaking (which phones often report wrongly):
  // if a sentence runs far longer than it should, or nothing is in progress at all, pick it up again.
  // How long a sentence should take, from the voice speed learned on this device (see timing.js).
  const expectedMs = item => (typeof Timing !== 'undefined'
    ? Timing.secondsFor(item.srcChars, 1, lang, rate) * 1000
    : (item.text.length * 80) / rate);
  setInterval(() => {
    if (!playing || translating) return;
    const now = performance.now();
    if (current) {
      const since = now - Math.max(current.t0 || 0, lastActivity);
      if (since < expectedMs(current) * 1.3 + 3000) return;
    } else if (now - lastActivity < 6000) {
      return;
    }
    speak(idx);
  }, 2000);

  /* ---------- Lock screen / notification / headphone controls ---------- */
  // Shown by the phone while a media element plays (e.g. background music).
  const media = 'mediaSession' in navigator ? navigator.mediaSession : null;
  if (media) {
    const handle = (action, fn) => { try { media.setActionHandler(action, fn); } catch { /* unsupported action */ } };
    handle('play', () => play());
    handle('pause', () => pause());
    handle('stop', () => stop());
    handle('nexttrack', () => nextSentence());
    handle('previoustrack', () => prevSentence());
    handle('seekforward', () => nextPage());
    handle('seekbackward', () => prevPage());
  }
  function setTitle(title) {
    if (!media || typeof MediaMetadata === 'undefined') return;
    media.metadata = new MediaMetadata({
      title: title || 'Sunotes',
      artist: 'Sunotes · read aloud',
      artwork: [{ src: 'assets/logo.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
  }
  on('state', ({ playing: p }) => { if (media) media.playbackState = p ? 'playing' : 'paused'; });

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

  /** Speakable text for a sentence if it's ready right now (Hindi needs its translation), else null. */
  function readyText(i, fromChar = 0) {
    const s = sentences[i];
    if (!s) return null;
    if (lang === 'hi') return s.hi ? TextUtils.forSpeech(s.hi, 'hi') : null;
    return TextUtils.forSpeech(fromChar > 0 ? s.text.slice(fromChar) : s.text, 'en');
  }

  /* ---------- Speaking ---------- */
  /**
   * Start speaking from sentence i. `natural` means the previous sentence just ended on its own:
   * then the engine is not interrupted, which avoids a restart pause on phones.
   */
  async function speak(i, fromChar = 0, natural = false) {
    const my = ++token;
    touch();
    if (!natural) speechSynthesis.cancel();
    clearInterval(keepAlive);
    current = queued = null;
    if (!sentences.length) return;
    idx = Math.max(0, Math.min(i, sentences.length - 1));
    emit('position', { idx, sentence: sentences[idx], fromChar });

    let text = readyText(idx, fromChar);
    if (text === null) { // Hindi translation not ready yet
      emit('busy', true);
      translating = true;
      try {
        await hindiFor(idx);
      } catch (err) {
        translating = false;
        if (my !== token) return;
        emit('busy', false);
        emit('error', err.message);
        pause();
        return;
      }
      translating = false;
      touch();
      if (my !== token) return;
      emit('busy', false);
      text = readyText(idx) || '';
    }
    if (lang === 'hi') emit('hindi', { idx, text: sentences[idx].hi });
    if (!text) { advance(my); return; }

    const go = () => {
      if (my !== token || !playing) return;
      current = enqueue(idx, text, fromChar, my);
      activate(current, my, false);
      startKeepAlive(my);
    };
    // After an interruption a short gap avoids Chrome swallowing the next utterance.
    if (natural) go(); else setTimeout(go, 60);
  }

  /** Hand one sentence to the speech engine. */
  function enqueue(i, text, fromChar, my) {
    const u = new SpeechSynthesisUtterance(text);
    const v = voice[lang];
    if (v) u.voice = v;
    u.lang = v ? v.lang : lang === 'hi' ? 'hi-IN' : 'en-IN';
    u.rate = rate;
    u.pitch = 1.05;
    u.volume = 1; // the voice stays at full volume; background music sits underneath
    const s = sentences[i];
    // Timing is measured against the English source text, whatever language is spoken.
    const item = { i, u, text, srcChars: lang === 'hi' ? s.text.length : s.text.length - fromChar, started: false, t0: 0, realStart: false };
    u.onstart = () => activate(item, my, true);
    u.onend = () => done(item, my, false);
    u.onerror = e => {
      if (e.error === 'interrupted' || e.error === 'canceled') {
        // Our own jumps/pauses bump the token first, so this is something else cutting the voice off
        // (a notification, another app). Pick the sentence up again shortly.
        if (my === token && playing && item === current) {
          setTimeout(() => { if (my === token && playing) speak(idx); }, 1500);
        }
        return;
      }
      done(item, my, true);
    };
    speechSynthesis.speak(u);
    return item;
  }

  /** A sentence has started (onstart), or is assumed to have (some voices never fire onstart). */
  function activate(item, my, real) {
    if (my !== token) return;
    touch();
    if (item === queued) { current = item; queued = null; } // the queued sentence took over
    if (item.i !== idx) {
      idx = item.i;
      emit('position', { idx, sentence: sentences[idx], fromChar: 0 });
      if (lang === 'hi') emit('hindi', { idx, text: sentences[idx].hi });
    }
    if (!item.started || (real && !item.realStart)) {
      item.started = true;
      item.realStart = item.realStart || real;
      item.t0 = performance.now();
      emit('speaking', { idx: item.i, chars: item.srcChars, at: item.t0 });
    }
    queueNext(item, my);
  }

  /** Queue the following sentence while this one plays, so there's no gap between them. */
  function queueNext(item, my) {
    if (my !== token || queued || item !== current) return;
    const next = item.i + 1;
    if (next >= sentences.length) return;
    if (lang === 'hi') {
      const s = sentences[item.i];
      const nextPage = sentences.find(x => x.page > s.page);
      if (!sentences[next].hi) translatePage(sentences[next].page).catch(() => {});
      else if (nextPage) translatePage(nextPage.page).catch(() => {});
    }
    const text = readyText(next);
    if (text) queued = enqueue(next, text, 0, my);
  }

  function done(item, my, failed) {
    if (my !== token) return;
    touch();
    if (!failed && item.started) {
      emit('spoken', { lang, chars: item.srcChars, seconds: (performance.now() - item.t0) / 1000, rate });
    }
    // A voice that can't speak this language "finishes" instantly; stop instead of racing through the file.
    if (failed || (item.started && item.text.length > 25 && performance.now() - item.t0 < item.text.length * 20)) quickEnds++;
    else quickEnds = 0;
    if (quickEnds >= 2) {
      quickEnds = 0;
      emit('error', lang === 'hi' ? NO_HINDI_VOICE : 'The selected voice is not speaking. Please pick another voice from the list.');
      pause();
      return;
    }
    if (item !== current) return; // the next sentence already took over
    if (queued && queued.i === item.i + 1) {
      activate(queued, my, false); // it's already in the engine; make it current now
      return;
    }
    advance(my);
  }

  function advance(my) {
    if (my !== token || !playing) return;
    if (idx < sentences.length - 1) speak(idx + 1, 0, true);
    else { playing = false; token++; current = queued = null; clearInterval(keepAlive); emit('state', { playing }); emit('finished'); }
  }

  // Desktop Chrome's online voices stop after ~15 s of continuous speech; nudging keeps them going.
  // Not on phones: there pause() can stop the built-in engine for good.
  function startKeepAlive(my) {
    clearInterval(keepAlive);
    const v = voice[lang];
    if (mobile || !v || !/google/i.test(v.name)) return;
    keepAlive = setInterval(() => {
      if (my !== token || !speechSynthesis.speaking) { clearInterval(keepAlive); return; }
      speechSynthesis.pause();
      speechSynthesis.resume();
    }, 10000);
  }

  /* ---------- Controls ---------- */
  function play() {
    if (!sentences.length) return;
    unlock();
    playing = true;
    emit('state', { playing });
    speak(idx);
  }

  function pause() {
    playing = false;
    token++;
    current = queued = null;
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
    unlock();
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
    setLang, setRate, setVoice, translatePage, unlock, setTitle,
    get index() { return idx; },
    get playing() { return playing; },
    get lang() { return lang; },
    get sentences() { return sentences; },
  };
})();

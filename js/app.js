/* Wires upload, viewer, reader and notes together. */
(() => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const $ = id => document.getElementById(id);
  const ui = {
    upload: $('uploadScreen'), loading: $('loadingScreen'), reader: $('readerScreen'), player: $('player'),
    loadingText: $('loadingText'), loadingBar: $('loadingBar'), fileName: $('fileName'), changeFile: $('changeFileBtn'),
    viewer: $('viewer'), voiceSelect: $('voiceSelect'), voiceHint: $('voiceHint'), rate: $('rateSelect'),
    follow: $('followToggle'), posLabel: $('posLabel'), nowText: $('nowText'), nowTextHi: $('nowTextHi'),
    play: $('playBtn'), seek: $('seek'), seekLabel: $('seekLabel'), notesList: $('notesList'),
    notesStatus: $('notesStatus'), toast: $('toast'), printArea: $('printArea'), zoomLabel: $('zoomLabel'),
  };

  const state = {
    docName: '',
    pages: [],          // { num, width, height, items, styles, text, ranges, softHyphens, heading, first, last }
    notes: { en: [], hi: null },
    notesLang: 'en',
    currentPage: -1,
  };

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg, ms = 4000) {
    ui.toast.textContent = msg;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, ms);
  }

  /* ---------- Upload ---------- */
  function show(screen) {
    ui.upload.hidden = screen !== 'upload';
    ui.loading.hidden = screen !== 'loading';
    ui.reader.hidden = screen !== 'reader';
    ui.player.hidden = screen !== 'reader';
    ui.changeFile.hidden = screen !== 'reader';
  }

  const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  function pickFile(file) {
    if (!file) return;
    const name = file.name || '';
    if (file.type === 'application/pdf' || /\.pdf$/i.test(name)) {
      file.arrayBuffer().then(buf => openPdf(buf, name));
    } else if (file.type === DOCX_TYPE || /\.docx$/i.test(name)) {
      file.arrayBuffer().then(buf => openDocx(buf, name));
    } else if (/\.doc$/i.test(name) || file.type === 'application/msword') {
      toast('Old .doc files aren\'t supported. In Word, use File → Save As → Word Document (.docx), then upload that.', 8000);
    } else {
      toast('Please choose a PDF or Word (.docx) file.');
    }
  }

  $('fileInput').addEventListener('change', e => { pickFile(e.target.files[0]); e.target.value = ''; });
  $('fileInputTop').addEventListener('change', e => { pickFile(e.target.files[0]); e.target.value = ''; });

  const drop = $('dropZone');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', e => pickFile(e.dataTransfer.files[0]));
  drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') $('fileInput').click(); });
  // Dropping a file anywhere else shouldn't navigate away.
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  /* ---------- Load & analyse PDF ---------- */
  async function openPdf(buffer, name) {
    Reader.stop();
    show('loading');
    ui.loadingText.textContent = 'Opening your PDF…';
    ui.loadingBar.style.width = '0%';
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    } catch (err) {
      show('upload');
      toast(err && err.name === 'PasswordException'
        ? 'This PDF is password-protected. Please remove the password and try again.'
        : 'Could not open this PDF. The file may be damaged.');
      return;
    }

    state.mode = 'pdf';
    state.docName = name.replace(/\.pdf$/i, '');
    ui.fileName.textContent = name;
    state.pages = [];
    state.notes = { en: [], hi: null };
    state.currentPage = -1;
    const sentences = [];

    for (let n = 1; n <= pdf.numPages; n++) {
      ui.loadingText.textContent = `Reading page ${n} of ${pdf.numPages}…`;
      ui.loadingBar.style.width = `${(n / pdf.numPages) * 100}%`;
      const page = await pdf.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const built = TextUtils.buildPage(content.items);
      const p = {
        num: n, width: vp.width, height: vp.height,
        items: content.items, styles: content.styles,
        ...built, first: sentences.length, last: sentences.length - 1,
      };

      // Sentences + which text items each one covers (for highlighting).
      const ranges = TextUtils.splitSentences(built.text, built.breaks);
      for (const r of ranges) {
        const text = TextUtils.plainText(p, r.start, r.end);
        if (!text) continue;
        const items = [];
        built.ranges.forEach((ir, k) => {
          if (ir && ir[1] > ir[0] && ir[0] < r.end && ir[1] > r.start) items.push(k);
        });
        sentences.push({ page: n - 1, start: r.start, end: r.end, text, items });
      }
      p.last = sentences.length - 1;
      state.pages.push(p);
      if (n % 5 === 0) await new Promise(r => setTimeout(r)); // keep the UI responsive
    }

    show('reader');
    DocView.detach();
    Viewer.init(pdf, ui.viewer, state.pages, onDoubleClick);
    finishOpen(sentences, 'No readable text found. This looks like a scanned PDF (images only), which can\'t be read aloud.');
  }

  /* ---------- Load & analyse Word (.docx) ---------- */
  async function openDocx(buffer, name) {
    Reader.stop();
    show('loading');
    ui.loadingText.textContent = 'Opening your Word file…';
    ui.loadingBar.style.width = '35%';
    let doc;
    try {
      doc = await DocView.parse(buffer);
    } catch (err) {
      show('upload');
      toast(/internet/.test(err.message) ? err.message : 'Could not open this Word file. Please make sure it is a .docx file and not damaged.', 7000);
      return;
    }
    ui.loadingBar.style.width = '100%';

    state.mode = 'docx';
    state.docName = name.replace(/\.docx$/i, '');
    ui.fileName.textContent = name;
    state.pages = doc.pages;
    state.notes = { en: [], hi: null };
    state.currentPage = -1;

    show('reader');
    DocView.render(ui.viewer, doc.pages, onDocDoubleClick);
    finishOpen(doc.sentences, 'No readable text found in this Word file.');
  }

  // Shared last steps after a PDF or Word file is ready.
  function finishOpen(sentences, emptyMessage) {
    Music.prepare();
    ui.zoomLabel.textContent = '100%';
    Reader.load(sentences);
    ui.seek.max = Math.max(sentences.length - 1, 0);
    updateSeek(0);
    finishedReading = false;
    refreshTime();
    if (!sentences.length) toast(emptyMessage, 8000);
    buildNotes();
  }

  // Word: double-click on a sentence (with the character offset inside it) or on an empty spot of a page.
  function onDocDoubleClick(idx, rawOffset, pageIdx) {
    if (idx == null) {
      const p = state.pages[pageIdx];
      if (!p || p.last < p.first) { toast('There is no readable text on this page.'); return; }
      Reader.startAt(p.first);
      return;
    }
    const s = Reader.sentences[idx];
    let from = s.raw.slice(0, rawOffset).replace(/\s+/g, ' ').replace(/^\s+/, '').length;
    while (from > 0 && !/\s/.test(s.text[from - 1])) from--;
    Reader.startAt(idx, from);
  }

  // The current document view (PDF pages or Word pages).
  const view = () => (state.mode === 'docx' ? DocView : Viewer);

  /* ---------- Double-click → start reading there ---------- */
  function onDoubleClick(pageIdx, itemIdx, charInItem) {
    const p = state.pages[pageIdx];
    if (!p || p.last < p.first) { toast('There is no readable text on this page.'); return; }
    if (itemIdx == null || !p.ranges[itemIdx]) { Reader.startAt(p.first); return; }

    const offset = p.ranges[itemIdx][0] + charInItem;
    const list = Reader.sentences;
    let target = p.first;
    for (let k = p.first; k <= p.last; k++) {
      if (list[k].start <= offset) target = k;
      if (list[k].end > offset && list[k].start <= offset) { target = k; break; }
    }
    const s = list[target];
    // Map the page offset into the sentence text, snapped back to the start of the clicked word.
    let from = 0;
    if (offset > s.start) {
      from = TextUtils.plainText(p, s.start, Math.min(offset, s.end)).length;
      while (from > 0 && !/\s/.test(s.text[from - 1])) from--;
    }
    Reader.startAt(target, from);
  }

  /* ---------- Reading time left ---------- */
  const timeUi = {
    left: $('statLeft'), end: $('statEnd'), total: $('statTotal'), bar: $('statBar'), note: $('statNote'), pill: $('timeLeft'),
  };
  const timing = { fromChar: 0, speakingIdx: -1, startedAt: 0, chars: 0 };
  let finishedReading = false;

  /** Recompute the estimate. `previewIdx` shows the time left from a slider position while dragging. */
  function refreshTime(previewIdx) {
    const list = Reader.sentences;
    if (!list.length) {
      timeUi.left.textContent = timeUi.end.textContent = timeUi.total.textContent = '–';
      timeUi.pill.textContent = '–';
      timeUi.bar.style.width = '0%';
      return;
    }
    const lang = Reader.lang;
    const rate = +ui.rate.value;
    const total = Timing.total(list, lang, rate);
    let left;
    if (previewIdx != null) {
      left = Timing.remaining(list, previewIdx, lang, rate);
    } else if (Reader.playing && timing.speakingIdx === Reader.index && timing.startedAt) {
      // Count down smoothly through the sentence being spoken.
      const current = Timing.secondsFor(timing.chars, 1, lang, rate);
      const elapsed = (performance.now() - timing.startedAt) / 1000;
      left = Math.max(current - elapsed, 0) + Timing.remaining(list, Reader.index + 1, lang, rate);
    } else {
      left = Timing.remaining(list, Reader.index, lang, rate, timing.fromChar);
    }
    if (finishedReading) left = 0;

    timeUi.left.textContent = Timing.clock(left);
    timeUi.end.textContent = left > 0 ? Timing.finishAt(left) : 'Done';
    timeUi.total.textContent = Timing.words(total);
    timeUi.bar.style.width = `${Math.min(100, Math.max(0, (1 - left / total) * 100)).toFixed(1)}%`;
    timeUi.pill.textContent = previewIdx != null ? `${Timing.clock(left)} from here` : `${Timing.clock(left)} left`;
    timeUi.pill.title = `About ${Timing.words(left)} left · finishes around ${Timing.finishAt(left)}`;
    timeUi.note.textContent = `Estimated at ${rate}× in ${lang === 'hi' ? 'Hindi' : 'English'}. It updates when you skip or change speed, and learns your voice's pace.`;
  }

  setInterval(() => { if (!ui.reader.hidden && Reader.playing) refreshTime(); }, 1000);

  /* ---------- Reader events → UI ---------- */
  function updateSeek(i) {
    const total = Reader.sentences.length;
    ui.seek.value = i;
    const s = Reader.sentences[i];
    ui.seekLabel.textContent = total ? `Page ${s.page + 1} / ${state.pages.length} · ${i + 1} of ${total}` : 'No text';
  }

  Reader.on('speaking', d => {
    timing.speakingIdx = d.idx;
    timing.startedAt = d.at;
    timing.chars = d.chars;
    refreshTime();
  });
  Reader.on('spoken', d => Timing.learn(d.lang, d.chars, d.seconds, d.rate));

  Reader.on('position', ({ idx, sentence, fromChar }) => {
    if (!sentence) return;
    updateSeek(idx);
    finishedReading = false;
    timing.fromChar = fromChar || 0;
    timing.speakingIdx = -1;
    refreshTime();
    ui.posLabel.textContent = `· page ${sentence.page + 1}`;
    ui.nowText.textContent = fromChar ? '… ' + sentence.text.slice(fromChar) : sentence.text;
    ui.nowText.classList.remove('muted');
    if (Reader.lang === 'hi') {
      ui.nowTextHi.hidden = false;
      ui.nowTextHi.textContent = sentence.hi || 'अनुवाद हो रहा है…';
    } else {
      ui.nowTextHi.hidden = true;
    }
    const follow = ui.follow.checked && Reader.playing;
    if (state.mode === 'docx') DocView.highlight(idx, follow);
    else Viewer.setHighlight(sentence.page, sentence.items, follow);
    if (sentence.page !== state.currentPage) {
      state.currentPage = sentence.page;
      markCurrentNote();
    }
  });

  Reader.on('hindi', ({ text }) => { ui.nowTextHi.hidden = false; ui.nowTextHi.textContent = text; });
  Reader.on('state', ({ playing }) => {
    ui.play.classList.toggle('playing', playing);
    ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    Music.setPlaying(playing);
    document.body.classList.toggle('is-playing', playing);
  });
  Reader.on('busy', busy => { if (busy) ui.nowTextHi.textContent = 'अनुवाद हो रहा है…'; });
  Reader.on('error', msg => toast(msg, 6000));
  Reader.on('finished', () => {
    finishedReading = true;
    refreshTime();
    toast('Finished reading the document. 🎉');
  });
  Reader.on('stopped', () => view().clearHighlight());

  /* ---------- Player controls ---------- */
  ui.play.addEventListener('click', () => Reader.toggle());
  $('prevSent').addEventListener('click', () => Reader.prevSentence());
  $('nextSent').addEventListener('click', () => Reader.nextSentence());
  $('prevPage').addEventListener('click', () => Reader.prevPage());
  $('nextPage').addEventListener('click', () => Reader.nextPage());
  $('stopBtn').addEventListener('click', () => { Reader.stop(); Reader.goTo(0); });
  ui.seek.addEventListener('input', () => { updateSeek(+ui.seek.value); refreshTime(+ui.seek.value); });
  ui.seek.addEventListener('change', () => Reader.goTo(+ui.seek.value));

  document.addEventListener('keydown', e => {
    if (ui.reader.hidden || e.target.closest('input:not(#seek), select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); Reader.toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? Reader.nextPage() : Reader.nextSentence(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? Reader.prevPage() : Reader.prevSentence(); }
  });

  function zoomBy(dir) {
    const v = view();
    const step = state.mode === 'docx' ? 0.1 : 0.2;
    ui.zoomLabel.textContent = Math.round(v.setZoom(v.getZoom() + dir * step) * 100) + '%';
  }
  $('zoomIn').addEventListener('click', () => zoomBy(1));
  $('zoomOut').addEventListener('click', () => zoomBy(-1));

  // Hide/show the side panel to give the document the full width.
  const panelBtn = $('panelToggle');
  function setWide(wide) {
    ui.reader.classList.toggle('wide', wide);
    panelBtn.textContent = wide ? 'Show panel' : 'Hide panel';
    panelBtn.setAttribute('aria-pressed', wide);
    store.set('pdfreader.wide', wide ? '1' : '0');
    // PDF pages are sized to fit the width, so re-fit them after the layout changes.
    if (state.mode === 'pdf' && !ui.reader.hidden) Viewer.setZoom(Viewer.getZoom());
  }
  panelBtn.addEventListener('click', () => setWide(!ui.reader.classList.contains('wide')));
  if (store.get('pdfreader.wide') === '1') setWide(true);

  /* ---------- Language & voices ---------- */
  function setSegmented(groupId, value) {
    $(groupId).querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.lang === value));
  }

  $('langToggle').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    setSegmented('langToggle', b.dataset.lang);
    Reader.setLang(b.dataset.lang);
    store.set('pdfreader.lang', b.dataset.lang);
    refreshTime();
    fillVoices();
    if (b.dataset.lang === 'hi') {
      const s = Reader.sentences[Reader.index];
      if (s) {
        ui.nowTextHi.hidden = false;
        Reader.translatePage(s.page)
          .then(() => { if (Reader.sentences[Reader.index] === s) ui.nowTextHi.textContent = s.hi; })
          .catch(err => toast(err.message, 6000));
      }
    } else {
      ui.nowTextHi.hidden = true;
    }
  });

  function fillVoices() {
    const lang = Reader.lang;
    const list = Voices.forLang(lang);
    ui.voiceSelect.innerHTML = '';
    if (!list.length) {
      const o = document.createElement('option');
      o.textContent = 'Default system voice';
      ui.voiceSelect.appendChild(o);
      Reader.setVoice(lang, null);
      ui.voiceHint.textContent = lang === 'hi'
        ? 'No Hindi voice on this device. For the best Hindi female voice use Microsoft Edge or Google Chrome, or add Hindi in Windows Settings → Time & language → Speech.'
        : 'No English voice found. Try Microsoft Edge or Google Chrome.';
      return;
    }
    const saved = store.get('pdfreader.voice.' + lang);
    let selected = list.findIndex(v => v.voice.name === saved);
    if (selected < 0) selected = 0;
    list.forEach((v, i) => {
      const o = document.createElement('option');
      o.value = i;
      const tag = v.gender === 'female' ? '♀ ' : v.gender === 'male' ? '♂ ' : '';
      o.textContent = `${tag}${v.voice.name.replace(/^Microsoft\s+/, '').replace(/\s*-\s*.*$/, '')} (${v.voice.lang})`;
      ui.voiceSelect.appendChild(o);
    });
    ui.voiceSelect.value = selected;
    ui.voiceSelect.onchange = () => {
      const v = list[+ui.voiceSelect.value];
      store.set('pdfreader.voice.' + lang, v.voice.name);
      Reader.setVoice(lang, v.voice);
      voiceHint(v);
    };
    Reader.setVoice(lang, list[selected].voice);
    voiceHint(list[selected]);
  }

  function voiceHint(v) {
    const natural = /natural|neural|online/i.test(v.voice.name);
    if (v.gender !== 'female') {
      ui.voiceHint.textContent = 'No female voice detected for this language on your device — using the closest match. Microsoft Edge offers natural female voices (Neerja for English, Swara for Hindi).';
    } else if (!natural && !/google/i.test(v.voice.name)) {
      ui.voiceHint.textContent = 'Tip: open this site in Microsoft Edge for the most natural female voices (Neerja / Swara).';
    } else {
      ui.voiceHint.textContent = '';
    }
  }

  ui.rate.addEventListener('change', () => {
    Reader.setRate(+ui.rate.value);
    store.set('pdfreader.rate', ui.rate.value);
    refreshTime();
  });

  /* ---------- Background music ---------- */
  const music = {
    toggle: $('musicToggle'), controls: $('musicControls'), volume: $('musicVolume'), volLabel: $('musicVolLabel'),
    url: $('musicUrl'), urlBtn: $('musicUrlBtn'), file: $('musicFile'), name: $('musicName'),
    reset: $('musicDefaultBtn'),
  };
  let musicFileName = '';

  function initMusic() {
    const savedVol = store.get('pdfreader.music.volume');
    const vol = savedVol !== null && !isNaN(+savedVol) ? +savedVol : 40;
    const enabled = store.get('pdfreader.music.enabled') !== 'off';
    // No saved link → the default music folder plays, on a loop.
    const video = store.get('pdfreader.music.video');
    Music.init({ host: $('musicPlayer'), enabled, volume: vol, videoId: video });
    music.toggle.checked = enabled;
    music.controls.hidden = !enabled;
    music.volume.value = vol;
    music.volLabel.textContent = vol + '%';
    Music.findFolderTracks();
  }

  Music.on('track', t => {
    music.reset.hidden = t.kind === 'folder' || t.kind === 'fallback';
    if (t.kind === 'file') music.name.textContent = `Playing your file: ${musicFileName} (looping)`;
    else if (t.kind === 'youtube') music.name.textContent = 'Playing your YouTube link (looping).';
    else if (t.kind === 'fallback') music.name.textContent = 'Music folder is empty — playing "Deep Focus" (Quiet Quest) from YouTube.';
    else if (t.loading) music.name.textContent = 'Default music from the music folder (looping).';
    else music.name.textContent = t.count > 1
      ? `Default music: ${t.name} (${t.index + 1} of ${t.count}, playlist loops).`
      : `Default music: ${t.name} (looping).`;
  });

  music.toggle.addEventListener('change', () => {
    music.controls.hidden = !music.toggle.checked;
    Music.setEnabled(music.toggle.checked);
    store.set('pdfreader.music.enabled', music.toggle.checked ? 'on' : 'off');
  });
  music.volume.addEventListener('input', () => {
    music.volLabel.textContent = music.volume.value + '%';
    Music.setVolume(+music.volume.value);
    store.set('pdfreader.music.volume', music.volume.value);
  });
  const useLink = () => {
    if (!music.url.value.trim()) return;
    if (!Music.setVideo(music.url.value)) { toast('That doesn\'t look like a YouTube video link.'); return; }
    store.set('pdfreader.music.video', Music.videoId);
    music.url.value = '';
  };
  music.reset.addEventListener('click', () => {
    store.set('pdfreader.music.video', '');
    Music.useDefault();
  });
  music.urlBtn.addEventListener('click', useLink);
  music.url.addEventListener('keydown', e => { if (e.key === 'Enter') useLink(); });
  music.file.addEventListener('change', () => {
    const f = music.file.files[0];
    if (!f) return;
    musicFileName = f.name;
    Music.setFile(f);
    music.file.value = '';
  });
  Music.on('error', msg => toast(msg, 7000));
  initMusic();

  /* ---------- Tabs ---------- */
  document.querySelector('.tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab');
    if (!t) return;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('panel-listen').hidden = t.dataset.tab !== 'listen';
    $('panel-notes').hidden = t.dataset.tab !== 'notes';
    if (t.dataset.tab === 'notes') markCurrentNote(true);
  });

  /* ---------- Notes ---------- */
  function buildNotes() {
    state.notes.en = Notes.generate(state.pages.map(p => ({
      num: p.num,
      heading: p.heading,
      sentences: Reader.sentences.slice(p.first, p.last + 1).map(s => s.text),
    })));
    state.notes.hi = null;
    if (state.notesLang === 'hi') showNotesIn('hi');
    else renderNotes();
  }

  function currentNotes() {
    return state.notesLang === 'hi' && state.notes.hi ? state.notes.hi : state.notes.en;
  }

  function renderNotes() {
    const notes = currentNotes();
    const lang = notes === state.notes.hi ? 'hi' : 'en';
    const L = Notes.labels(lang);
    const esc = Notes.esc;
    ui.notesStatus.textContent = `${notes.length} page${notes.length === 1 ? '' : 's'} · generated in your browser`;
    ui.notesList.innerHTML = notes.map((n, i) => `
      <article class="note-card${lang === 'hi' ? ' hi' : ''}" data-i="${i}" style="--i:${i}">
        <div class="note-head">
          <div>
            <div class="note-page">${L.page} ${n.page}</div>
            <h3 class="note-title">${esc(n.title)}</h3>
          </div>
          <div class="note-tools">
            <button data-act="listen" title="Listen from this page">🔊</button>
            <button data-act="copy" title="Copy notes">📋</button>
            <button data-act="download" title="Download this page's notes">⬇</button>
          </div>
        </div>
        ${n.empty ? `<p class="small muted">${L.empty}</p>` : ''}
        ${n.definitions.length ? `<h4>${L.defs}</h4><ul>${n.definitions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${n.points.length ? `<h4>${L.points}</h4><ul>${n.points.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}      </article>`).join('');
    markCurrentNote();
  }

  function markCurrentNote(scroll) {
    const cards = ui.notesList.querySelectorAll('.note-card');
    cards.forEach(c => c.classList.toggle('current', +c.dataset.i === state.currentPage));
    if (scroll && cards[state.currentPage]) cards[state.currentPage].scrollIntoView({ block: 'nearest' });
  }

  ui.notesList.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = +btn.closest('.note-card').dataset.i;
    const notes = currentNotes();
    const lang = notes === state.notes.hi ? 'hi' : 'en';
    if (btn.dataset.act === 'listen') {
      const p = state.pages[i];
      if (p.last < p.first) { toast('There is no readable text on this page.'); return; }
      view().scrollToPage(i);
      Reader.startAt(p.first);
    } else if (btn.dataset.act === 'copy') {
      const text = Notes.toText([notes[i]], state.docName, lang);
      navigator.clipboard.writeText(text).then(() => toast('Notes copied.'), () => toast('Copy failed — try the download button.'));
    } else {
      download(`${state.docName} - page ${i + 1} notes.txt`, '﻿' + Notes.toText([notes[i]], state.docName, lang), 'text/plain;charset=utf-8');
    }
  });

  $('notesLangToggle').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) showNotesIn(b.dataset.lang);
  });

  async function showNotesIn(lang) {
    setSegmented('notesLangToggle', lang);
    state.notesLang = lang;
    if (lang === 'en' || state.notes.hi) { renderNotes(); return; }

    ui.notesStatus.textContent = 'Translating notes to Hindi…';
    const src = state.notes.en;
    const strings = [];
    src.forEach(n => { strings.push(n.title, ...n.definitions, ...n.points); });
    try {
      const out = await Translator.translateMany(strings, 'hi');
      let k = 0;
      state.notes.hi = src.map(n => ({
        ...n,
        title: out[k++],
        definitions: n.definitions.map(() => out[k++]),
        points: n.points.map(() => out[k++]),
      }));
      if (state.notesLang === 'hi') renderNotes();
    } catch (err) {
      toast(err.message, 6000);
      state.notesLang = 'en';
      setSegmented('notesLangToggle', 'en');
      renderNotes();
    }
  }

  /* ---------- Downloads ---------- */
  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function notesLangNow() { return currentNotes() === state.notes.hi ? 'hi' : 'en'; }
  const suffix = () => (notesLangNow() === 'hi' ? ' (Hindi)' : '');

  $('dlDoc').addEventListener('click', () => {
    download(`${state.docName} - notes${suffix()}.doc`, '﻿' + Notes.toWordDoc(currentNotes(), state.docName, notesLangNow()), 'application/msword');
  });
  $('dlTxt').addEventListener('click', () => {
    download(`${state.docName} - notes${suffix()}.txt`, '﻿' + Notes.toText(currentNotes(), state.docName, notesLangNow()), 'text/plain;charset=utf-8');
  });
  $('dlPdf').addEventListener('click', () => {
    ui.printArea.innerHTML = Notes.toHtmlBody(currentNotes(), state.docName, notesLangNow());
    toast('In the print window, choose "Save as PDF" as the destination.', 5000);
    setTimeout(() => window.print(), 300);
  });

  /* ---------- Start-up ---------- */
  (async () => {
    if (!('speechSynthesis' in window)) {
      toast('Your browser does not support speech. Please use Google Chrome or Microsoft Edge.', 10000);
      return;
    }
    const savedRate = store.get('pdfreader.rate');
    if (savedRate) { ui.rate.value = savedRate; Reader.setRate(+savedRate); }
    const savedLang = store.get('pdfreader.lang');
    if (savedLang === 'hi') { setSegmented('langToggle', 'hi'); Reader.setLang('hi'); }
    await Voices.load();
    fillVoices();
    // Some browsers (Edge) add their online voices a little later.
    let count = speechSynthesis.getVoices().length;
    speechSynthesis.addEventListener('voiceschanged', () => {
      if (Voices.refresh().length === count) return;
      count = Voices.refresh().length;
      fillVoices();
    });
  })();

  // Exposed for automated testing.
  window.PdfVoiceReader = { openPdf, openDocx };
})();

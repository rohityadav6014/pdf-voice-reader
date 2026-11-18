/*
 * Reports user actions to Analytics. It only listens — the app's own handlers do the work.
 * Clicks are caught as they bubble to the document, so the app has already updated its state.
 */
(() => {
  const track = (name, params) => Analytics.event(name, params);
  const fileType = () => (document.getElementById('viewer').classList.contains('doc-mode') ? 'docx' : 'pdf');

  const CLICKS = {
    prevSent: () => track('skip', { type: 'prev_sentence' }),
    nextSent: () => track('skip', { type: 'next_sentence' }),
    prevPage: () => track('skip', { type: 'prev_page' }),
    nextPage: () => track('skip', { type: 'next_page' }),
    stopBtn: () => track('stop'),
    zoomIn: () => track('zoom', { direction: 'in' }),
    zoomOut: () => track('zoom', { direction: 'out' }),
    panelToggle: () => track('toggle_panel', { panel: document.getElementById('readerScreen').classList.contains('wide') ? 'hidden' : 'shown' }),
    homeLink: () => track('go_home'),
    backBtn: () => track('back_to_reading'),
    resumeGo: () => track('resume_continue'),
    resumeRestart: () => track('resume_start_over'),
    musicUrlBtn: () => track('music_source', { source: 'youtube' }),
    musicDefaultBtn: () => track('music_source', { source: 'default' }),
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('button, a, label');
    if (!el) return;
    if (CLICKS[el.id]) { CLICKS[el.id](); return; }

    const seg = el.closest('.segmented');
    if (seg && el.dataset.lang) {
      track(seg.id === 'notesLangToggle' ? 'notes_language' : 'change_language', { language: el.dataset.lang });
      return;
    }
    if (el.classList.contains('tab')) { track('open_tab', { tab: el.dataset.tab }); return; }

    const act = el.dataset.act;
    if (act && el.closest('.note-card')) {
      track({ listen: 'listen_from_notes', copy: 'copy_notes', download: 'download_notes' }[act] || 'notes_action',
        act === 'download' ? { format: 'txt', scope: 'page' } : {});
      return;
    }
    if (act && el.closest('.recent-item')) track(act === 'remove' ? 'recent_remove' : 'recent_open');
  });

  const CHANGES = {
    rateSelect: el => track('change_speed', { speed: el.value }),
    voiceSelect: () => track('change_voice'),
    followToggle: el => track('auto_scroll', { on: el.checked }),
    musicToggle: el => track('music_toggle', { on: el.checked }),
    musicVolume: el => track('music_volume', { volume: Number(el.value) }),
    musicFile: () => track('music_source', { source: 'file' }),
    seek: () => track('skip', { type: 'slider' }),
    fileInput: () => track('choose_file', { from: 'home' }),
    fileInputTop: () => track('choose_file', { from: 'reader' }),
  };
  document.addEventListener('change', e => { if (CHANGES[e.target.id]) CHANGES[e.target.id](e.target); });

  // Double-click (or double-tap) on the document starts reading from that word.
  document.getElementById('viewer').addEventListener('dblclick', () => track('start_from_word', { file_type: fileType() }));
  document.getElementById('dropZone').addEventListener('drop', () => track('choose_file', { from: 'drop' }));

  // Keyboard shortcuts in the reader.
  document.addEventListener('keydown', e => {
    if (document.getElementById('readerScreen').hidden || e.target.closest('input:not(#seek), select, textarea')) return;
    const key = e.code === 'Space' ? 'space' : e.key === 'ArrowRight' ? (e.shiftKey ? 'shift_right' : 'right')
      : e.key === 'ArrowLeft' ? (e.shiftKey ? 'shift_left' : 'left') : null;
    if (key) track('keyboard_shortcut', { key });
  });

  // Playback and reading outcomes.
  let wasPlaying = false;
  Reader.on('state', ({ playing }) => {
    if (playing === wasPlaying) return; // the reader also reports "paused" when it was already paused
    wasPlaying = playing;
    track(playing ? 'play' : 'pause', { language: Reader.lang });
  });
  Reader.on('finished', () => track('finished_reading', { file_type: fileType() }));
  Reader.on('error', () => track('error', { type: 'speech' }));
  Music.on('error', () => track('error', { type: 'music' }));
})();

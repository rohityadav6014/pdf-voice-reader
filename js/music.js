/*
 * Background music under the reading voice.
 * Default: the tracks in the site's music/ folder (music1.mp3, music2.mp3, …), looped.
 * A pasted YouTube link or an uploaded audio file replaces them until "Use default" is pressed.
 * If the music folder has no tracks, the embedded YouTube video below is used instead.
 */
const Music = (() => {
  const FALLBACK_VIDEO = 'oPVte6aMprI'; // "Deep Focus - Music For Studying" by Quiet Quest - Study Music
  const FOLDER = 'music/';
  const MAX_FOLDER_TRACKS = 50;

  let enabled = true;
  let volume = 40;
  let source = 'folder';   // 'folder' | 'youtube' | 'file'
  let videoId = null;      // a YouTube link the user provided
  let wantPlaying = false;
  let host = null;
  let yt = null;
  let ytReady = null;      // promise resolved when the YouTube player can be controlled
  let apiLoading = null;
  let audio = null;
  let fileUrl = null;
  let folderTracks = null; // promise of track URLs found in music/
  let knownTracks = null;  // the same list once found
  let trackIdx = 0;
  const handlers = {};

  const on = (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); };
  const emit = (evt, data) => (handlers[evt] || []).forEach(fn => fn(data));

  function parseVideoId(input) {
    const s = String(input || '').trim();
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
    if (m) return m[1];
    return /^[\w-]{11}$/.test(s) ? s : null;
  }

  /* ---------- music/ folder ---------- */
  // A static site can't list a folder, so look for an optional playlist.json,
  // otherwise probe music1.mp3, music2.mp3, … until one is missing.
  function findFolderTracks() {
    if (folderTracks) return folderTracks;
    folderTracks = (async () => {
      try {
        const res = await fetch(FOLDER + 'playlist.json', { cache: 'no-cache' });
        if (res.ok) {
          const list = await res.json();
          const tracks = (Array.isArray(list) ? list : list.tracks || []).filter(t => typeof t === 'string');
          if (tracks.length) return tracks.map(t => FOLDER + encodeURI(t));
        }
      } catch { /* no playlist file */ }
      const found = [];
      for (let n = 1; n <= MAX_FOLDER_TRACKS; n++) {
        const url = `${FOLDER}music${n}.mp3`;
        try {
          const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
          if (!res.ok) break;
          found.push(url);
        } catch { break; }
      }
      return found;
    })().then(tracks => { knownTracks = tracks; return tracks; });
    return folderTracks;
  }

  function ensureAudio() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    audio.addEventListener('ended', () => {
      // Folder playlist: go to the next track, wrapping around to the first.
      if (source !== 'folder' || !wantPlaying) return;
      folderTracks.then(tracks => {
        trackIdx = (trackIdx + 1) % tracks.length;
        audio.src = tracks[trackIdx];
        audio.play().catch(() => {});
        emit('track', describe());
      });
    });
    audio.addEventListener('error', () => {
      if (source === 'folder') emit('error', 'A track in the music folder could not be played.');
      else if (source === 'file') emit('error', 'This audio file could not be played. Try an MP3 file.');
    });
    return audio;
  }

  /* ---------- YouTube ---------- */
  function loadApi() {
    if (apiLoading) return apiLoading;
    apiLoading = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) { resolve(); return; }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { apiLoading = null; reject(new Error('Could not load YouTube. Check your internet connection.')); };
      document.head.appendChild(s);
    });
    return apiLoading;
  }

  function ensurePlayer(id) {
    if (ytReady) {
      return ytReady.then(() => {
        const current = yt.getVideoData ? yt.getVideoData().video_id : null;
        if (current !== id) yt.cueVideoById(id);
      });
    }
    ytReady = loadApi().then(() => new Promise(resolve => {
      const div = document.createElement('div');
      host.innerHTML = '';
      host.appendChild(div);
      yt = new YT.Player(div, {
        host: 'https://www.youtube-nocookie.com',
        videoId: id,
        width: '100%',
        height: '100%',
        playerVars: { controls: 1, rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => { yt.setVolume(volume); resolve(); },
          onStateChange: e => {
            if (e.data === YT.PlayerState.ENDED && wantPlaying) { yt.seekTo(0, true); yt.playVideo(); }
          },
          onError: e => {
            emit('error', e.data === 101 || e.data === 150
              ? "This video's owner doesn't allow it to play on other websites. Try another link or upload your own music."
              : 'This YouTube video could not be played. Try another link or upload your own music.');
          },
        },
      });
    })).catch(err => { ytReady = null; emit('error', err.message); throw err; });
    return ytReady;
  }

  function pauseYouTube() { if (yt && yt.pauseVideo) yt.pauseVideo(); }

  /* ---------- Playback ---------- */
  // Which YouTube video to show right now, if any.
  async function activeVideo() {
    if (source === 'youtube') return videoId;
    if (source === 'folder' && !(await findFolderTracks()).length) return FALLBACK_VIDEO;
    return null;
  }

  async function apply() {
    const vid = enabled ? await activeVideo() : null;
    host.hidden = !vid;

    // Local audio: uploaded file or music folder.
    if (source === 'file' && fileUrl) {
      const a = ensureAudio();
      if (a.src !== fileUrl) { a.src = fileUrl; }
      a.loop = true;
    } else if (source === 'folder' && !vid) {
      const tracks = await findFolderTracks();
      const a = ensureAudio();
      const want = new URL(tracks[trackIdx % tracks.length], location.href).href;
      if (a.src !== want) a.src = want;
      a.loop = tracks.length === 1;
    } else if (audio) {
      audio.pause();
    }
    const play = enabled && wantPlaying; // read after the awaits so a quick pause always wins
    if (audio) {
      audio.volume = volume / 100;
      const local = (source === 'file' && fileUrl) || (source === 'folder' && !vid);
      if (play && local) audio.play().catch(() => {});
      else audio.pause();
    }

    // YouTube: a pasted link, or the fallback when the folder is empty.
    if (vid) {
      ensurePlayer(vid).then(() => {
        yt.setVolume(volume);
        if (enabled && wantPlaying) yt.playVideo();
        else yt.pauseVideo();
      }).catch(() => {});
    } else {
      pauseYouTube();
    }
    emit('track', describe());
  }

  function describe() {
    if (source === 'file') return { kind: 'file' };
    if (source === 'youtube') return { kind: 'youtube' };
    if (!knownTracks) return { kind: 'folder', loading: true };
    if (!knownTracks.length) return { kind: 'fallback' };
    const url = knownTracks[trackIdx % knownTracks.length];
    return { kind: 'folder', name: decodeURI(url.slice(FOLDER.length)), count: knownTracks.length, index: trackIdx };
  }

  /* ---------- Public API ---------- */
  function init(opts) {
    host = opts.host;
    enabled = opts.enabled;
    volume = opts.volume;
    videoId = parseVideoId(opts.videoId);
    source = videoId ? 'youtube' : 'folder';
  }

  /** Get the player ready (without playing) once a PDF is open. */
  function prepare() { return apply(); }

  function setPlaying(playing) { wantPlaying = playing; apply(); }
  function setEnabled(on) { enabled = on; apply(); }

  function setVolume(v) {
    volume = Math.max(0, Math.min(100, v));
    if (yt && yt.setVolume) yt.setVolume(volume);
    if (audio) audio.volume = volume / 100;
  }

  /** Play a YouTube video instead of the music folder. Returns false if the link isn't a YouTube video. */
  function setVideo(input) {
    const id = parseVideoId(input);
    if (!id) return false;
    videoId = id;
    source = 'youtube';
    apply();
    return true;
  }

  function setFile(file) {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    fileUrl = URL.createObjectURL(file);
    source = 'file';
    apply();
  }

  /** Go back to the music folder. */
  function useDefault() {
    videoId = null;
    source = 'folder';
    apply();
  }

  return {
    on, init, prepare, setPlaying, setEnabled, setVolume, setVideo, setFile, useDefault, findFolderTracks,
    get videoId() { return videoId; },
    get source() { return source; },
    get trackIndex() { return trackIdx; },
    get playerState() { return yt && yt.getPlayerState ? yt.getPlayerState() : null; },
    get playerVolume() { return yt && yt.getVolume ? yt.getVolume() : null; },
    get audio() { return audio; },
    FALLBACK_VIDEO,
  };
})();

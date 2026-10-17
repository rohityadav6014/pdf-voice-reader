/* Background music under the reading voice: an embedded YouTube video or the user's own audio file. */
const Music = (() => {
  const DEFAULT_VIDEO = 'oPVte6aMprI'; // "Deep Focus - Music For Studying" by Quiet Quest - Study Music
  let enabled = true;
  let volume = 40;
  let source = 'youtube';  // 'youtube' | 'file'
  let videoId = DEFAULT_VIDEO;
  let wantPlaying = false;
  let host = null;
  let yt = null;
  let ytReady = null;      // promise resolved when the player can be controlled
  let apiLoading = null;
  let audio = null;
  const handlers = {};

  const on = (evt, fn) => { (handlers[evt] = handlers[evt] || []).push(fn); };
  const emit = (evt, data) => (handlers[evt] || []).forEach(fn => fn(data));

  function parseVideoId(input) {
    const s = String(input || '').trim();
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
    if (m) return m[1];
    return /^[\w-]{11}$/.test(s) ? s : null;
  }

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

  function ensurePlayer() {
    if (ytReady) return ytReady;
    ytReady = loadApi().then(() => new Promise(resolve => {
      const div = document.createElement('div');
      host.innerHTML = '';
      host.appendChild(div);
      yt = new YT.Player(div, {
        host: 'https://www.youtube-nocookie.com',
        videoId,
        width: '100%',
        height: '100%',
        playerVars: { controls: 1, rel: 0, playsinline: 1, modestbranding: 1 },
        events: {
          onReady: () => { yt.setVolume(volume); resolve(); },
          onStateChange: e => {
            // Loop the track for as long as the reading continues.
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

  function apply() {
    host.hidden = !enabled || source !== 'youtube';
    const play = enabled && wantPlaying;

    if (audio) {
      audio.volume = volume / 100;
      if (play && source === 'file') audio.play().catch(() => {});
      else audio.pause();
    }

    if (source === 'youtube' && enabled) {
      ensurePlayer().then(() => {
        yt.setVolume(volume);
        if (enabled && wantPlaying && source === 'youtube') yt.playVideo();
        else yt.pauseVideo();
      }).catch(() => {});
    } else if (yt && yt.pauseVideo) {
      yt.pauseVideo();
    }
  }

  /* ---------- Public API ---------- */
  function init(opts) {
    host = opts.host;
    enabled = opts.enabled;
    volume = opts.volume;
    videoId = parseVideoId(opts.videoId) || DEFAULT_VIDEO;
  }

  /** Show the player (without playing) once a PDF is open. */
  function prepare() { apply(); }

  function setPlaying(playing) { wantPlaying = playing; apply(); }
  function setEnabled(on) { enabled = on; apply(); }

  function setVolume(v) {
    volume = Math.max(0, Math.min(100, v));
    if (yt && yt.setVolume) yt.setVolume(volume);
    if (audio) audio.volume = volume / 100;
  }

  /** Switch to another YouTube video. Returns false if the link isn't a YouTube video. */
  function setVideo(input) {
    const id = parseVideoId(input);
    if (!id) return false;
    videoId = id;
    source = 'youtube';
    if (yt && yt.cueVideoById) {
      ensurePlayer().then(() => {
        if (enabled && wantPlaying) yt.loadVideoById(id);
        else yt.cueVideoById(id);
      });
    }
    apply();
    return true;
  }

  function setFile(file) {
    if (!audio) { audio = new Audio(); audio.loop = true; }
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(file);
    source = 'file';
    apply();
  }

  return {
    on, init, prepare, setPlaying, setEnabled, setVolume, setVideo, setFile,
    get videoId() { return videoId; },
    get source() { return source; },
    get playerState() { return yt && yt.getPlayerState ? yt.getPlayerState() : null; },
    get playerVolume() { return yt && yt.getVolume ? yt.getVolume() : null; },
    DEFAULT_VIDEO,
  };
})();

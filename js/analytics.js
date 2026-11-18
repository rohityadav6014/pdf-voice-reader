/*
 * Analytics: every action goes to Google Analytics 4 and to Sunotes' own small collector
 * (/api/track on Vercel), which powers the admin panel.
 * Only anonymous counts are sent — never file names, document text or notes.
 */
const Analytics = (() => {
  // Your GA4 Measurement ID, e.g. 'G-ABC123XYZ9' (analytics.google.com → Admin → Data streams).
  const MEASUREMENT_ID = 'G-0FCQPQX51P';
  const COLLECTOR = 'https://sunotes-sigma.vercel.app/api/track';

  // Never count local testing.
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const gaEnabled = /^G-[A-Z0-9]+$/.test(MEASUREMENT_ID) && !isLocal;
  const collectorEnabled = !isLocal;
  const enabled = gaEnabled || collectorEnabled;

  if (gaEnabled) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID);
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(s);
  }

  /* ---------- Own collector ---------- */
  // A random id per browser, only used to count unique visitors.
  function visitorId() {
    try {
      let id = localStorage.getItem('sunotes.vid');
      if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
        id = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
        localStorage.setItem('sunotes.vid', id);
      }
      return id;
    } catch {
      return 'anon' + Math.random().toString(36).slice(2, 14);
    }
  }

  const vid = visitorId();
  let queue = [];
  let timer = null;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!queue.length || !collectorEnabled) return;
    const body = JSON.stringify({ vid, events: queue.splice(0, 50) });
    // text/plain avoids a CORS preflight; sendBeacon also survives the tab closing.
    const blob = new Blob([body], { type: 'text/plain' });
    if (!(navigator.sendBeacon && navigator.sendBeacon(COLLECTOR, blob))) {
      fetch(COLLECTOR, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    }
    if (queue.length) flush();
  }

  function enqueue(name, params) {
    if (!collectorEnabled) return;
    queue.push({ n: name, p: params || {} });
    if (queue.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 3000);
  }

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  /* ---------- Public ---------- */
  function event(name, params) {
    if (gaEnabled) window.gtag('event', name, params || {});
    enqueue(name, params);
  }

  function device() {
    const w = Math.min(screen.width || innerWidth, screen.height || innerHeight);
    if (/iPad|Tablet/i.test(navigator.userAgent) || (w >= 600 && /Android/i.test(navigator.userAgent))) return 'tablet';
    return /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
  }

  function browser() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\/|Opera/.test(ua)) return 'opera';
    if (/SamsungBrowser/.test(ua)) return 'samsung';
    if (/Firefox\//.test(ua)) return 'firefox';
    if (/Chrome\//.test(ua)) return 'chrome';
    if (/Safari\//.test(ua)) return 'safari';
    return 'other';
  }

  function referrer() {
    try {
      if (!document.referrer) return 'direct';
      const host = new URL(document.referrer).hostname.replace(/^www\./, '');
      return host === location.hostname ? 'internal' : host;
    } catch { return 'direct'; }
  }

  // One page view per load for the admin panel (GA records its own automatically).
  if (collectorEnabled) {
    enqueue('page_view', { device: device(), browser: browser(), referrer: referrer(), path: location.pathname });
    setTimeout(flush, 1000);
  }

  return { event, enabled, gaEnabled };
})();

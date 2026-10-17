/*
 * Google Analytics 4: visitor counts plus a few anonymous events.
 * Nothing about the user's files (names, text, notes) is ever sent.
 */
const Analytics = (() => {
  // Your GA4 Measurement ID, e.g. 'G-ABC123XYZ9' (analytics.google.com → Admin → Data streams).
  const MEASUREMENT_ID = '';

  // Off until an ID is set, and never on local testing so it doesn't inflate the numbers.
  const enabled = /^G-[A-Z0-9]+$/.test(MEASUREMENT_ID) &&
    !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  if (enabled) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', MEASUREMENT_ID);
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(s);
  }

  function event(name, params) {
    if (enabled) window.gtag('event', name, params || {});
  }

  return { event, enabled };
})();

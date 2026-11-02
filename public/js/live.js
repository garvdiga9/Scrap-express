// Keeps an open page up to date without reloading. The server says what
// changed (lib/live.js) and the page re-fetches just that part.
//   SELive.on('rates', () => loadRates(true));
//   SELive.start();
window.SELive = (() => {
  const CHECK_EVERY_MS = 15 * 1000;
  // The server sends a heartbeat every 25 seconds.
  const SILENT_TOO_LONG_MS = 70 * 1000;
  const GATHER_CHANGES_MS = 300;

  const handlers = new Map();
  let source = null;
  let running = false;
  let lastHeard = 0;
  let wasConnected = false;

  // Several changes close together cause one refresh, and refreshes never
  // overlap, so an older answer can't overwrite a newer one.
  function oneAtATime(refresh) {
    let timer = null;
    let busy = false;
    let again = false;
    const run = async () => {
      timer = null;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      try {
        await refresh();
      } catch (err) {
        /* keep showing what's there; the next change or reconnect tries again */
      }
      busy = false;
      if (again) {
        again = false;
        run();
      }
    };
    return () => {
      if (!timer) timer = setTimeout(run, GATHER_CHANGES_MS);
    };
  }

  function on(topic, refresh) {
    handlers.set(topic, oneAtATime(refresh));
  }

  function refreshEverything() {
    handlers.forEach((refresh) => refresh());
  }

  function disconnect() {
    if (source) source.close();
    source = null;
  }

  function connect() {
    disconnect();
    lastHeard = Date.now();
    source = new EventSource('/api/live');
    source.addEventListener('open', () => {
      lastHeard = Date.now();
      // Anything could have changed while the connection was down.
      if (wasConnected) refreshEverything();
      wasConnected = true;
    });
    source.addEventListener('ping', () => { lastHeard = Date.now(); });
    source.addEventListener('change', (e) => {
      lastHeard = Date.now();
      const refresh = handlers.get(e.data);
      if (refresh) refresh();
    });
  }

  // Connected only while the page is on screen; coming back reconnects and
  // catches up. Also recovers from a deploy or a dropped connection, where
  // the browser may give up on reconnecting by itself.
  function check() {
    if (!running || document.visibilityState !== 'visible') {
      disconnect();
      return;
    }
    const closed = !source || source.readyState === EventSource.CLOSED;
    if (closed || Date.now() - lastHeard > SILENT_TOO_LONG_MS) connect();
  }

  function start() {
    if (running || !('EventSource' in window)) return;
    running = true;
    check();
  }

  function stop() {
    running = false;
    wasConnected = false;
    disconnect();
  }

  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
  window.addEventListener('pagehide', disconnect);

  return { on, start, stop };
})();

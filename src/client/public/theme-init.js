/*
 * Applies the saved theme before first paint so the page never flashes the
 * wrong colours. It is a separate, render-blocking file because the production
 * Content-Security-Policy (script-src 'self') forbids inline scripts.
 * The storage key and values mirror src/client/app/theme-storage.ts.
 */
(function () {
  try {
    var theme = window.localStorage.getItem('jscout.theme');
    if (theme === 'light' || theme === 'dark' || theme === 'system') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  } catch (_err) {
    /* storage unavailable (private mode): the CSS falls back to the system preference */
  }
})();

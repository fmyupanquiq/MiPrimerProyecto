/* global window, document */
(function () {
  // Aplica el tema guardado ANTES del primer pintado (espejo de readStoredTheme/resolveTheme en theme.tsx).
  // Solo lee la preferencia; nunca la escribe. Si cambia su lógica, se publica como theme-init.v2.js.
  var mode = 'dark';
  try {
    var stored = window.localStorage.getItem('letfer.theme');
    if (stored === 'dark' || stored === 'light' || stored === 'system') mode = stored;
  } catch {
    /* sin almacenamiento: tema oscuro por defecto */
  }
  var theme = mode;
  if (mode === 'system') {
    theme =
      typeof window.matchMedia !== 'function' ||
      window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
})();

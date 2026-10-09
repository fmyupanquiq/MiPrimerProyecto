import { configureSpanishValidationMessages } from '@letfer/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import './index.css';
import { applyTheme, readStoredTheme, ThemeProvider } from './theme.js';

configureSpanishValidationMessages();
// El tema se aplica antes del primer render para que la página no parpadee en otro color.
applyTheme(readStoredTheme());

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('No se encontró el elemento #root');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);

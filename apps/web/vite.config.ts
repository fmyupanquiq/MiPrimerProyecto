import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // En desarrollo, las llamadas a /api se reenvían a la API de NestJS.
    proxy: {
      '/api': process.env['API_URL'] ?? 'http://127.0.0.1:3000',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    // Cada archivo monta la app entera en jsdom (~0,8 s en frío la primera prueba). Con tantos workers
    // como núcleos o más, la saturación hacía vencer el timeout de `findBy*` en la primera prueba de
    // algún archivo. Con 4 la suite es igual de rápida y estable (medido: 3 de 3 verdes).
    maxWorkers: 4,
  },
});

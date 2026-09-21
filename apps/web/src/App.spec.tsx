import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.js';

describe('App', () => {
  afterEach(() => {
    cleanup();
  });

  it('muestra el nombre del sistema tomado de @letfer/shared', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'LetFer' })).toBeTruthy();
  });
});

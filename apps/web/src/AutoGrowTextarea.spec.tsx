import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoGrowTextarea } from './AutoGrowTextarea.js';

afterEach(cleanup);

function Harness({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [value, setValue] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <AutoGrowTextarea aria-label="Pronóstico" value={value} onChange={setValue} />
    </form>
  );
}

describe('AutoGrowTextarea', () => {
  it('crece según su contenido (scrollHeight) y no recorta el texto', () => {
    render(<Harness />);
    const field = screen.getByLabelText<HTMLTextAreaElement>('Pronóstico');
    Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 88 });
    const long = 'Más de 2.5 Manchester City Más/Menos Córners '.repeat(3).trim();
    fireEvent.change(field, { target: { value: long } });
    expect(field.value).toBe(long);
    expect(field.style.height).toBe('88px');
  });

  it('sin layout (scrollHeight 0) no colapsa el campo: conserva la altura mínima de la clase', () => {
    render(<Harness />);
    const field = screen.getByLabelText<HTMLTextAreaElement>('Pronóstico');
    fireEvent.change(field, { target: { value: 'Gana A' } });
    expect(field.style.height).toBe('auto');
    expect(field.className).toContain('min-h-10');
    expect(field.className).toContain('resize-none');
    expect(field.rows).toBe(1);
  });

  it('Enter envía el formulario sin añadir un salto de línea; Shift+Enter tampoco lo añade a mano', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const field = screen.getByLabelText<HTMLTextAreaElement>('Pronóstico');
    fireEvent.change(field, { target: { value: 'Gana A' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(field.value).toBe('Gana A');
    fireEvent.change(field, { target: { value: 'Gana\nA' } });
    expect(field.value).toBe('Gana A');
  });
});

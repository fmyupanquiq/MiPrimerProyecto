import {
  type ChangeEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
  useLayoutEffect,
  useRef,
} from 'react';
import { inputClass } from './ui.js';

/*
 * Campo de texto de una "línea lógica" que crece en vertical cuando el texto no cabe (Pronóstico,
 * Partido, Mercado): un `<input>` no puede hacer wrapping y cortaba textos reales como "Más de 2.5
 * Manchester City Más/Menos Córners". Se comporta como el input que sustituye: Enter no inserta un
 * salto de línea sino que envía el formulario (igual que Enter en un input), y un texto pegado con
 * saltos los pierde. El valor que recibe nunca se recorta ni se transforma: solo cambia cómo se
 * muestra y se edita.
 */

export type AutoGrowTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange' | 'rows'
> & {
  value: string;
  onChange: (value: string) => void;
};

export function AutoGrowTextarea({
  value,
  onChange,
  className = '',
  onKeyDown,
  ...rest
}: AutoGrowTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Antes de pintar: sin un fotograma con la altura vieja. `scrollHeight` es 0 donde no hay layout
  // (pruebas en jsdom): en ese caso se deja la altura mínima de la clase en vez de colapsarla.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      value={value}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
        onChange(event.target.value.replace(/\r?\n/g, ' '))
      }
      onKeyDown={handleKeyDown}
      className={`${inputClass} block resize-none overflow-hidden leading-snug break-words ${className}`}
    />
  );
}

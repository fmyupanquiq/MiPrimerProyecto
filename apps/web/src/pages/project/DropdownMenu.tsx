import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface DropdownItem {
  label: string;
  onSelect: () => void;
  /** Acción destructiva (p. ej. eliminar): se muestra en rojo. */
  danger?: boolean;
  /** Icono que ayuda a reconocer la acción (el texto sigue siendo el nombre). */
  icon?: ReactNode;
}

/**
 * Botón que despliega una lista de acciones (Fase 10.3: menú ⋮ y selector de estado de cada
 * apuesta). Solo agrupa botones que ya existían: cada elemento llama a la misma acción de siempre.
 * Se cierra al elegir, con Escape o al pulsar fuera.
 */
export function DropdownMenu({
  label,
  buttonContent,
  buttonClassName,
  items,
  disabled = false,
}: {
  /** Nombre accesible del botón (p. ej. "Más acciones"). */
  label: string;
  buttonContent: ReactNode;
  buttonClassName: string;
  items: DropdownItem[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Lado de anclaje del menú (Fase 11, §32): por defecto a la derecha del botón (como siempre),
  // pero si así se saldría por el borde izquierdo del viewport (botón cerca del borde en móvil,
  // p. ej. 375px), se ancla a la izquierda en su lugar.
  const [align, setAlign] = useState<'right' | 'left'>('right');
  const container = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Ancho del menú (`min-w-52` en la clase de abajo, 13rem): se mide desde el botón, no desde el
  // propio menú, para no depender del lado con el que ya se pintó la vez anterior.
  const MENU_WIDTH_PX = 208;

  // Al abrir, el foco va a la primera opción (teclado y lectores de pantalla).
  useEffect(() => {
    if (open) container.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAlign(rect.right - MENU_WIDTH_PX < 8 ? 'left' : 'right');
  }, [open]);

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    );
    const current = options.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      options[(index + options.length) % options.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(current + 1);
    else if (event.key === 'ArrowUp') move(current - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(options.length - 1);
  }

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        ref={button}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || items.length === 0}
        onClick={() => setOpen((value) => !value)}
      >
        {buttonContent}
      </button>
      {open && (
        <ul
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`absolute z-30 mt-1 min-w-52 overflow-hidden rounded-xl border border-slate-200 bg-surface py-1 shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-100 focus:bg-slate-100 focus:outline-none ${
                  item.danger ? 'text-red-700' : 'text-slate-800'
                }`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && (
                  <span className="shrink-0 opacity-80" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

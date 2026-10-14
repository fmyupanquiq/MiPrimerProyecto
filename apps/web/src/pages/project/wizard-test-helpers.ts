import { fireEvent, screen, within } from '@testing-library/react';

/*
 * Ayudas de prueba del asistente "Añadir apuesta" (rediseño de los tres pasos, ADR 0024). Los legs ya
 * no se editan en un formulario siempre visible: viven en el diálogo que abren "Editar" (un leg) o
 * "Añadir selección" (el siguiente leg vacío o uno nuevo) en "Verificar datos". `fieldFor` encuentra
 * un campo por su rótulo y, si es de un leg que no está montado, abre el diálogo de ese leg, igual
 * que lo haría una persona. Solo para pruebas.
 */

const LEG_DIALOG = /^Editar leg \d+$/;

const legNumberOf = (label: string): number | null => {
  const match = /\bleg (\d+)/.exec(label);
  return match ? Number(match[1]) : null;
};

/** Cierra el diálogo de edición de un leg si está abierto ("Listo"). */
export function closeLegDialog() {
  const dialog = screen.queryByRole('dialog', { name: LEG_DIALOG });
  if (dialog) fireEvent.click(within(dialog).getByRole('button', { name: 'Listo' }));
}

/** Abre el diálogo del leg `leg` (o el de la única selección de una Simple/Creada si es `null`). */
export function openLegDialog(form: HTMLElement, leg: number | null) {
  const open = screen.queryByRole('dialog', { name: LEG_DIALOG });
  if (open) {
    if (leg === null || open.getAttribute('aria-label') === `Editar leg ${leg}`) return;
    closeLegDialog();
  }
  const edit = within(form).queryByRole('button', { name: `Editar el leg ${leg ?? 1}` });
  if (edit) fireEvent.click(edit);
  else fireEvent.click(within(form).getByRole('button', { name: 'Añadir selección' }));
}

/** Campo por su rótulo; si es de un leg que no está montado, abre antes el diálogo de ese leg. */
export function fieldFor<T extends HTMLElement = HTMLElement>(
  form: HTMLElement,
  label: string | RegExp,
): T {
  if (within(form).queryAllByLabelText(label).length > 0) {
    return within(form).getByLabelText<T>(label);
  }
  openLegDialog(form, typeof label === 'string' ? legNumberOf(label) : null);
  return within(form).getByLabelText<T>(label);
}

/** Pulsa un botón del editor de legs (p. ej. "Convertir el leg 2 en Creada…"), abriendo su diálogo. */
export function clickLegButton(form: HTMLElement, name: string | RegExp) {
  if (within(form).queryAllByRole('button', { name }).length === 0) {
    openLegDialog(form, typeof name === 'string' ? legNumberOf(name) : null);
  }
  fireEvent.click(within(form).getByRole('button', { name }));
}

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { describeApiError } from '../api/errors.js';

interface Settled<T> {
  /** Clave y recarga a las que corresponde este resultado (detecta resultados obsoletos). */
  key: string;
  reloads: number;
  data: T | null;
  error: ApiError | Error | null;
}

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  /** Mensaje para la persona usuaria si la carga falló. */
  error: string | null;
  /** Código HTTP de un fallo de la API (p. ej. 404), si lo hubo. */
  errorStatus: number | null;
  reload: () => void;
  /** Sustituye los datos ya cargados (p. ej. tras guardar un cambio) sin volver a pedirlos. */
  setData: (data: T) => void;
}

/**
 * Carga datos de la API cuando cambia `key`. El cargador se lee en cada carga, así que basta
 * con que `key` identifique lo que se pide (p. ej. el identificador del proyecto).
 */
export function useLoad<T>(key: string, loader: () => Promise<T>): Loaded<T> {
  const [reloads, setReloads] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loader()
      .then((data) => {
        if (!cancelled) setSettled({ key, reloads, data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const failure = error instanceof Error ? error : new Error(String(error));
        setSettled({ key, reloads, data: null, error: failure });
      });
    return () => {
      cancelled = true;
    };
    // El cargador cambia en cada render; lo que identifica la petición es `key` y `reloads`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloads]);

  const setData = useCallback(
    (data: T) => setSettled({ key, reloads, data, error: null }),
    [key, reloads],
  );
  const reload = useCallback(() => setReloads((count) => count + 1), []);

  const current = settled !== null && settled.key === key && settled.reloads === reloads;
  // Mientras se recarga, se conservan los datos anteriores de la misma clave (sin parpadeo).
  const stale = settled !== null && settled.key === key ? settled : null;
  return {
    data: (current ? settled.data : stale?.data) ?? null,
    loading: !current,
    error: current && settled.error ? describeApiError(settled.error) : null,
    errorStatus: current && settled.error instanceof ApiError ? settled.error.status : null,
    reload,
    setData,
  };
}

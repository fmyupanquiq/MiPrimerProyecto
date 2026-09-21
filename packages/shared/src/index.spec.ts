import { describe, expect, it } from 'vitest';
import { SYSTEM_NAME } from './index.js';

describe('@letfer/shared', () => {
  it('expone el nombre del sistema', () => {
    expect(SYSTEM_NAME).toBe('LetFer');
  });
});

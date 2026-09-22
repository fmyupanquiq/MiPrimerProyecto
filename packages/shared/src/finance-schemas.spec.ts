import { describe, expect, it } from 'vitest';
import {
  createDepositSchema,
  createExtraordinaryMovementSchema,
  createTransferSchema,
} from './financial-movement.js';
import { projectSetupSchema } from './project-setup.js';
import { createStageSchema, correctStageUnitSchema } from './stage.js';
import { decideWithdrawalSchema, requestWithdrawalSchema } from './withdrawal.js';

const HOUSE_A = '0195f7c0-0000-7000-8000-0000000000a1';
const HOUSE_B = '0195f7c0-0000-7000-8000-0000000000b1';

describe('createDepositSchema', () => {
  it('exige un monto positivo y una casa; el motivo es opcional', () => {
    expect(createDepositSchema.safeParse({ houseId: HOUSE_A, amount: '100.00' }).success).toBe(
      true,
    );
    expect(createDepositSchema.safeParse({ houseId: HOUSE_A, amount: '0' }).success).toBe(false);
    expect(createDepositSchema.safeParse({ houseId: HOUSE_A, amount: '-1' }).success).toBe(false);
    expect(createDepositSchema.safeParse({ amount: '10' }).success).toBe(false);
  });
});

describe('createTransferSchema', () => {
  it('exige casas distintas', () => {
    const same = createTransferSchema.safeParse({
      fromHouseId: HOUSE_A,
      toHouseId: HOUSE_A,
      amount: '10.00',
    });
    expect(same.success).toBe(false);

    const different = createTransferSchema.safeParse({
      fromHouseId: HOUSE_A,
      toHouseId: HOUSE_B,
      amount: '10.00',
    });
    expect(different.success).toBe(true);
  });
});

describe('createExtraordinaryMovementSchema', () => {
  it('exige dirección y un motivo no vacío (nunca un "ajuste" genérico)', () => {
    expect(
      createExtraordinaryMovementSchema.safeParse({
        houseId: HOUSE_A,
        amount: '5.00',
        direction: 'CREDIT',
        reason: 'Cashback de la casa',
      }).success,
    ).toBe(true);
    expect(
      createExtraordinaryMovementSchema.safeParse({
        houseId: HOUSE_A,
        amount: '5.00',
        direction: 'CREDIT',
        reason: '   ',
      }).success,
    ).toBe(false);
    expect(
      createExtraordinaryMovementSchema.safeParse({
        houseId: HOUSE_A,
        amount: '5.00',
        reason: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('projectSetupSchema (D1)', () => {
  const valid = {
    unitStake: '10.00',
    houses: [
      { name: 'Betano', initialAmount: '500.00' },
      { name: 'Betsafe', initialAmount: '0' },
    ],
  };

  it('acepta una configuración válida (una casa puede arrancar en cero, §15)', () => {
    expect(projectSetupSchema.safeParse(valid).success).toBe(true);
  });

  it('exige al menos una casa', () => {
    expect(projectSetupSchema.safeParse({ ...valid, houses: [] }).success).toBe(false);
  });

  it('rechaza nombres de casa repetidos (sin distinguir mayúsculas ni espacios)', () => {
    const result = projectSetupSchema.safeParse({
      ...valid,
      houses: [
        { name: 'Betano', initialAmount: '100' },
        { name: '  betano  ', initialAmount: '0' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('la unidad debe ser positiva', () => {
    expect(projectSetupSchema.safeParse({ ...valid, unitStake: '0' }).success).toBe(false);
  });

  it('un monto inicial negativo se rechaza', () => {
    const result = projectSetupSchema.safeParse({
      ...valid,
      houses: [{ name: 'Betano', initialAmount: '-10' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('createStageSchema / correctStageUnitSchema', () => {
  it('el nombre es opcional (se autogenera "Etapa N"); la unidad es obligatoria y positiva', () => {
    expect(createStageSchema.safeParse({ unitStake: '10.00' }).success).toBe(true);
    expect(
      createStageSchema.safeParse({ name: 'Etapa de verano', unitStake: '10.00' }).success,
    ).toBe(true);
    expect(createStageSchema.safeParse({ unitStake: '0' }).success).toBe(false);
    expect(createStageSchema.safeParse({}).success).toBe(false);
  });

  it('la corrección de unidad exige confirmar explícitamente para aplicarse (por defecto es vista previa)', () => {
    const preview = correctStageUnitSchema.parse({ unitStake: '15.00' });
    expect(preview.confirm).toBe(false);
    const applied = correctStageUnitSchema.parse({ unitStake: '15.00', confirm: true });
    expect(applied.confirm).toBe(true);
  });
});

describe('requestWithdrawalSchema / decideWithdrawalSchema', () => {
  it('un retiro exige motivo (§16.2)', () => {
    expect(
      requestWithdrawalSchema.safeParse({ houseId: HOUSE_A, amount: '50.00', reason: 'Pago' })
        .success,
    ).toBe(true);
    expect(
      requestWithdrawalSchema.safeParse({ houseId: HOUSE_A, amount: '50.00', reason: '' }).success,
    ).toBe(false);
  });

  it('decidir un retiro exige la versión leída por el cliente', () => {
    expect(decideWithdrawalSchema.safeParse({ version: 1 }).success).toBe(true);
    expect(decideWithdrawalSchema.safeParse({}).success).toBe(false);
    expect(decideWithdrawalSchema.safeParse({ version: 0 }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { allocateExtra, currentCycle, recommend, splitDecimo, type RecoInput } from './recommend';

const close = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

const params = { dailyLivingBudget: 12.5, colchonTarget: 300, abonoMin: 20, abonoSafetyPct: 0.2, abonoRound: 5 };

describe('recommend (5.5)', () => {
  it('6-nov-2026: sobrante 11,23 · abono 0 · tope diario 12,97', () => {
    const input: RecoInput = {
      ...params,
      today: '2026-11-06',
      balance: 963.66,
      nextPayday: '2026-11-30',
      pending: [
        { name: 'Pensión', due: null, amount: 50 },
        { name: 'Luz', due: null, amount: 50 },
        { name: 'Produbanco', due: '2026-11-16', amount: 252.43 },
      ],
      savingPendingThisCycle: 0,
    };
    const r = recommend(input);
    expect(r.days).toBe(24);
    close(r.safeSurplus, 11.23);
    expect(r.abono).toBe(0);
    close(r.dailyCap, 12.97);
    expect(r.capBelowPlan).toBe(false);
  });

  it('30-nov-2026 con sueldo: sobrante 355,74 · abono 280 · tope diario 14,94', () => {
    const r = recommend({
      ...params,
      today: '2026-11-30',
      balance: 1724.88,
      nextPayday: '2026-12-31',
      pending: [
        { name: 'Diners', due: '2026-12-05', amount: 213.06 },
        { name: 'Produbanco', due: '2026-12-16', amount: 233.58 },
        { name: 'Pensión', due: null, amount: 50 },
        { name: 'Luz', due: null, amount: 50 },
        { name: 'Internet', due: null, amount: 25 },
        { name: 'Agua', due: null, amount: 10 },
      ],
      savingPendingThisCycle: 100,
    });
    expect(r.days).toBe(31);
    close(r.safeSurplus, 355.74);
    close(r.gross, 284.59);
    expect(r.abono).toBe(280);
    close(r.dailyCap, 14.94);
  });

  it('lo que vence el día del sueldo no cuenta como obligación', () => {
    const r = recommend({ ...params, today: '2026-11-06', balance: 1000, nextPayday: '2026-11-30', pending: [{ name: 'X', due: '2026-11-30', amount: 500 }], savingPendingThisCycle: 0 });
    expect(r.obligations).toBe(0);
  });

  it('con déficit: abono 0, deficit positivo y aviso si el tope queda bajo el planificado', () => {
    const r = recommend({ ...params, today: '2026-11-06', balance: 600, nextPayday: '2026-11-30', pending: [], savingPendingThisCycle: 0 });
    expect(r.abono).toBe(0);
    close(r.deficit, 300 + 300 - 600);
    close(r.dailyCap, 300 / 24);
    expect(r.capBelowPlan).toBe(false);
    const r2 = recommend({ ...params, today: '2026-11-06', balance: 500, nextPayday: '2026-11-30', pending: [], savingPendingThisCycle: 0 });
    expect(r2.capBelowPlan).toBe(true);
  });
});

describe('a qué tarjeta va el abono', () => {
  const debts = [
    { id: 'p', name: 'Produbanco', kind: 'loan' as const, balance: 6681.25, payoffPriority: 20 },
    { id: 't', name: 'Titanium', kind: 'revolving' as const, balance: 579.47, payoffPriority: 10 },
    { id: 'd', name: 'Discover', kind: 'fixed_installments' as const, balance: 1499.58, payoffPriority: 5 },
  ];
  it('280 va todo a Titanium', () => {
    expect(allocateExtra(280, debts)).toEqual([{ debtId: 't', name: 'Titanium', amount: 280 }]);
  });
  it('si supera el saldo de Titanium, el resto va a Produbanco; nunca a Discover', () => {
    const r = allocateExtra(700, debts);
    expect(r.map((x) => x.debtId)).toEqual(['t', 'p']);
    close(r[1].amount, 700 - 579.47);
  });
});

describe('ciclo de sueldo', () => {
  it('6-nov sin sueldo: cobro el 30-nov, ciclo desde el 31-oct sin sueldo registrado', () => {
    expect(currentCycle('2026-11-06', 'last_day', null, [])).toEqual({ start: '2026-10-31', nextPayday: '2026-11-30', salaryRegistered: false });
  });
  it('30-nov con el sueldo registrado: el próximo cobro es el 31-dic', () => {
    expect(currentCycle('2026-11-30', 'last_day', null, ['2026-11-30'])).toEqual({ start: '2026-11-30', nextPayday: '2026-12-31', salaryRegistered: true });
  });
  it('30-nov sin sueldo todavía: el cobro es hoy', () => {
    expect(currentCycle('2026-11-30', 'last_day', null, []).nextPayday).toBe('2026-11-30');
  });
  it('a mitad de diciembre recuerda el sueldo del 30-nov', () => {
    expect(currentCycle('2026-12-10', 'last_day', null, ['2026-11-30'])).toEqual({ start: '2026-11-30', nextPayday: '2026-12-31', salaryRegistered: true });
  });
  it('día fijo 15', () => {
    expect(currentCycle('2026-11-20', 'fixed_day', 15, []).nextPayday).toBe('2026-12-15');
  });
});

describe('décimos (regla 10)', () => {
  it('décimo tercero 1.413,65 al 50 %: 706,83 a deuda, luego colchón y ahorro', () => {
    const r = splitDecimo(1413.65, 0.5, 300);
    close(r.abono, 706.83);
    close(r.toColchon, 300);
    close(r.toSaving, 1413.65 - 706.83 - 300);
  });
});

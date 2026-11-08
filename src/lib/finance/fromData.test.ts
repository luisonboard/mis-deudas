import { describe, expect, it } from 'vitest';
import type { Debt, FixedExpense, FixedExpensePayment, Income, Payment, Settings } from '../types';
import { buildDailyReco, buildPlanInput, type RecoData } from './fromData';
import { basePlanInput, simulatePlan } from './simulate';

const close = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const u = 'user';

/** Filas equivalentes a seed.sql. */
const debt = (o: Partial<Debt> & Pick<Debt, 'id' | 'name' | 'kind'>): Debt => ({
  user_id: u, lender: null, initial_balance: 0, current_balance: 0, annual_rate: 0, monthly_payment: 0, min_payment: null,
  term_months: null, first_payment_date: null, due_day: null, payoff_priority: 100, one_off_first_month: 0, status: 'active',
  notes: null, created_at: '', ...o,
});
const debts: Debt[] = [
  debt({ id: 'p', name: 'Produbanco', kind: 'loan', initial_balance: 6681.25, current_balance: 6681.25, annual_rate: 0.156, monthly_payment: 233.58, term_months: 36, first_payment_date: '2026-11-16', due_day: 16, payoff_priority: 20, one_off_first_month: 18.85 }),
  debt({ id: 't', name: 'Diners Titanium', kind: 'revolving', initial_balance: 579.47, current_balance: 579.47, annual_rate: 0.156, min_payment: 46.44, first_payment_date: '2026-12-05', due_day: 5, payoff_priority: 10 }),
  debt({ id: 'd', name: 'Diners Discover', kind: 'fixed_installments', initial_balance: 1499.58, current_balance: 1499.58, monthly_payment: 166.62, term_months: 9, first_payment_date: '2026-12-05', due_day: 5, payoff_priority: 30 }),
];
const settings: Settings = {
  user_id: u, monthly_income: 1413.65, decimo_tercero: 1413.65, decimo_cuarto: 482, decimos_pct_to_debt: 0.5, extra_monthly: 300,
  extra_start_month: '2026-11-01', payday_rule: 'last_day', payday_day: null, daily_living_budget: 12.5, colchon_target: 300,
  monthly_saving_target: 100, abono_min: 20, abono_safety_pct: 0.2, abono_round: 5, timezone: 'America/Guayaquil', updated_at: '',
};
const fixed: FixedExpense[] = [
  ['pen', 'Pensión del hijo', 50], ['luz', 'Electricidad', 50], ['int', 'Internet', 25], ['agua', 'Agua', 10],
].map(([id, name, amount]) => ({ id: id as string, user_id: u, name: name as string, amount: amount as number, due_day: null, active: true, created_at: '' }));
const fp = (expense_id: string, month: string): FixedExpensePayment => ({ id: `${expense_id}-${month}`, user_id: u, expense_id, month, paid_on: month, amount: 1, created_at: '' });

describe('buildPlanInput con los datos iniciales', () => {
  it('reproduce los vectores 5.4 el 6-nov-2026', () => {
    const input = buildPlanInput(debts, [], settings, '2026-11-06');
    expect(input.debts.map((x) => [x.id, x.firstPayMonthIndex, x.oneOffFirstMonth])).toEqual([
      ['p', 1, 18.85], ['t', 2, 0], ['d', 2, 0],
    ]);
    const plan = simulatePlan(input);
    expect([plan.monthsToZero, plan.debtFreeMonth]).toEqual([13, '2027-11']);
    close(plan.totalInterest, 618.55);
    const base = simulatePlan(basePlanInput(input));
    expect([base.monthsToZero, base.debtFreeMonth]).toEqual([36, '2029-10']);
  });

  it('slider: extra 0 → oct-2029, extra 300 → nov-2027 (criterio de aceptación)', () => {
    const r0 = simulatePlan(buildPlanInput(debts, [], settings, '2026-11-06', { extraMonthly: 0, decimosPct: 0 }));
    const r300 = simulatePlan(buildPlanInput(debts, [], settings, '2026-11-06', { extraMonthly: 300 }));
    expect(r0.debtFreeMonth).toBe('2029-10');
    expect(r300.debtFreeMonth).toBe('2027-11');
  });

  it('si la cuota de este mes ya se pagó, empieza en el mes 2 y sin cargo único', () => {
    const pay: Payment = { id: 'x', user_id: u, debt_id: 'p', paid_on: '2026-11-16', amount: 252.43, kind: 'regular', interest_part: 86.86, principal_part: 146.72, note: null, created_at: '' };
    const input = buildPlanInput(debts, [pay], settings, '2026-11-20');
    expect(input.debts[0]).toMatchObject({ id: 'p', firstPayMonthIndex: 2, oneOffFirstMonth: 0 });
  });
});

describe('buildDailyReco (vectores 5.5 a partir de filas)', () => {
  const base: Omit<RecoData, 'today' | 'balance'> = {
    settings, debts, payments: [], incomes: [], fixed, fixedPayments: [], movements: [], colchonBalance: 0,
  };

  it('6-nov-2026: pendientes pensión, luz y Produbanco 252,43 → abono 0, tope 12,97', () => {
    // Internet y agua de noviembre ya estaban pagados en el escenario del documento.
    const r = buildDailyReco({ ...base, today: '2026-11-06', balance: 963.66, fixedPayments: [fp('int', '2026-11-01'), fp('agua', '2026-11-01')] });
    expect(r.cycle.nextPayday).toBe('2026-11-30');
    expect(r.savingPending).toBe(0);
    close(r.reco.obligations, 352.43);
    close(r.reco.safeSurplus, 11.23);
    expect(r.reco.abono).toBe(0);
    close(r.reco.dailyCap, 12.97);
    expect(r.targets).toEqual([]);
  });

  it('30-nov-2026 con sueldo registrado: abono 280 a Titanium, tope 14,94', () => {
    const salary: Income = { id: 's', user_id: u, received_on: '2026-11-30', amount: 1413.65, kind: 'salary', note: null, created_at: '' };
    const prod: Payment = { id: 'p1', user_id: u, debt_id: 'p', paid_on: '2026-11-16', amount: 252.43, kind: 'regular', interest_part: 86.86, principal_part: 146.72, note: null, created_at: '' };
    const novPaid = fixed.map((f) => fp(f.id, '2026-11-01'));
    const r = buildDailyReco({
      ...base,
      today: '2026-11-30',
      balance: 1724.88,
      debts: debts.map((x) => (x.id === 'p' ? { ...x, current_balance: 6534.53 } : x)),
      payments: [prod],
      incomes: [salary],
      fixedPayments: novPaid,
    });
    expect(r.cycle.nextPayday).toBe('2026-12-31');
    expect(r.savingPending).toBe(100);
    close(r.reco.obligations, 213.06 + 233.58 + 135);
    close(r.reco.safeSurplus, 355.74);
    expect(r.reco.abono).toBe(280);
    close(r.reco.dailyCap, 14.94);
    expect(r.targets).toEqual([{ debtId: 't', name: 'Diners Titanium', amount: 280 }]);
  });

  it('décimo tercero recibido: sugiere 50 % a deuda hasta registrar el abono', () => {
    const dec: Income = { id: 'dt', user_id: u, received_on: '2026-12-20', amount: 1413.65, kind: 'decimo_tercero', note: null, created_at: '' };
    const salary: Income = { id: 's', user_id: u, received_on: '2026-11-30', amount: 1413.65, kind: 'salary', note: null, created_at: '' };
    const r = buildDailyReco({ ...base, today: '2026-12-20', balance: 2500, incomes: [salary, dec], colchonBalance: 100 });
    expect(r.decimo).not.toBeNull();
    close(r.decimo!.abono, 706.83);
    close(r.decimo!.toColchon, 200);
    expect(r.decimo!.targets[0].debtId).toBe('t');

    const paid: Payment = { id: 'e', user_id: u, debt_id: 't', paid_on: '2026-12-20', amount: 706.83, kind: 'extra', interest_part: 0, principal_part: 579.47, note: null, created_at: '' };
    expect(buildDailyReco({ ...base, today: '2026-12-20', balance: 1800, incomes: [salary, dec], payments: [paid] }).decimo).toBeNull();
  });
});

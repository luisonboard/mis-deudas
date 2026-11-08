import { describe, expect, it } from 'vitest';
import { basePlanInput, simulatePlan, type PlanInput } from './simulate';

const close = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

/** Datos iniciales de la sección 4, empezando en noviembre de 2026. */
const plan: PlanInput = {
  startMonth: '2026-11',
  debts: [
    { id: 'produbanco', name: 'Produbanco', kind: 'loan', balance: 6681.25, annualRate: 0.156, monthlyPayment: 233.58, payoffPriority: 20, firstPayMonthIndex: 1, oneOffFirstMonth: 18.85 },
    { id: 'titanium', name: 'Diners Titanium', kind: 'revolving', balance: 579.47, annualRate: 0.156, monthlyPayment: 0, minPayment: 46.44, payoffPriority: 10, firstPayMonthIndex: 2 },
    { id: 'discover', name: 'Diners Discover', kind: 'fixed_installments', balance: 1499.58, annualRate: 0, monthlyPayment: 166.62, payoffPriority: 30, firstPayMonthIndex: 2 },
  ],
  extraMonthly: 300,
  extraStartIndex: 1,
  decimoTercero: 1413.65,
  decimoCuarto: 482,
  decimosPct: 0.5,
  maxMonths: 84,
};

describe('simulatePlan (5.3 / 5.4)', () => {
  it('plan base: 36 meses, libre en oct-2029, interés 1.793,41, total 10.572,56', () => {
    const r = simulatePlan(basePlanInput(plan));
    expect(r.monthsToZero).toBe(36);
    expect(r.debtFreeMonth).toBe('2029-10');
    close(r.totalInterest, 1793.41);
    close(r.totalPaid, 10572.56);
  });

  it('plan con abono de 300 y décimos al 50 %: 13 meses, nov-2027, interés 618,55, total 9.397,70', () => {
    const r = simulatePlan(plan);
    expect(r.monthsToZero).toBe(13);
    expect(r.debtFreeMonth).toBe('2027-11');
    close(r.totalInterest, 618.55);
    close(r.totalPaid, 9397.7);
  });

  it('el extra va primero a Titanium y nunca a las cuotas fijas', () => {
    const r = simulatePlan(plan);
    const m1 = r.months[0];
    close(m1.perDebt.titanium.extra, 300);
    expect(m1.perDebt.produbanco.extra).toBe(0);
    expect(r.months.every((m) => m.perDebt.discover.extra === 0)).toBe(true);
  });

  it('el décimo tercero entra en diciembre y el cuarto en marzo', () => {
    const r = simulatePlan({ ...plan, extraMonthly: 0 });
    const extraOf = (m: string) => {
      const row = r.months.find((x) => x.month === m)!;
      return Object.values(row.perDebt).reduce((s, d) => s + d.extra, 0);
    };
    close(extraOf('2026-12'), 706.825);
    close(extraOf('2027-03'), 241);
    expect(extraOf('2027-01')).toBe(0);
  });

  it('el cargo único suma al total pagado del mes 1, no al capital', () => {
    const r = simulatePlan(basePlanInput(plan));
    const m1 = r.months[0];
    close(m1.totalPaid, 233.58 + 18.85);
    close(m1.perDebt.produbanco.balanceEnd, 6681.25 * 1.013 - 233.58);
  });

  it('sin deudas: 0 meses', () => {
    const r = simulatePlan({ ...plan, debts: [] });
    expect(r.monthsToZero).toBe(0);
  });
});

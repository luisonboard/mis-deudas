import { describe, expect, it } from 'vitest';
import { pmt } from './pmt';
import { amortizationSchedule, suggestedInterest } from './schedule';
import { estimateSpend } from './daily';
import { nextFixedExpenses, nextPayments, type NextPaymentDebt } from './nextPayment';

const close = (a: number, b: number, tol = 0.01) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('pmt (5.1 / 5.4)', () => {
  it('novación Produbanco: 6.681,25 · 15,6 % · 36 meses = 233,58', () => {
    close(pmt(6681.25, 0.156, 36), 233.58);
  });

  it('tasa cero reparte el capital', () => {
    expect(pmt(1200, 0, 12)).toBe(100);
  });

  it('total a pagar de la novación: 36 × 233,58 = 8.408,88; interés ≈ 1.727,6', () => {
    const total = 36 * 233.58;
    close(total, 8408.88);
    expect(Math.abs(total - 6681.25 - 1727.6)).toBeLessThan(0.1);
  });
});

describe('cronograma (5.2)', () => {
  it('la novación se paga en 36 cuotas', () => {
    const rows = amortizationSchedule(6681.25, 0.156, 233.58);
    expect(rows).toHaveLength(36);
    close(rows[0].interest, 6681.25 * 0.013);
    expect(rows[35].balanceEnd).toBeLessThanOrEqual(0.005);
    const interest = rows.reduce((s, r) => s + r.interest, 0);
    expect(Math.abs(interest - 1727.6)).toBeLessThan(0.5);
  });

  it('se detiene si la cuota no cubre el interés', () => {
    expect(amortizationSchedule(1000, 0.24, 10)).toHaveLength(0);
  });

  it('interés sugerido: saldo × tasa / 12; cero en cuotas fijas', () => {
    close(suggestedInterest(579.47, 0.156, 'revolving'), 7.53);
    expect(suggestedInterest(1499.58, 0, 'fixed_installments')).toBe(0);
  });
});

describe('gasto estimado (5.5)', () => {
  const empty = { incomes: [], debtPayments: [], fixedPayments: [], savingsFromAccount: [] };

  it('check-in 6-nov 963,66 → 7-nov 951,16 sin movimientos = 12,50', () => {
    const r = estimateSpend({
      prev: { date: '2026-11-06', balance: 963.66 },
      curr: { date: '2026-11-07', balance: 951.16 },
      ...empty,
    });
    close(r.estimated, 12.5);
    expect(r.days).toBe(1);
    expect(r.suspicious).toBe(false);
  });

  it('descuenta pagos e ingresos dentro del intervalo y divide por días', () => {
    const r = estimateSpend({
      prev: { date: '2026-11-06', balance: 963.66 },
      curr: { date: '2026-11-08', balance: 600 },
      incomes: [{ date: '2026-11-07', amount: 100 }],
      debtPayments: [{ date: '2026-11-07', amount: 252.43 }, { date: '2026-11-06', amount: 999 }],
      fixedPayments: [{ date: '2026-11-08', amount: 50 }],
      savingsFromAccount: [{ date: '2026-11-08', amount: 100 }],
    });
    close(r.estimated, 963.66 + 100 - 252.43 - 50 - 100 - 600);
    close(r.perDay, r.estimated / 2);
  });

  it('avisa cuando el resultado es negativo', () => {
    const r = estimateSpend({
      prev: { date: '2026-11-06', balance: 100 },
      curr: { date: '2026-11-07', balance: 500 },
      ...empty,
    });
    expect(r.suspicious).toBe(true);
  });
});

describe('próximo pago', () => {
  const debts: NextPaymentDebt[] = [
    { id: 'p', name: 'Produbanco', kind: 'loan', status: 'active', currentBalance: 6681.25, monthlyPayment: 233.58, minPayment: null, dueDay: 16, firstPaymentDate: '2026-11-16', oneOffFirstMonth: 18.85 },
    { id: 't', name: 'Titanium', kind: 'revolving', status: 'active', currentBalance: 579.47, monthlyPayment: 0, minPayment: 46.44, dueDay: 5, firstPaymentDate: '2026-12-05', oneOffFirstMonth: 0 },
    { id: 'd', name: 'Discover', kind: 'fixed_installments', status: 'active', currentBalance: 1499.58, monthlyPayment: 166.62, minPayment: null, dueDay: 5, firstPaymentDate: '2026-12-05', oneOffFirstMonth: 0 },
  ];

  it('el 6-nov-2026 el próximo es Produbanco 252,43 el 16-nov (10 días)', () => {
    const [first, ...rest] = nextPayments(debts, '2026-11-06', {});
    expect(first.debtId).toBe('p');
    expect(first.due).toBe('2026-11-16');
    close(first.amount, 252.43);
    expect(first.daysLeft).toBe(10);
    expect(rest.map((r) => r.due)).toEqual(['2026-12-05', '2026-12-05']);
  });

  it('si ya se pagó la cuota, salta al mes siguiente sin el cargo único', () => {
    const [first] = nextPayments([debts[0]], '2026-11-10', { p: ['2026-11-10'] });
    expect(first.due).toBe('2026-12-16');
    close(first.amount, 233.58);
  });

  it('ignora deudas pagadas', () => {
    expect(nextPayments([{ ...debts[1], status: 'paid' }], '2026-11-06', {})).toHaveLength(0);
  });
});

describe('gastos fijos pendientes', () => {
  const fx = [
    { id: 'pen', name: 'Pensión', amount: 50, dueDay: null, active: true },
    { id: 'luz', name: 'Luz', amount: 50, dueDay: 20, active: true },
    { id: 'int', name: 'Internet', amount: 25, dueDay: 5, active: true },
    { id: 'old', name: 'Gym', amount: 30, dueDay: 1, active: false },
  ];

  it('muestra los no pagados del mes; los vencidos con días negativos', () => {
    const r = nextFixedExpenses(fx, '2026-11-08', {});
    expect(r.map((x) => [x.expenseId, x.due, x.daysLeft])).toEqual([
      ['pen', null, null],
      ['luz', '2026-11-20', 12],
      ['int', '2026-11-05', -3],
    ]);
  });

  it('si ya se pagó este mes: pasa al próximo mes, o desaparece si no tiene día', () => {
    const paid = { pen: ['2026-11-01'], int: ['2026-11-01'] };
    const r = nextFixedExpenses(fx, '2026-11-08', paid);
    expect(r.map((x) => [x.expenseId, x.month, x.due])).toEqual([
      ['luz', '2026-11', '2026-11-20'],
      ['int', '2026-12', '2026-12-05'],
    ]);
  });
});

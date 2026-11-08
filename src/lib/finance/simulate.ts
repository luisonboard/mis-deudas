import { addMonths } from '../dates';
import { monthlyRate } from './pmt';

export interface DebtInput {
  id: string;
  name: string;
  kind: 'loan' | 'revolving' | 'fixed_installments';
  balance: number;
  annualRate: number;
  monthlyPayment: number;
  minPayment?: number | null;
  payoffPriority: number;
  firstPayMonthIndex: number; // 1 = mes de inicio de la simulación
  oneOffFirstMonth?: number; // 18.85 en Produbanco
}

export interface PlanInput {
  startMonth: string; // '2026-11'
  debts: DebtInput[];
  extraMonthly: number;
  extraStartIndex: number; // 1
  decimoTercero: number;
  decimoCuarto: number;
  decimosPct: number;
  maxMonths: number; // 84
}

export interface MonthRow {
  index: number;
  month: string;
  perDebt: Record<string, { interest: number; base: number; extra: number; balanceEnd: number }>;
  totalPaid: number;
  totalDebtEnd: number;
}

export interface PlanResult {
  months: MonthRow[];
  monthsToZero: number | null;
  debtFreeMonth: string | null;
  totalInterest: number;
  totalPaid: number;
}

const EPS = 0.005;
const receivesExtra = (k: DebtInput['kind']) => k === 'loan' || k === 'revolving';

/** Simulación mes a mes del plan de pagos (sección 5.3). */
export function simulatePlan(input: PlanInput): PlanResult {
  const balances: Record<string, number> = {};
  for (const d of input.debts) balances[d.id] = Math.max(d.balance, 0);
  const byPriority = [...input.debts].filter((d) => receivesExtra(d.kind)).sort((a, b) => a.payoffPriority - b.payoffPriority);

  const months: MonthRow[] = [];
  let totalInterest = 0;
  let totalPaid = 0;
  let monthsToZero: number | null = null;
  let debtFreeMonth: string | null = null;

  const initialDebt = input.debts.reduce((s, d) => s + Math.max(d.balance, 0), 0);
  if (initialDebt <= EPS) {
    return { months, monthsToZero: 0, debtFreeMonth: null, totalInterest: 0, totalPaid: 0 };
  }

  for (let index = 1; index <= input.maxMonths; index++) {
    const month = addMonths(input.startMonth, index - 1);
    const calMonth = Number(month.slice(5, 7));
    const perDebt: MonthRow['perDebt'] = {};
    let paid = 0;

    // 1–2. Interés y pago base
    for (const d of input.debts) {
      const bal = balances[d.id];
      if (bal <= EPS) {
        perDebt[d.id] = { interest: 0, base: 0, extra: 0, balanceEnd: 0 };
        continue;
      }
      const interest = d.kind === 'fixed_installments' ? 0 : bal * monthlyRate(d.annualRate);
      let base = 0;
      if (index >= d.firstPayMonthIndex) {
        if (d.kind === 'loan') base = Math.min(d.monthlyPayment, bal + interest);
        else if (d.kind === 'revolving') base = Math.min(d.minPayment ?? 0, bal + interest);
        else base = Math.min(d.monthlyPayment, bal);
      }
      // 5. Cargo único en el primer mes de pago: suma al total pagado, no al capital.
      if (index === d.firstPayMonthIndex && d.oneOffFirstMonth) paid += d.oneOffFirstMonth;
      perDebt[d.id] = { interest, base, extra: 0, balanceEnd: bal + interest - base };
      if (d.kind !== 'fixed_installments') totalInterest += interest;
      paid += base;
    }

    // 3. Extra del mes
    let extra = index >= input.extraStartIndex ? input.extraMonthly : 0;
    if (calMonth === 12) extra += input.decimoTercero * input.decimosPct;
    if (calMonth === 3) extra += input.decimoCuarto * input.decimosPct;

    // 4. Cascada por prioridad (solo loan y revolving)
    for (const d of byPriority) {
      if (extra <= EPS) break;
      const row = perDebt[d.id];
      const room = row.balanceEnd;
      if (room <= EPS) continue;
      const applied = Math.min(extra, room);
      row.extra = applied;
      row.balanceEnd -= applied;
      extra -= applied;
      paid += applied;
    }

    let totalDebtEnd = 0;
    for (const d of input.debts) {
      const row = perDebt[d.id];
      if (row.balanceEnd < EPS) row.balanceEnd = 0;
      balances[d.id] = row.balanceEnd;
      totalDebtEnd += row.balanceEnd;
    }
    totalPaid += paid;
    months.push({ index, month, perDebt, totalPaid: paid, totalDebtEnd });

    // 6. Fin
    if (totalDebtEnd <= EPS) {
      monthsToZero = index;
      debtFreeMonth = month;
      break;
    }
  }

  return { months, monthsToZero, debtFreeMonth, totalInterest, totalPaid };
}

/** El mismo plan sin abono extra ni décimos ("base"). */
export function basePlanInput(input: PlanInput): PlanInput {
  return { ...input, extraMonthly: 0, decimoTercero: 0, decimoCuarto: 0, decimosPct: 0 };
}

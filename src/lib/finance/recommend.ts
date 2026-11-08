import { addDays, addMonths, dateInMonth, daysBetween, lastDayOfMonth, monthOf } from '../dates';

// ───────────── Ciclo de sueldo ─────────────

export type PaydayRule = 'last_day' | 'fixed_day';

export function paydayInMonth(ym: string, rule: PaydayRule, day: number | null): string {
  return rule === 'last_day' || !day ? lastDayOfMonth(`${ym}-01`) : dateInMonth(ym, day);
}

export interface Cycle {
  /** Inicio del ciclo actual (día de cobro anterior o el día en que llegó el sueldo). */
  start: string;
  /** Próximo día de cobro. */
  nextPayday: string;
  /** true si el sueldo que abre este ciclo ya está registrado. */
  salaryRegistered: boolean;
}

/** Días antes del día de cobro en que un sueldo cuenta como "ya llegó" (depósito adelantado). */
const EARLY_SALARY_DAYS = 5;

/**
 * Próximo día de cobro: el de este mes; si hoy ya se registró el sueldo de ese
 * día (o se adelantó hasta 5 días), el del mes siguiente.
 */
export function currentCycle(today: string, rule: PaydayRule, day: number | null, salaryDates: string[]): Cycle {
  let p = paydayInMonth(monthOf(today), rule, day);
  if (p < today) p = paydayInMonth(addMonths(monthOf(today), 1), rule, day);
  const arrived = salaryDates.filter((d) => d <= today && d >= addDays(p, -EARLY_SALARY_DAYS)).sort();
  if (arrived.length > 0) {
    return { start: arrived[0], nextPayday: paydayInMonth(addMonths(monthOf(p), 1), rule, day), salaryRegistered: true };
  }
  const prev = paydayInMonth(addMonths(monthOf(p), -1), rule, day);
  const salaryRegistered = salaryDates.some((d) => d <= today && d >= addDays(prev, -EARLY_SALARY_DAYS));
  return { start: prev, nextPayday: p, salaryRegistered };
}

// ───────────── Recomendación de abono (5.5) ─────────────

export interface Pending {
  name: string;
  /** null = sin fecha: se asume que vence dentro del ciclo. */
  due: string | null;
  amount: number;
}

export interface RecoInput {
  today: string;
  balance: number;
  nextPayday: string;
  pending: Pending[];
  dailyLivingBudget: number;
  colchonTarget: number;
  savingPendingThisCycle: number;
  abonoMin: number;
  abonoSafetyPct: number;
  abonoRound: number;
}

export interface RecoTarget {
  debtId: string;
  name: string;
  amount: number;
}

export interface RecoResult {
  days: number;
  obligations: number;
  obligationsList: Pending[];
  livingCost: number;
  safeSurplus: number;
  /** Abono antes de redondear (sobrante × (1 − margen)); 0 si hay déficit. */
  gross: number;
  abono: number;
  deficit: number;
  dailyCap: number;
  /** true si el tope diario disponible queda por debajo del tope planificado. */
  capBelowPlan: boolean;
}

export function recommend(input: RecoInput): RecoResult {
  const days = Math.max(daysBetween(input.today, input.nextPayday), 1);
  // Lo que vence el mismo día del sueldo se paga con el sueldo.
  const obligationsList = input.pending.filter((p) => p.due === null || p.due < input.nextPayday);
  const obligations = obligationsList.reduce((s, p) => s + p.amount, 0);
  const livingCost = days * input.dailyLivingBudget;
  const safeSurplus = input.balance - obligations - livingCost - input.colchonTarget - input.savingPendingThisCycle;

  let abono = 0;
  let gross = 0;
  let deficit = 0;
  if (safeSurplus < 0) {
    deficit = -safeSurplus;
  } else {
    gross = safeSurplus * (1 - input.abonoSafetyPct);
    const step = input.abonoRound > 0 ? input.abonoRound : 1;
    abono = Math.floor(gross / step + 1e-9) * step;
    if (abono < input.abonoMin) abono = 0;
  }
  const dailyCap = (input.balance - obligations - input.colchonTarget - input.savingPendingThisCycle - abono) / days;
  return {
    days,
    obligations,
    obligationsList,
    livingCost,
    safeSurplus,
    gross,
    abono,
    deficit,
    dailyCap,
    capBelowPlan: dailyCap < input.dailyLivingBudget - 0.005,
  };
}

export interface ExtraDebt {
  id: string;
  name: string;
  kind: 'loan' | 'revolving' | 'fixed_installments';
  balance: number;
  payoffPriority: number;
}

/** A qué deudas va un abono: prioridad ascendente, solo loan y revolving, hasta su saldo. */
export function allocateExtra(amount: number, debts: ExtraDebt[]): RecoTarget[] {
  const out: RecoTarget[] = [];
  let left = amount;
  for (const d of [...debts].filter((x) => x.kind !== 'fixed_installments' && x.balance > 0.005).sort((a, b) => a.payoffPriority - b.payoffPriority)) {
    if (left <= 0.005) break;
    const a = Math.min(left, d.balance);
    out.push({ debtId: d.id, name: d.name, amount: a });
    left -= a;
  }
  return out;
}

/**
 * Décimos (regla 10): monto × % va a deuda (sin margen de seguridad); el resto
 * va primero al colchón (lo que le falte) y luego al ahorro.
 */
export function splitDecimo(amount: number, pctToDebt: number, colchonMissing: number) {
  const abono = Math.round(amount * pctToDebt * 100) / 100;
  const rest = amount - abono;
  const toColchon = Math.min(rest, Math.max(colchonMissing, 0));
  return { abono, toColchon, toSaving: rest - toColchon };
}

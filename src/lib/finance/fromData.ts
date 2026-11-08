/**
 * Traduce las filas de Supabase a las entradas de las funciones puras
 * (simulatePlan, recommend). Todo es puro y se prueba sin red.
 */
import { addDays, addMonths, dateInMonth, monthOf, monthsBetween } from '../dates';
import type { Debt, FixedExpense, FixedExpensePayment, Income, Payment, SavingsMovement, Settings } from '../types';
import { nextPayments } from './nextPayment';
import { allocateExtra, currentCycle, recommend, splitDecimo, type Cycle, type Pending, type RecoResult, type RecoTarget } from './recommend';
import type { PlanInput } from './simulate';

export interface PlanOverrides {
  extraMonthly?: number;
  extraStartMonth?: string | null; // 'YYYY-MM'
  decimosPct?: number;
  priorities?: Record<string, number>;
}

/** Deudas que siguen vivas (activas y con saldo). */
const live = (debts: Debt[]) => debts.filter((d) => d.status === 'active' && d.current_balance > 0.005);

/**
 * Plan desde el mes actual con los saldos actuales.
 * - Primer mes de pago: el de first_payment_date (mínimo el mes 1). Si ya hay un pago
 *   regular registrado este mes, la cuota de este mes se da por pagada (empieza en el mes 2).
 * - El cargo único solo se cuenta si su primer pago todavía no se hizo.
 */
export function buildPlanInput(
  debts: Debt[],
  payments: Payment[],
  settings: Pick<Settings, 'extra_monthly' | 'extra_start_month' | 'decimo_tercero' | 'decimo_cuarto' | 'decimos_pct_to_debt'> | null,
  today: string,
  o: PlanOverrides = {},
): PlanInput {
  const startMonth = monthOf(today);
  const paidThisMonth = new Set(
    payments.filter((p) => p.kind === 'regular' && monthOf(p.paid_on) === startMonth).map((p) => p.debt_id),
  );
  const extraStart = o.extraStartMonth !== undefined ? o.extraStartMonth : settings?.extra_start_month?.slice(0, 7) ?? null;
  return {
    startMonth,
    debts: live(debts).map((d) => {
      const firstIdx = d.first_payment_date ? monthsBetween(startMonth, monthOf(d.first_payment_date)) + 1 : 1;
      let idx = Math.max(1, firstIdx);
      if (paidThisMonth.has(d.id)) idx = Math.max(idx, 2);
      return {
        id: d.id,
        name: d.name,
        kind: d.kind,
        balance: d.current_balance,
        annualRate: d.annual_rate,
        monthlyPayment: d.monthly_payment,
        minPayment: d.min_payment,
        payoffPriority: o.priorities?.[d.id] ?? d.payoff_priority,
        firstPayMonthIndex: idx,
        oneOffFirstMonth: idx === firstIdx ? d.one_off_first_month : 0,
      };
    }),
    extraMonthly: o.extraMonthly ?? settings?.extra_monthly ?? 0,
    extraStartIndex: extraStart ? Math.max(1, monthsBetween(startMonth, extraStart) + 1) : 1,
    decimoTercero: settings?.decimo_tercero ?? 0,
    decimoCuarto: settings?.decimo_cuarto ?? 0,
    decimosPct: o.decimosPct ?? settings?.decimos_pct_to_debt ?? 0,
    maxMonths: 84,
  };
}

export interface RecoData {
  today: string;
  balance: number;
  settings: Settings;
  debts: Debt[];
  payments: Payment[];
  incomes: Income[];
  fixed: FixedExpense[];
  fixedPayments: FixedExpensePayment[];
  movements: SavingsMovement[];
  /** Saldo actual del colchón (para repartir los décimos). */
  colchonBalance: number;
}

export interface DecimoSuggestion {
  incomeId: string;
  kind: 'decimo_tercero' | 'decimo_cuarto';
  amount: number;
  receivedOn: string;
  /** Abono pendiente: monto × % menos los abonos extra registrados desde ese día. */
  abono: number;
  toColchon: number;
  toSaving: number;
  targets: RecoTarget[];
}

export interface DailyReco {
  cycle: Cycle;
  savingPending: number;
  reco: RecoResult;
  targets: RecoTarget[];
  decimo: DecimoSuggestion | null;
}

/** Pagos de deudas y gastos fijos que vencen antes del próximo sueldo y no están registrados. */
export function pendingUntil(d: RecoData, nextPayday: string): Pending[] {
  const byDebt: Record<string, string[]> = {};
  for (const p of d.payments) if (p.kind === 'regular') (byDebt[p.debt_id] ??= []).push(p.paid_on);
  const debtItems = nextPayments(
    live(d.debts).map((x) => ({
      id: x.id,
      name: x.name,
      kind: x.kind,
      status: x.status,
      currentBalance: x.current_balance,
      monthlyPayment: x.monthly_payment,
      minPayment: x.min_payment,
      dueDay: x.due_day,
      firstPaymentDate: x.first_payment_date,
      oneOffFirstMonth: x.one_off_first_month,
    })),
    d.today,
    byDebt,
  ).map((p) => ({ name: p.name, due: p.due, amount: p.amount }));

  // Gastos fijos: cada mes que toca el ciclo [hoy, próximo sueldo).
  const paidMonths: Record<string, string[]> = {};
  for (const p of d.fixedPayments) (paidMonths[p.expense_id] ??= []).push(p.month);
  const fixedInput = d.fixed.map((f) => ({ id: f.id, name: f.name, amount: f.amount, dueDay: f.due_day, active: f.active }));
  const fixedItems: Pending[] = [];
  const lastMonth = monthOf(addDays(nextPayday, -1) < d.today ? d.today : addDays(nextPayday, -1));
  for (let m = monthOf(d.today); m <= lastMonth; m = addMonths(m, 1)) {
    for (const f of fixedInput) {
      if (!f.active || f.amount <= 0 || (paidMonths[f.id] ?? []).includes(`${m}-01`)) continue;
      const due = f.dueDay ? dateInMonth(m, f.dueDay) : null;
      fixedItems.push({ name: f.name, due, amount: f.amount });
    }
  }
  return [...debtItems, ...fixedItems];
}

export function buildDailyReco(d: RecoData): DailyReco {
  const s = d.settings;
  const salaryDates = d.incomes.filter((i) => i.kind === 'salary').map((i) => i.received_on);
  const cycle = currentCycle(d.today, s.payday_rule, s.payday_day, salaryDates);

  // El ahorro del ciclo sale del sueldo: solo se exige si el sueldo de este ciclo ya llegó.
  // Cuenta cualquier ahorro apartado en el ciclo (también el del colchón, que se queda en la cuenta).
  const savedThisCycle = d.movements
    .filter((m) => m.amount > 0 && m.moved_on >= cycle.start && m.moved_on <= d.today)
    .reduce((t, m) => t + m.amount, 0);
  const savingPending = cycle.salaryRegistered ? Math.max(s.monthly_saving_target - savedThisCycle, 0) : 0;

  const reco = recommend({
    today: d.today,
    balance: d.balance,
    nextPayday: cycle.nextPayday,
    pending: pendingUntil(d, cycle.nextPayday),
    dailyLivingBudget: s.daily_living_budget,
    colchonTarget: s.colchon_target,
    savingPendingThisCycle: savingPending,
    abonoMin: s.abono_min,
    abonoSafetyPct: s.abono_safety_pct,
    abonoRound: s.abono_round,
  });

  const extraDebts = live(d.debts).map((x) => ({ id: x.id, name: x.name, kind: x.kind, balance: x.current_balance, payoffPriority: x.payoff_priority }));

  // Décimo recibido en este ciclo cuyo abono todavía no se hizo completo.
  let decimo: DecimoSuggestion | null = null;
  const dec = d.incomes
    .filter((i) => (i.kind === 'decimo_tercero' || i.kind === 'decimo_cuarto') && i.received_on >= cycle.start && i.received_on <= d.today)
    .sort((a, b) => b.received_on.localeCompare(a.received_on))[0];
  if (dec) {
    const split = splitDecimo(dec.amount, s.decimos_pct_to_debt, s.colchon_target - d.colchonBalance);
    const extraSince = d.payments.filter((p) => p.kind === 'extra' && p.paid_on >= dec.received_on).reduce((t, p) => t + p.amount, 0);
    const abono = Math.max(Math.round((split.abono - extraSince) * 100) / 100, 0);
    if (abono > 0.005) {
      decimo = {
        incomeId: dec.id,
        kind: dec.kind as DecimoSuggestion['kind'],
        amount: dec.amount,
        receivedOn: dec.received_on,
        abono,
        toColchon: split.toColchon,
        toSaving: split.toSaving,
        targets: allocateExtra(abono, extraDebts),
      };
    }
  }

  return { cycle, savingPending, reco, targets: allocateExtra(reco.abono, extraDebts), decimo };
}

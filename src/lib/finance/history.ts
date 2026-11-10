import { addDays, monthOf } from '../dates';
import { estimateSpend } from './daily';

export type MovementType = 'income' | 'debt' | 'fixed' | 'saving';

export interface HistoryMovement {
  date: string;
  type: MovementType;
  name: string;
  /**
   * Ingresos, pagos de deuda y gastos fijos: monto positivo.
   * Ahorro: como en la base (positivo = depósito, negativo = retiro).
   */
  amount: number;
}

export interface HistoryCheckin {
  date: string;
  balance: number;
}

export interface HistoryRow {
  date: string;
  balance: number;
  /** Check-in anterior (null en el primero). */
  prevDate: string | null;
  days: number;
  /** Gasto estimado del intervalo (prevDate, date]; null en el primer check-in. */
  estimated: number | null;
  perDay: number | null;
  overBudget: boolean;
  /** Gasto negativo: falta registrar un ingreso o sobra un pago. */
  suspicious: boolean;
  movements: HistoryMovement[];
}

/**
 * Una fila por check-in (más reciente primero), con el gasto estimado desde el
 * check-in anterior y los movimientos registrados en ese intervalo.
 * Los movimientos de ahorro solo afectan al gasto si pasan por la cuenta (`affectsBalance`).
 */
export function buildHistory(
  checkins: HistoryCheckin[],
  movements: (HistoryMovement & { affectsBalance?: boolean })[],
  dailyBudget: number,
): HistoryRow[] {
  const asc = [...checkins].sort((a, b) => a.date.localeCompare(b.date));
  const pick = (t: MovementType) =>
    movements.filter((m) => m.type === t && m.affectsBalance !== false).map((m) => ({ date: m.date, amount: m.amount }));
  const incomes = pick('income');
  const debtPayments = pick('debt');
  const fixedPayments = pick('fixed');
  // Ahorro que pasa por la cuenta: un depósito sale de ella (+) y un retiro vuelve (−).
  const savingsFromAccount = pick('saving');

  const rows: HistoryRow[] = asc.map((c, i) => {
    const prev = i > 0 ? asc[i - 1] : null;
    const inRange = movements
      .filter((m) => (prev ? m.date > prev.date : m.date === c.date) && m.date <= c.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!prev) {
      return { date: c.date, balance: c.balance, prevDate: null, days: 0, estimated: null, perDay: null, overBudget: false, suspicious: false, movements: inRange };
    }
    const r = estimateSpend({
      prev: { date: prev.date, balance: prev.balance },
      curr: { date: c.date, balance: c.balance },
      incomes,
      debtPayments,
      fixedPayments,
      savingsFromAccount,
    });
    return {
      date: c.date,
      balance: c.balance,
      prevDate: prev.date,
      days: r.days,
      estimated: r.estimated,
      perDay: r.perDay,
      overBudget: !r.suspicious && r.perDay > dailyBudget + 0.005,
      suspicious: r.suspicious,
      movements: inRange,
    };
  });
  return rows.reverse();
}

export interface PeriodSummary {
  /** Gasto estimado sumado (los intervalos negativos no restan). */
  spent: number;
  /** Días cubiertos por check-ins con gasto calculado. */
  days: number;
  avgPerDay: number;
  budget: number;
  /** Días (contando cada día del intervalo) con gasto diario ≤ tope. */
  daysUnder: number;
  incomes: number;
  debtPaid: number;
  fixedPaid: number;
  saved: number;
  firstBalance: number | null;
  lastBalance: number | null;
  warnings: number;
}

/** Resumen de las filas cuyo check-in cae en el mes `ym` ('YYYY-MM'). */
export function summarizeMonth(rows: HistoryRow[], ym: string, dailyBudget: number, allMovements: HistoryMovement[]): PeriodSummary {
  const inMonth = rows.filter((r) => monthOf(r.date) === ym);
  const withSpend = inMonth.filter((r) => r.estimated !== null);
  const spent = withSpend.reduce((s, r) => s + Math.max(r.estimated!, 0), 0);
  const days = withSpend.reduce((s, r) => s + r.days, 0);
  const daysUnder = withSpend.filter((r) => !r.overBudget && !r.suspicious).reduce((s, r) => s + r.days, 0);
  const mov = allMovements.filter((m) => monthOf(m.date) === ym);
  const sum = (t: MovementType) => mov.filter((m) => m.type === t).reduce((s, m) => s + m.amount, 0);
  const asc = [...inMonth].sort((a, b) => a.date.localeCompare(b.date));
  return {
    spent,
    days,
    avgPerDay: days > 0 ? spent / days : 0,
    budget: days * dailyBudget,
    daysUnder,
    incomes: sum('income'),
    debtPaid: sum('debt'),
    fixedPaid: sum('fixed'),
    saved: sum('saving'),
    firstBalance: asc[0]?.balance ?? null,
    lastBalance: asc[asc.length - 1]?.balance ?? null,
    warnings: inMonth.filter((r) => r.suspicious).length,
  };
}

export interface DayPoint {
  date: string;
  /** Gasto del día; en intervalos de varios días es el promedio repartido. */
  spent: number;
  averaged: boolean;
  over: boolean;
}

/** Un punto por día del mes con datos, repartiendo cada intervalo entre sus días. */
export function dailyPoints(rows: HistoryRow[], ym: string, dailyBudget: number): DayPoint[] {
  const out: DayPoint[] = [];
  for (const r of rows) {
    if (r.perDay === null || r.suspicious) continue;
    for (let i = 0; i < r.days; i++) {
      const date = addDays(r.date, -i);
      if (monthOf(date) !== ym) continue;
      out.push({ date, spent: r.perDay, averaged: r.days > 1, over: r.perDay > dailyBudget + 0.005 });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

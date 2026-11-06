import { daysBetween } from '../dates';

export interface DatedAmount {
  date: string; // 'YYYY-MM-DD'
  amount: number;
}

export interface SpendInput {
  prev: { date: string; balance: number };
  curr: { date: string; balance: number };
  incomes: DatedAmount[];
  debtPayments: DatedAmount[];
  fixedPayments: DatedAmount[];
  /** Movimientos de ahorro con from_main_account = true (positivo = sale de la cuenta). */
  savingsFromAccount: DatedAmount[];
}

export interface SpendResult {
  days: number;
  estimated: number;
  perDay: number;
  /** true si el resultado es negativo: falta registrar un ingreso o sobra un pago. */
  suspicious: boolean;
}

/** Solo cuenta movimientos con fecha en (prev, curr]. */
function sumBetween(items: DatedAmount[], from: string, to: string): number {
  return items.reduce((s, it) => (it.date > from && it.date <= to ? s + it.amount : s), 0);
}

/**
 * gastoEstimado = saldoAnterior + ingresos − pagosDeDeuda − pagosGastosFijos
 *                 − ahorrosQueSalenDeLaCuenta − saldoActual   (sección 5.5)
 */
export function estimateSpend(input: SpendInput): SpendResult {
  const { prev, curr } = input;
  const days = Math.max(daysBetween(prev.date, curr.date), 1);
  const estimated =
    prev.balance +
    sumBetween(input.incomes, prev.date, curr.date) -
    sumBetween(input.debtPayments, prev.date, curr.date) -
    sumBetween(input.fixedPayments, prev.date, curr.date) -
    sumBetween(input.savingsFromAccount, prev.date, curr.date) -
    curr.balance;
  return { days, estimated, perDay: estimated / days, suspicious: estimated < -0.005 };
}

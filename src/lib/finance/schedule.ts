import { monthlyRate } from './pmt';

export interface ScheduleRow {
  index: number;
  interest: number;
  payment: number;
  principal: number;
  balanceEnd: number;
}

/**
 * Cronograma de amortización (sección 5.2):
 * interés = saldo × r; pago = min(cuota, saldo + interés); capital = pago − interés.
 * Se detiene cuando el saldo llega a ≤ 0,005 o si la cuota no cubre el interés.
 */
export function amortizationSchedule(
  balance: number,
  annualRate: number,
  payment: number,
  maxMonths = 600,
): ScheduleRow[] {
  const r = monthlyRate(annualRate);
  const rows: ScheduleRow[] = [];
  let saldo = balance;
  for (let i = 1; i <= maxMonths && saldo > 0.005; i++) {
    const interest = saldo * r;
    const pago = Math.min(payment, saldo + interest);
    const principal = pago - interest;
    if (principal <= 0) break; // la cuota no alcanza ni para el interés
    saldo = saldo - principal;
    rows.push({ index: i, interest, payment: pago, principal, balanceEnd: Math.max(saldo, 0) });
  }
  return rows;
}

/** Interés sugerido para un pago: saldo × tasa / 12 (cero para cuotas fijas). */
export function suggestedInterest(balance: number, annualRate: number, kind: string): number {
  if (kind === 'fixed_installments') return 0;
  return Math.round(balance * monthlyRate(annualRate) * 100) / 100;
}

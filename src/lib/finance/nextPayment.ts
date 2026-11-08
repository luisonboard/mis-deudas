import { addDays, addMonths, dateInMonth, daysBetween, monthOf } from '../dates';

export interface NextPaymentDebt {
  id: string;
  name: string;
  kind: 'loan' | 'revolving' | 'fixed_installments';
  status: string;
  currentBalance: number;
  monthlyPayment: number;
  minPayment: number | null;
  dueDay: number | null;
  firstPaymentDate: string | null;
  oneOffFirstMonth: number;
}

export interface NextPayment {
  debtId: string;
  name: string;
  due: string;
  amount: number;
  daysLeft: number;
}

/**
 * Próximo vencimiento de una deuda. Si ya hay un pago regular registrado en los
 * 28 días previos a un vencimiento, se considera cubierto y se pasa al siguiente mes.
 */
export function nextDueFor(debt: NextPaymentDebt, today: string, regularPaymentDates: string[]): NextPayment | null {
  if (debt.status !== 'active' || debt.currentBalance <= 0.005) return null;
  const base = debt.kind === 'revolving' ? debt.minPayment ?? 0 : debt.monthlyPayment;
  if (base <= 0) return null;

  const covered = (due: string) => regularPaymentDates.some((d) => d <= due && d > addDays(due, -28));

  let due: string | null = null;
  if (debt.firstPaymentDate && debt.firstPaymentDate >= today && !covered(debt.firstPaymentDate)) {
    due = debt.firstPaymentDate;
  } else {
    const day = debt.dueDay ?? (debt.firstPaymentDate ? Number(debt.firstPaymentDate.slice(8, 10)) : null);
    if (!day) return null;
    let ym = monthOf(today);
    let candidate = dateInMonth(ym, day);
    if (candidate < today) candidate = dateInMonth((ym = addMonths(ym, 1)), day);
    for (let i = 0; i < 3 && covered(candidate); i++) candidate = dateInMonth((ym = addMonths(ym, 1)), day);
    if (debt.firstPaymentDate && candidate < debt.firstPaymentDate) candidate = debt.firstPaymentDate;
    due = candidate;
  }

  const isFirst = debt.firstPaymentDate === due;
  // En cuotas fijas la última cuota no supera el saldo; en préstamos y tarjetas el saldo
  // ya no incluye el interés del mes, así que se muestra la cuota completa.
  const amount =
    (debt.kind === 'fixed_installments' ? Math.min(base, debt.currentBalance) : base) + (isFirst ? debt.oneOffFirstMonth : 0);
  return { debtId: debt.id, name: debt.name, due, amount, daysLeft: daysBetween(today, due) };
}

export function nextPayments(
  debts: NextPaymentDebt[],
  today: string,
  regularPaymentsByDebt: Record<string, string[]>,
): NextPayment[] {
  return debts
    .map((d) => nextDueFor(d, today, regularPaymentsByDebt[d.id] ?? []))
    .filter((p): p is NextPayment => p !== null)
    .sort((a, b) => a.due.localeCompare(b.due));
}

export interface FixedExpenseInput {
  id: string;
  name: string;
  amount: number;
  dueDay: number | null;
  active: boolean;
}

export interface FixedDue {
  expenseId: string;
  name: string;
  amount: number;
  /** Mes que se paga, 'YYYY-MM'. */
  month: string;
  /** null si el gasto no tiene día de pago. */
  due: string | null;
  /** Negativo si ya venció este mes y no se ha pagado. */
  daysLeft: number | null;
}

/**
 * Próximo pago de cada gasto fijo activo.
 * - Si el mes actual no está pagado: vence este mes (puede estar atrasado).
 * - Si ya está pagado: vence el próximo mes (solo si tiene día de pago).
 * `paidMonths` usa el formato de la tabla: 'YYYY-MM-01'.
 */
export function nextFixedExpenses(
  expenses: FixedExpenseInput[],
  today: string,
  paidMonths: Record<string, string[]>,
): FixedDue[] {
  const out: FixedDue[] = [];
  for (const e of expenses) {
    if (!e.active || e.amount <= 0) continue;
    const paid = new Set(paidMonths[e.id] ?? []);
    let ym = monthOf(today);
    if (paid.has(`${ym}-01`)) {
      if (!e.dueDay) continue;
      ym = addMonths(ym, 1);
      if (paid.has(`${ym}-01`)) continue;
    }
    const due = e.dueDay ? dateInMonth(ym, e.dueDay) : null;
    out.push({ expenseId: e.id, name: e.name, amount: e.amount, month: ym, due, daysLeft: due ? daysBetween(today, due) : null });
  }
  return out;
}

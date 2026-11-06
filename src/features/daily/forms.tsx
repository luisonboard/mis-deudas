import { useMemo, useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  useAddFixedPayment,
  useAddIncome,
  useAddPayment,
  useDebts,
  useFixedExpenses,
  useFixedPayments,
} from '../../lib/api';
import { firstOfMonth, todayIn } from '../../lib/dates';
import { formatMoney, parseMoney } from '../../lib/format';
import { suggestedInterest } from '../../lib/finance/schedule';
import { INCOME_KIND_LABEL, PAYMENT_KIND_LABEL, type Debt, type IncomeKind, type PaymentKind } from '../../lib/types';
import { Button, Field, MoneyInput, inputClass, useOnline } from '../../components/ui';

const money = z.number({ error: 'Monto no válido' }).finite('Monto no válido');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida');

function FormError({ msg }: { msg: string | null }) {
  return msg ? (
    <p role="alert" className="text-sm text-red-400">
      {msg}
    </p>
  ) : null;
}

function OfflineNote() {
  return <p className="text-xs text-amber-300">Sin conexión: no se puede guardar ahora.</p>;
}

// ───────────── Pago de deuda ─────────────

const paymentSchema = z
  .object({
    debt_id: z.uuid('Elige una deuda'),
    paid_on: isoDate,
    kind: z.enum(['regular', 'extra', 'fee']),
    amount: money.positive('El monto debe ser mayor a 0'),
    interest_part: money.min(0, 'El interés no puede ser negativo'),
  })
  .refine((p) => p.interest_part <= p.amount + 0.005, { message: 'El interés no puede superar el monto', path: ['interest_part'] });

export function PaymentForm({ debtId, onDone }: { debtId?: string; onDone?: () => void }) {
  const debts = useDebts();
  const add = useAddPayment();
  const online = useOnline();
  const active = (debts.data ?? []).filter((d) => d.status === 'active');
  const [selected, setSelected] = useState(debtId ?? '');
  const debt: Debt | undefined = (debts.data ?? []).find((d) => d.id === (selected || active[0]?.id));
  const [kind, setKind] = useState<PaymentKind>('regular');
  const [paidOn, setPaidOn] = useState(todayIn());
  const [amount, setAmount] = useState('');
  const [interest, setInterest] = useState<string | null>(null); // null = usar el sugerido
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suggested = debt ? suggestedInterest(debt.current_balance, debt.annual_rate, debt.kind) : 0;
  // El pago regular sugiere el interés del mes; el abono extra parte de 0 (todo a capital) y el cargo no toca capital.
  const interestValue =
    kind === 'fee' ? '0' : interest ?? (kind === 'regular' ? String(suggested).replace('.', ',') : '0');
  const amountNum = parseMoney(amount);
  const interestNum = parseMoney(interestValue);
  const principal = kind === 'fee' ? 0 : Math.max((Number.isFinite(amountNum) ? amountNum : 0) - (Number.isFinite(interestNum) ? interestNum : 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = paymentSchema.safeParse({
      debt_id: debt?.id ?? '',
      paid_on: paidOn,
      kind,
      amount: amountNum,
      interest_part: kind === 'fee' ? 0 : interestNum,
    });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    const p = parsed.data;
    try {
      await add.mutateAsync({
        ...p,
        // Un cargo no es interés ni capital: no cambia el saldo de la deuda.
        interest_part: p.kind === 'fee' ? 0 : round2(p.interest_part),
        principal_part: p.kind === 'fee' ? 0 : round2(Math.min(p.amount - p.interest_part, debt!.current_balance)),
        note: note.trim() || null,
      });
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (debts.isLoading) return <p className="text-slate-400">Cargando deudas…</p>;
  if (active.length === 0) return <p className="text-slate-400">No tienes deudas activas.</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      {!debtId && (
        <Field label="Deuda">
          <select className={inputClass} value={debt?.id ?? ''} onChange={(e) => { setSelected(e.target.value); setInterest(null); }}>
            {active.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {formatMoney(d.current_balance)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className={inputClass} value={kind} onChange={(e) => { setKind(e.target.value as PaymentKind); setInterest(null); }}>
            {(Object.keys(PAYMENT_KIND_LABEL) as PaymentKind[]).map((k) => (
              <option key={k} value={k}>
                {PAYMENT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha">
          <input type="date" className={inputClass} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
      </div>
      <Field label="Monto pagado">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      {kind !== 'fee' && (
        <Field label="Interés incluido" hint={`Sugerido: saldo × tasa / 12 = ${formatMoney(suggested)}. Edítalo según tu estado de cuenta.`}>
          <MoneyInput value={interestValue} onChange={setInterest} />
        </Field>
      )}
      <p className="text-sm text-slate-300">
        {kind === 'fee' ? 'Un cargo no reduce el saldo.' : <>Baja el saldo en <strong>{formatMoney(principal)}</strong> (capital).</>}
      </p>
      <Field label="Nota (opcional)">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <FormError msg={error} />
      {!online && <OfflineNote />}
      <Button type="submit" disabled={add.isPending || !online}>
        {add.isPending ? 'Guardando…' : 'Registrar pago'}
      </Button>
    </form>
  );
}

// ───────────── Gasto fijo pagado ─────────────

const fixedSchema = z.object({
  expense_id: z.uuid('Elige un gasto'),
  month: isoDate,
  paid_on: isoDate,
  amount: money.positive('El monto debe ser mayor a 0'),
});

export function FixedPaymentForm({ onDone }: { onDone?: () => void }) {
  const fixed = useFixedExpenses();
  const paidList = useFixedPayments();
  const add = useAddFixedPayment();
  const online = useOnline();
  const today = todayIn();
  const [month, setMonth] = useState(today.slice(0, 7));
  const monthDate = `${month}-01`;
  const paidIds = useMemo(
    () => new Set((paidList.data ?? []).filter((p) => p.month === monthDate).map((p) => p.expense_id)),
    [paidList.data, monthDate],
  );
  const pending = (fixed.data ?? []).filter((f) => f.active && !paidIds.has(f.id));
  const [expenseId, setExpenseId] = useState('');
  const expense = pending.find((f) => f.id === expenseId) ?? pending[0];
  const [amount, setAmount] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const amountValue = amount ?? (expense ? String(expense.amount).replace('.', ',') : '');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = fixedSchema.safeParse({ expense_id: expense?.id ?? '', month: monthDate, paid_on: paidOn, amount: parseMoney(amountValue) });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    try {
      await add.mutateAsync({ ...parsed.data, amount: round2(parsed.data.amount), month: firstOfMonth(parsed.data.month) });
      setAmount(null);
      setExpenseId('');
      onDone?.();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg.includes('duplicate') ? 'Ese gasto ya está registrado como pagado en ese mes.' : msg);
    }
  };

  if (fixed.isLoading) return <p className="text-slate-400">Cargando…</p>;
  if ((fixed.data ?? []).length === 0) return <p className="text-slate-400">No tienes gastos fijos. Agrégalos en Ajustes.</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Mes que se paga">
        <input type="month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>
      {pending.length === 0 ? (
        <p className="text-emerald-300">Todos los gastos fijos de ese mes ya están pagados. 🎉</p>
      ) : (
        <>
          <Field label="Gasto">
            <select className={inputClass} value={expense?.id ?? ''} onChange={(e) => { setExpenseId(e.target.value); setAmount(null); }}>
              {pending.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {formatMoney(f.amount)}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Monto">
              <MoneyInput value={amountValue} onChange={setAmount} />
            </Field>
            <Field label="Fecha de pago">
              <input type="date" className={inputClass} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
          </div>
          <FormError msg={error} />
          {!online && <OfflineNote />}
          <Button type="submit" disabled={add.isPending || !online}>
            {add.isPending ? 'Guardando…' : 'Marcar como pagado'}
          </Button>
        </>
      )}
    </form>
  );
}

// ───────────── Ingreso ─────────────

const incomeSchema = z.object({
  kind: z.enum(['salary', 'decimo_tercero', 'decimo_cuarto', 'other']),
  received_on: isoDate,
  amount: money.positive('El monto debe ser mayor a 0'),
});

export function IncomeForm({ defaultSalary, onDone }: { defaultSalary?: number; onDone?: () => void }) {
  const add = useAddIncome();
  const online = useOnline();
  const [kind, setKind] = useState<IncomeKind>('salary');
  const [receivedOn, setReceivedOn] = useState(todayIn());
  const [amount, setAmount] = useState(defaultSalary ? String(defaultSalary).replace('.', ',') : '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = incomeSchema.safeParse({ kind, received_on: receivedOn, amount: parseMoney(amount) });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    try {
      await add.mutateAsync({ ...parsed.data, amount: round2(parsed.data.amount), note: note.trim() || null });
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as IncomeKind)}>
            {(Object.keys(INCOME_KIND_LABEL) as IncomeKind[]).map((k) => (
              <option key={k} value={k}>
                {INCOME_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha">
          <input type="date" className={inputClass} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
        </Field>
      </div>
      <Field label="Monto">
        <MoneyInput value={amount} onChange={setAmount} />
      </Field>
      <Field label="Nota (opcional)">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      <FormError msg={error} />
      {!online && <OfflineNote />}
      <Button type="submit" disabled={add.isPending || !online}>
        {add.isPending ? 'Guardando…' : 'Registrar ingreso'}
      </Button>
    </form>
  );
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

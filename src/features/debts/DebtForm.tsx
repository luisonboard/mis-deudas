import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { useSaveDebt, type DebtDraft } from '../../lib/api';
import { formatMoney, parseMoney } from '../../lib/format';
import { pmt } from '../../lib/finance/pmt';
import { DEBT_KIND_LABEL, type Debt, type DebtKind } from '../../lib/types';
import { Button, Field, MoneyInput, inputClass, useOnline } from '../../components/ui';

const optInt = (min: number, max: number, msg: string) =>
  z.number().int(msg).min(min, msg).max(max, msg).nullable();

const schema = z
  .object({
    name: z.string().trim().min(1, 'Ponle un nombre').max(80),
    lender: z.string().trim().max(80).nullable(),
    kind: z.enum(['loan', 'revolving', 'fixed_installments']),
    initial_balance: z.number({ error: 'Saldo inicial no válido' }).finite().min(0, 'Saldo inicial no válido'),
    current_balance: z.number({ error: 'Saldo actual no válido' }).finite().min(0, 'Saldo actual no válido'),
    annual_rate: z.number({ error: 'Tasa no válida' }).finite().min(0, 'Tasa no válida').max(1, 'Tasa demasiado alta (usa %, p. ej. 15,6)'),
    monthly_payment: z.number({ error: 'Cuota no válida' }).finite().min(0, 'Cuota no válida'),
    min_payment: z.number().finite().min(0, 'Pago mínimo no válido').nullable(),
    term_months: optInt(1, 600, 'Plazo no válido'),
    first_payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    due_day: optInt(1, 31, 'Día de pago entre 1 y 31'),
    payoff_priority: z.number().int('Prioridad no válida').min(0).max(32767),
    one_off_first_month: z.number().finite().min(0, 'Cargo único no válido'),
    notes: z.string().trim().max(500).nullable(),
  })
  .refine((d) => d.kind !== 'revolving' || (d.min_payment ?? 0) > 0, { message: 'Las tarjetas necesitan un pago mínimo', path: ['min_payment'] })
  .refine((d) => d.kind === 'revolving' || d.monthly_payment > 0, { message: 'Indica la cuota mensual', path: ['monthly_payment'] });

const toStr = (n: number | null | undefined, scale = 1) =>
  n === null || n === undefined ? '' : String(Math.round(n * scale * 10000) / 10000).replace('.', ',');
const optMoney = (s: string) => (s.trim() === '' ? null : parseMoney(s));
const optIntStr = (s: string) => (s.trim() === '' ? null : Number(s));

export function DebtForm({ debt, onDone }: { debt?: Debt; onDone: () => void }) {
  const save = useSaveDebt();
  const online = useOnline();
  const [f, setF] = useState({
    name: debt?.name ?? '',
    lender: debt?.lender ?? '',
    kind: (debt?.kind ?? 'loan') as DebtKind,
    initial_balance: toStr(debt?.initial_balance),
    current_balance: toStr(debt?.current_balance),
    annual_rate: toStr(debt?.annual_rate, 100),
    monthly_payment: toStr(debt?.monthly_payment),
    min_payment: toStr(debt?.min_payment),
    term_months: debt?.term_months?.toString() ?? '',
    first_payment_date: debt?.first_payment_date ?? '',
    due_day: debt?.due_day?.toString() ?? '',
    payoff_priority: debt?.payoff_priority?.toString() ?? '100',
    one_off_first_month: toStr(debt?.one_off_first_month ?? 0),
    notes: debt?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const candidate = () => ({
    name: f.name,
    lender: f.lender.trim() || null,
    kind: f.kind,
    initial_balance: parseMoney(f.initial_balance),
    // Al crear, si no se indica el saldo actual se usa el inicial.
    current_balance: f.current_balance.trim() === '' ? parseMoney(f.initial_balance) : parseMoney(f.current_balance),
    annual_rate: parseMoney(f.annual_rate || '0') / 100,
    monthly_payment: f.kind === 'revolving' ? optMoney(f.monthly_payment) ?? 0 : parseMoney(f.monthly_payment || 'x'),
    min_payment: optMoney(f.min_payment),
    term_months: optIntStr(f.term_months),
    first_payment_date: f.first_payment_date || null,
    due_day: optIntStr(f.due_day),
    payoff_priority: Number(f.payoff_priority || '100'),
    one_off_first_month: optMoney(f.one_off_first_month) ?? 0,
    notes: f.notes.trim() || null,
  });

  const c = candidate();
  const suggestedPmt =
    f.kind === 'loan' && c.initial_balance > 0 && (c.term_months ?? 0) > 0 ? pmt(c.initial_balance, c.annual_rate, c.term_months!) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = schema.safeParse(c);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    const draft: DebtDraft = parsed.data;
    try {
      await save.mutateAsync(debt ? { ...draft, id: debt.id } : draft);
      onDone();
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Nombre" error={errors.name}>
        <input className={inputClass} value={f.name} onChange={(e) => set('name')(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Entidad">
          <input className={inputClass} value={f.lender} onChange={(e) => set('lender')(e.target.value)} />
        </Field>
        <Field label="Tipo">
          <select className={inputClass} value={f.kind} onChange={(e) => set('kind')(e.target.value)}>
            {(Object.keys(DEBT_KIND_LABEL) as DebtKind[]).map((k) => (
              <option key={k} value={k}>
                {DEBT_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Saldo inicial" error={errors.initial_balance}>
          <MoneyInput value={f.initial_balance} onChange={set('initial_balance')} />
        </Field>
        <Field label="Saldo actual" error={errors.current_balance} hint={debt ? 'Lo actualizan los pagos' : 'Vacío = saldo inicial'}>
          <MoneyInput value={f.current_balance} onChange={set('current_balance')} />
        </Field>
        <Field label="Tasa anual (%)" error={errors.annual_rate} hint="Nominal, p. ej. 15,6">
          <input className={inputClass} inputMode="decimal" value={f.annual_rate} onChange={(e) => set('annual_rate')(e.target.value)} />
        </Field>
        {f.kind === 'revolving' ? (
          <Field label="Pago mínimo" error={errors.min_payment}>
            <MoneyInput value={f.min_payment} onChange={set('min_payment')} />
          </Field>
        ) : (
          <Field
            label="Cuota mensual"
            error={errors.monthly_payment}
            hint={suggestedPmt ? `Calculada: ${formatMoney(suggestedPmt)}` : undefined}
          >
            <MoneyInput value={f.monthly_payment} onChange={set('monthly_payment')} />
          </Field>
        )}
        <Field label="Plazo (meses)" error={errors.term_months}>
          <input className={inputClass} inputMode="numeric" value={f.term_months} onChange={(e) => set('term_months')(e.target.value)} />
        </Field>
        <Field label="Día de pago" error={errors.due_day}>
          <input className={inputClass} inputMode="numeric" value={f.due_day} onChange={(e) => set('due_day')(e.target.value)} />
        </Field>
        <Field label="Primer pago" error={errors.first_payment_date}>
          <input type="date" className={inputClass} value={f.first_payment_date} onChange={(e) => set('first_payment_date')(e.target.value)} />
        </Field>
        <Field label="Prioridad de abono" error={errors.payoff_priority} hint="Menor = recibe antes el extra">
          <input className={inputClass} inputMode="numeric" value={f.payoff_priority} onChange={(e) => set('payoff_priority')(e.target.value)} />
        </Field>
      </div>
      <Field label="Cargo único en el primer pago" error={errors.one_off_first_month} hint="Se suma al total pagado, no al capital (p. ej. exigibles)">
        <MoneyInput value={f.one_off_first_month} onChange={set('one_off_first_month')} />
      </Field>
      <Field label="Notas" error={errors.notes}>
        <textarea className={`${inputClass} py-2`} rows={2} value={f.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500">No guardes números de tarjeta ni datos bancarios, solo nombres y montos.</p>
      {formError && (
        <p role="alert" className="text-sm text-red-400">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={save.isPending || !online}>
        {save.isPending ? 'Guardando…' : debt ? 'Guardar cambios' : 'Crear deuda'}
      </Button>
    </form>
  );
}

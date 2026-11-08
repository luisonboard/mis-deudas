import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  useCheckins,
  useDeleteCheckin,
  useDeleteFixedExpense,
  useDeleteFixedPayment,
  useDeleteIncome,
  useFixedExpenses,
  useFixedPayments,
  useIncomes,
  useSaveFixedExpense,
  useSaveSettings,
  useSettings,
} from '../../lib/api';
import { formatDate, formatMoney, formatMonth, parseMoney } from '../../lib/format';
import { INCOME_KIND_LABEL, type FixedExpense, type Settings } from '../../lib/types';
import { useAuth, useUserId } from '../auth/AuthProvider';
import { Button, Card, Empty, ErrorBox, Field, Loading, MoneyInput, inputClass, useOnline } from '../../components/ui';

const settingsSchema = z.object({
  monthly_income: z.number().finite().min(0, 'Sueldo no válido'),
  payday_rule: z.enum(['last_day', 'fixed_day']),
  payday_day: z.number().int().min(1).max(31).nullable(),
  decimo_tercero: z.number().finite().min(0, 'Monto no válido'),
  decimo_cuarto: z.number().finite().min(0, 'Monto no válido'),
  decimos_pct_to_debt: z.number().min(0, 'Entre 0 y 100').max(1, 'Entre 0 y 100'),
  daily_living_budget: z.number().finite().min(0, 'Monto no válido'),
  colchon_target: z.number().finite().min(0, 'Monto no válido'),
  monthly_saving_target: z.number().finite().min(0, 'Monto no válido'),
  abono_min: z.number().finite().min(0, 'Monto no válido'),
  abono_safety_pct: z.number().min(0, 'Entre 0 y 100').max(1, 'Entre 0 y 100'),
  abono_round: z.number().finite().positive('Debe ser mayor a 0'),
  timezone: z.string().min(1),
});

const s2 = (n: number | null | undefined, scale = 1) =>
  n === null || n === undefined ? '' : String(Math.round(n * scale * 10000) / 10000).replace('.', ',');

export function SettingsPage() {
  const settings = useSettings();
  const { signOut, session } = useAuth();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Ajustes</h1>
      {settings.isLoading && <Loading />}
      {settings.error && <ErrorBox error={settings.error} onRetry={() => settings.refetch()} />}
      {!settings.isLoading && !settings.error && <SettingsForm current={settings.data ?? null} />}
      <FixedExpensesCard />
      <IncomesCard />
      <CheckinsCard />
      <Card title="Sesión">
        <p className="mb-3 text-sm text-slate-400">{session?.user.email}</p>
        <Button variant="secondary" className="w-full" onClick={signOut}>
          Cerrar sesión
        </Button>
      </Card>
      <p className="text-center text-xs text-slate-500">Exportar CSV y calendario .ics: Fase 5.</p>
    </div>
  );
}

function SettingsForm({ current }: { current: Settings | null }) {
  const save = useSaveSettings();
  const online = useOnline();
  const userId = useUserId();
  const [f, setF] = useState({
    monthly_income: s2(current?.monthly_income ?? 0),
    payday_rule: current?.payday_rule ?? 'last_day',
    payday_day: current?.payday_day?.toString() ?? '',
    decimo_tercero: s2(current?.decimo_tercero ?? 0),
    decimo_cuarto: s2(current?.decimo_cuarto ?? 482),
    decimos_pct_to_debt: s2(current?.decimos_pct_to_debt ?? 0.5, 100),
    daily_living_budget: s2(current?.daily_living_budget ?? 12.5),
    colchon_target: s2(current?.colchon_target ?? 300),
    monthly_saving_target: s2(current?.monthly_saving_target ?? 100),
    abono_min: s2(current?.abono_min ?? 20),
    abono_safety_pct: s2(current?.abono_safety_pct ?? 0.2, 100),
    abono_round: s2(current?.abono_round ?? 5),
    timezone: current?.timezone ?? 'America/Guayaquil',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const parsed = settingsSchema.safeParse({
      monthly_income: parseMoney(f.monthly_income),
      payday_rule: f.payday_rule,
      payday_day: f.payday_rule === 'fixed_day' && f.payday_day ? Number(f.payday_day) : null,
      decimo_tercero: parseMoney(f.decimo_tercero),
      decimo_cuarto: parseMoney(f.decimo_cuarto),
      decimos_pct_to_debt: parseMoney(f.decimos_pct_to_debt) / 100,
      daily_living_budget: parseMoney(f.daily_living_budget),
      colchon_target: parseMoney(f.colchon_target),
      monthly_saving_target: parseMoney(f.monthly_saving_target),
      abono_min: parseMoney(f.abono_min),
      abono_safety_pct: parseMoney(f.abono_safety_pct) / 100,
      abono_round: parseMoney(f.abono_round),
      timezone: f.timezone,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
      return setErrors(errs);
    }
    if (parsed.data.payday_rule === 'fixed_day' && !parsed.data.payday_day) return setErrors({ payday_day: 'Indica el día de cobro' });
    setErrors({});
    try {
      await save.mutateAsync({ ...parsed.data, user_id: userId });
      setMsg('Ajustes guardados');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const money = (k: keyof typeof f, label: string, hint?: string) => (
    <Field label={label} error={errors[k]} hint={hint}>
      <MoneyInput value={f[k]} onChange={set(k)} />
    </Field>
  );
  const pct = (k: keyof typeof f, label: string) => (
    <Field label={label} error={errors[k]}>
      <input className={inputClass} inputMode="decimal" value={f[k]} onChange={(e) => set(k)(e.target.value)} />
    </Field>
  );

  return (
    <Card title="Mi plan">
      {!current && <p className="mb-3 text-sm text-amber-300">Primera vez: revisa los valores y guarda.</p>}
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="grid grid-cols-2 gap-3">
          {money('monthly_income', 'Sueldo mensual')}
          <Field label="Día de cobro">
            <select className={inputClass} value={f.payday_rule} onChange={(e) => set('payday_rule')(e.target.value)}>
              <option value="last_day">Último día del mes</option>
              <option value="fixed_day">Día fijo</option>
            </select>
          </Field>
          {f.payday_rule === 'fixed_day' && (
            <Field label="Día del mes" error={errors.payday_day}>
              <input className={inputClass} inputMode="numeric" value={f.payday_day} onChange={(e) => set('payday_day')(e.target.value)} />
            </Field>
          )}
          {money('decimo_tercero', 'Décimo tercero (dic)')}
          {money('decimo_cuarto', 'Décimo cuarto (mar)')}
          {pct('decimos_pct_to_debt', '% de décimos a deuda')}
          {money('daily_living_budget', 'Tope diario de gasto')}
          {money('colchon_target', 'Colchón objetivo')}
          {money('monthly_saving_target', 'Ahorro mensual')}
        </div>
        <h3 className="mt-2 text-sm font-semibold text-slate-300">Recomendador de abonos</h3>
        <div className="grid grid-cols-3 gap-3">
          {money('abono_min', 'Abono mínimo')}
          {pct('abono_safety_pct', 'Margen (%)')}
          {money('abono_round', 'Redondeo')}
        </div>
        <Field label="Zona horaria">
          <input className={inputClass} value={f.timezone} onChange={(e) => set('timezone')(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">El abono extra mensual, su mes de inicio, el % de décimos y el orden de abonos se ajustan en el Simulador → “Guardar como mi plan”.</p>
        {msg && <p role="status" className="text-sm text-emerald-300">{msg}</p>}
        <Button type="submit" disabled={save.isPending || !online}>
          {save.isPending ? 'Guardando…' : 'Guardar ajustes'}
        </Button>
      </form>
    </Card>
  );
}

const fixedSchema = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre').max(80),
  amount: z.number({ error: 'Monto no válido' }).finite().min(0, 'Monto no válido'),
  due_day: z.number().int().min(1, 'Día entre 1 y 31').max(31, 'Día entre 1 y 31').nullable(),
  active: z.boolean(),
});

function FixedExpensesCard() {
  const fixed = useFixedExpenses();
  const paid = useFixedPayments();
  const del = useDeleteFixedExpense();
  const delPaid = useDeleteFixedPayment();
  const online = useOnline();
  const [editing, setEditing] = useState<FixedExpense | 'new' | null>(null);

  return (
    <Card title="Gastos fijos" action={<Button variant="secondary" className="text-sm" onClick={() => setEditing('new')} disabled={!online}>+ Agregar</Button>}>
      {fixed.isLoading && <Loading />}
      {fixed.error && <ErrorBox error={fixed.error} />}
      {fixed.data?.length === 0 && <Empty>Sin gastos fijos.</Empty>}
      <ul className="divide-y divide-slate-800">
        {fixed.data?.map((f) =>
          editing !== 'new' && editing?.id === f.id ? (
            <li key={f.id} className="py-2">
              <FixedExpenseEditor expense={f} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className={`font-medium ${f.active ? '' : 'text-slate-500 line-through'}`}>{f.name}</p>
                <p className="text-xs text-slate-400">
                  {formatMoney(f.amount)}
                  {f.due_day ? ` · día ${f.due_day}` : ''}
                </p>
              </div>
              <div className="flex">
                <Button variant="ghost" onClick={() => setEditing(f)} disabled={!online} aria-label={`Editar ${f.name}`}>✎</Button>
                <Button
                  variant="ghost"
                  aria-label={`Borrar ${f.name}`}
                  disabled={!online}
                  onClick={() => confirm(`¿Borrar “${f.name}” y su historial?`) && del.mutate(f.id)}
                >
                  🗑
                </Button>
              </div>
            </li>
          ),
        )}
      </ul>
      {editing === 'new' && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <FixedExpenseEditor onDone={() => setEditing(null)} />
        </div>
      )}
      {(paid.data?.length ?? 0) > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-slate-400">Pagos registrados</summary>
          <ul className="mt-2 divide-y divide-slate-800 text-sm">
            {paid.data!.slice(0, 30).map((p) => (
              <li key={p.id} className="flex items-center justify-between py-1">
                <span>
                  {fixed.data?.find((f) => f.id === p.expense_id)?.name ?? '—'} · {formatMonth(p.month.slice(0, 7), true)} · {formatMoney(p.amount)}
                </span>
                <Button variant="ghost" aria-label="Borrar pago" disabled={!online} onClick={() => confirm('¿Borrar este pago?') && delPaid.mutate(p.id)}>
                  🗑
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function FixedExpenseEditor({ expense, onDone }: { expense?: FixedExpense; onDone: () => void }) {
  const save = useSaveFixedExpense();
  const [name, setName] = useState(expense?.name ?? '');
  const [amount, setAmount] = useState(expense ? s2(expense.amount) : '');
  const [dueDay, setDueDay] = useState(expense?.due_day?.toString() ?? '');
  const [active, setActive] = useState(expense?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = fixedSchema.safeParse({ name, amount: parseMoney(amount), due_day: dueDay ? Number(dueDay) : null, active });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    try {
      await save.mutateAsync({ ...parsed.data, id: expense?.id });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-3">
          <Field label="Nombre">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Monto">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
        </div>
        <Field label="Día">
          <input className={inputClass} inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </Field>
      </div>
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Activo
      </label>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={save.isPending}>Guardar</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
      </div>
    </form>
  );
}

function IncomesCard() {
  const incomes = useIncomes();
  const del = useDeleteIncome();
  const online = useOnline();
  return (
    <Card title="Ingresos registrados">
      {incomes.isLoading && <Loading />}
      {incomes.error && <ErrorBox error={incomes.error} />}
      {incomes.data?.length === 0 && <Empty>Sin ingresos. Regístralos desde Hoy.</Empty>}
      <ul className="divide-y divide-slate-800 text-sm">
        {incomes.data?.slice(0, 20).map((i) => (
          <li key={i.id} className="flex items-center justify-between py-1">
            <span>
              {formatDate(i.received_on)} · {INCOME_KIND_LABEL[i.kind]} · {formatMoney(i.amount)}
            </span>
            <Button variant="ghost" aria-label="Borrar ingreso" disabled={!online} onClick={() => confirm('¿Borrar este ingreso?') && del.mutate(i.id)}>
              🗑
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function CheckinsCard() {
  const checkins = useCheckins();
  const del = useDeleteCheckin();
  const online = useOnline();
  return (
    <Card title="Historial de saldos">
      {checkins.isLoading && <Loading />}
      {checkins.error && <ErrorBox error={checkins.error} />}
      {checkins.data?.length === 0 && <Empty>Sin check-ins todavía.</Empty>}
      <ul className="divide-y divide-slate-800 text-sm">
        {checkins.data?.slice(0, 20).map((c) => (
          <li key={c.id} className="flex items-center justify-between py-1">
            <span>
              {formatDate(c.checked_on)} · {formatMoney(c.balance)}
            </span>
            <Button variant="ghost" aria-label="Borrar check-in" disabled={!online} onClick={() => confirm('¿Borrar este check-in?') && del.mutate(c.id)}>
              🗑
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

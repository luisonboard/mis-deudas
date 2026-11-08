import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  useCheckins,
  useDebts,
  useFixedExpenses,
  useFixedPayments,
  useIncomes,
  usePayments,
  useSaveCheckin,
  useSavingsMovements,
  useSettings,
} from '../../lib/api';
import { addDays, isLastDayOfMonth, todayIn } from '../../lib/dates';
import { formatDate, formatMoney, parseMoney } from '../../lib/format';
import { estimateSpend, type SpendResult } from '../../lib/finance/daily';
import { nextFixedExpenses, nextPayments } from '../../lib/finance/nextPayment';
import type { BalanceCheckin } from '../../lib/types';
import { useUserId } from '../auth/AuthProvider';
import { Button, Card, Empty, ErrorBox, Field, Loading, MoneyInput, ProgressBar, Sheet, Stat, useOnline } from '../../components/ui';
import { FixedPaymentForm, IncomeForm, PaymentForm } from '../daily/forms';

type SheetKind = 'payment' | 'fixed' | 'income' | null;

interface UpcomingItem {
  key: string;
  kind: 'debt' | 'fixed';
  name: string;
  amount: number;
  due: string | null;
  daysLeft: number | null;
  expenseId?: string;
  month?: string;
}

function dueLabel(daysLeft: number): string {
  if (daysLeft < 0) return `vencido hace ${-daysLeft} día${daysLeft === -1 ? '' : 's'}`;
  if (daysLeft === 0) return 'vence hoy';
  return `en ${daysLeft} día${daysLeft === 1 ? '' : 's'}`;
}

export function TodayPage() {
  const settings = useSettings();
  const tz = settings.data?.timezone ?? 'America/Guayaquil';
  const today = todayIn(tz);
  const debts = useDebts();
  const payments = usePayments();
  const checkins = useCheckins();
  const incomes = useIncomes();
  const fixedPayments = useFixedPayments();
  const movements = useSavingsMovements();
  const fixed = useFixedExpenses();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [fixedPick, setFixedPick] = useState<{ expenseId: string; month: string } | null>(null);

  const dailyBudget = settings.data?.daily_living_budget ?? 12.5;
  const salaryToday = (incomes.data ?? []).some((i) => i.kind === 'salary' && i.received_on === today);

  // Gasto estimado entre check-ins consecutivos (orden ascendente).
  const spends = useMemo(() => {
    const list = [...(checkins.data ?? [])].sort((a, b) => a.checked_on.localeCompare(b.checked_on));
    const inputs = {
      incomes: (incomes.data ?? []).map((i) => ({ date: i.received_on, amount: i.amount })),
      debtPayments: (payments.data ?? []).map((p) => ({ date: p.paid_on, amount: p.amount })),
      fixedPayments: (fixedPayments.data ?? []).map((p) => ({ date: p.paid_on, amount: p.amount })),
      savingsFromAccount: (movements.data ?? []).filter((m) => m.from_main_account).map((m) => ({ date: m.moved_on, amount: m.amount })),
    };
    const out: { curr: BalanceCheckin; prev: BalanceCheckin; r: SpendResult }[] = [];
    for (let i = 1; i < list.length; i++) {
      out.push({
        prev: list[i - 1],
        curr: list[i],
        r: estimateSpend({
          prev: { date: list[i - 1].checked_on, balance: list[i - 1].balance },
          curr: { date: list[i].checked_on, balance: list[i].balance },
          ...inputs,
        }),
      });
    }
    return out;
  }, [checkins.data, incomes.data, payments.data, fixedPayments.data, movements.data]);

  const week = useMemo(() => {
    const from = addDays(today, -7);
    const inWeek = spends.filter((s) => s.curr.checked_on > from);
    const spent = inWeek.reduce((s, x) => s + Math.max(x.r.estimated, 0), 0);
    const days = inWeek.reduce((s, x) => s + x.r.days, 0);
    // Racha: check-ins consecutivos (desde el último) con gasto diario ≤ tope.
    let streak = 0;
    for (let i = spends.length - 1; i >= 0 && spends[i].r.perDay <= dailyBudget + 0.005 && !spends[i].r.suspicious; i--) streak += spends[i].r.days;
    // Tope semanal fijo (7 días) y tope proporcional a los días que ya tienen datos.
    const coveredDays = Math.min(days, 7);
    return { spent, days: coveredDays, budget: 7 * dailyBudget, paceBudget: coveredDays * dailyBudget, streak };
  }, [spends, today, dailyBudget]);

  const totals = useMemo(() => {
    const active = (debts.data ?? []).filter((d) => d.status !== 'archived');
    const initial = active.reduce((s, d) => s + d.initial_balance, 0);
    const current = active.reduce((s, d) => s + d.current_balance, 0);
    return { initial, current, paid: initial - current };
  }, [debts.data]);

  const upcomingDebts = useMemo(() => {
    const byDebt: Record<string, string[]> = {};
    for (const p of payments.data ?? []) if (p.kind === 'regular') (byDebt[p.debt_id] ??= []).push(p.paid_on);
    return nextPayments(
      (debts.data ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        status: d.status,
        currentBalance: d.current_balance,
        monthlyPayment: d.monthly_payment,
        minPayment: d.min_payment,
        dueDay: d.due_day,
        firstPaymentDate: d.first_payment_date,
        oneOffFirstMonth: d.one_off_first_month,
      })),
      today,
      byDebt,
    );
  }, [debts.data, payments.data, today]);

  // Próximos pagos: deudas + gastos fijos, ordenados por fecha (los sin fecha al final).
  const upcoming = useMemo<UpcomingItem[]>(() => {
    const paidMonths: Record<string, string[]> = {};
    for (const p of fixedPayments.data ?? []) (paidMonths[p.expense_id] ??= []).push(p.month);
    const fixedItems = nextFixedExpenses(
      (fixed.data ?? []).map((f) => ({ id: f.id, name: f.name, amount: f.amount, dueDay: f.due_day, active: f.active })),
      today,
      paidMonths,
    );
    const items: UpcomingItem[] = [
      ...upcomingDebts.map((p) => ({ key: `d-${p.debtId}`, kind: 'debt' as const, name: p.name, amount: p.amount, due: p.due, daysLeft: p.daysLeft })),
      ...fixedItems.map((f) => ({
        key: `f-${f.expenseId}`,
        kind: 'fixed' as const,
        name: f.name,
        amount: f.amount,
        due: f.due,
        daysLeft: f.daysLeft,
        expenseId: f.expenseId,
        month: f.month,
      })),
    ];
    return items.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  }, [upcomingDebts, fixed.data, fixedPayments.data, today]);

  const loading = settings.isLoading || debts.isLoading || checkins.isLoading;
  const error = settings.error || debts.error || checkins.error;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => { settings.refetch(); debts.refetch(); checkins.refetch(); }} />;

  const last = spends[spends.length - 1];
  const lastCheckin = checkins.data?.[0];
  const dated = upcoming.filter((u) => u.due);
  const undated = upcoming.filter((u) => !u.due);
  const next = dated[0];
  const openFixed = (u: UpcomingItem) => {
    setFixedPick(u.expenseId && u.month ? { expenseId: u.expenseId, month: u.month } : null);
    setSheet('fixed');
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <p className="text-sm text-slate-400">{formatDate(today)}</p>
        <h1 className="text-2xl font-bold">Hoy</h1>
      </header>

      {!settings.data && (
        <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Aún no configuras tus ajustes. <Link to="/ajustes" className="underline">Ir a Ajustes</Link>
        </p>
      )}

      {isLastDayOfMonth(today) && settings.data?.payday_rule === 'last_day' && !salaryToday && (
        <Card className="border-emerald-500/40">
          <p className="font-semibold">¿Ya te depositaron el sueldo?</p>
          <Button className="mt-2" onClick={() => setSheet('income')}>
            Registrar sueldo
          </Button>
        </Card>
      )}

      <CheckinCard today={today} last={lastCheckin} />

      <div className="grid grid-cols-3 gap-2">
        <Button variant="secondary" className="text-sm" onClick={() => setSheet('payment')}>
          Pago de tarjeta
        </Button>
        <Button variant="secondary" className="text-sm" onClick={() => { setFixedPick(null); setSheet('fixed'); }}>
          Gasto fijo
        </Button>
        <Button variant="secondary" className="text-sm" onClick={() => setSheet('income')}>
          Ingreso
        </Button>
      </div>

      {last && last.curr.checked_on === today && (
        <Card title="Gasto estimado">
          {last.r.suspicious ? (
            <p role="alert" className="text-sm text-amber-300">
              El saldo subió {formatMoney(-last.r.estimated)} sin ingresos registrados. ¿Falta registrar un ingreso o sobra un pago?
            </p>
          ) : (
            <>
              <p className="text-3xl font-bold tabular-nums">
                {formatMoney(last.r.perDay)}
                <span className="text-base font-normal text-slate-400"> / día</span>
              </p>
              <p className={`text-sm ${last.r.perDay > dailyBudget ? 'text-red-400' : 'text-emerald-300'}`}>
                Tope {formatMoney(dailyBudget)} / día ·{' '}
                {last.r.perDay > dailyBudget ? `te pasaste ${formatMoney(last.r.perDay - dailyBudget)}` : 'bajo el tope 👍'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {formatMoney(last.r.estimated)} en {last.r.days} día(s) desde el {formatDate(last.prev.checked_on)}
              </p>
            </>
          )}
        </Card>
      )}

      <Card title="Gasto de la semana">
        {week.days === 0 ? (
          <Empty>Haz check-in dos días seguidos para ver tu gasto estimado.</Empty>
        ) : (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-xl font-bold tabular-nums">{formatMoney(week.spent)}</p>
              <p className="text-sm text-slate-400">de {formatMoney(week.budget)} (7 días)</p>
            </div>
            <div className="mt-2">
              <ProgressBar
                value={week.spent / week.budget}
                tone={week.spent > week.paceBudget + 0.005 ? 'red' : 'emerald'}
                label="Gasto de los últimos 7 días frente al tope semanal"
              />
            </div>
            <p className={`mt-2 text-sm ${week.spent > week.paceBudget + 0.005 ? 'text-red-400' : 'text-emerald-300'}`}>
              {week.days < 7 ? `${week.days} de 7 días con datos · ` : ''}
              {week.spent > week.paceBudget + 0.005
                ? `vas ${formatMoney(week.spent - week.paceBudget)} por encima de tu ritmo`
                : `vas ${formatMoney(week.paceBudget - week.spent)} por debajo de tu ritmo`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Ritmo = {formatMoney(dailyBudget)} × días con datos = {formatMoney(week.paceBudget)} · quedan {formatMoney(Math.max(week.budget - week.spent, 0))} esta semana
            </p>
            <p className="mt-2 text-sm text-slate-300">Racha bajo el tope: {week.streak} día(s)</p>
          </>
        )}
      </Card>

      <Card title="Deudas">
        {totals.initial === 0 ? (
          <Empty>
            Sin deudas registradas. <Link to="/deudas" className="underline">Agregar</Link>
          </Empty>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Deuda actual" value={totals.current} />
              <Stat label="Capital pagado" value={totals.paid} />
            </div>
            <div className="mt-3">
              <ProgressBar value={totals.paid / totals.initial} label="Capital pagado sobre deuda inicial" />
            </div>
            <p className="mt-2 text-xs text-slate-500">La fecha libre de deudas y el interés proyectado llegan en la Fase 2 (simulador).</p>
          </>
        )}
      </Card>

      <Card title="Próximos pagos">
        {next ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">{next.name}</p>
              <p className="text-sm text-slate-400">
                {next.kind === 'fixed' ? 'Gasto fijo' : 'Deuda'} · {formatDate(next.due!)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold tabular-nums">{formatMoney(next.amount)}</p>
              <p className={`text-sm ${next.daysLeft! < 0 ? 'text-red-400' : next.daysLeft! <= 3 ? 'text-amber-300' : 'text-slate-400'}`}>
                {dueLabel(next.daysLeft!)}
              </p>
            </div>
          </div>
        ) : (
          undated.length === 0 && <Empty>No hay pagos próximos.</Empty>
        )}
        {(dated.length > 1 || undated.length > 0) && (
          <ul className="mt-3 divide-y divide-slate-800 text-sm">
            {[...dated.slice(1), ...undated].map((u) => {
              const row = (
                <>
                  <span className="min-w-0">
                    <span className="block truncate">
                      {u.name}
                      {u.kind === 'fixed' && <span className="ml-1.5 rounded bg-slate-800 px-1.5 text-xs text-slate-400">fijo</span>}
                    </span>
                    <span className={`text-xs ${u.daysLeft !== null && u.daysLeft < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                      {u.due ? `${formatDate(u.due)} · ${dueLabel(u.daysLeft!)}` : 'este mes · sin día de pago'}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">{formatMoney(u.amount)}</span>
                </>
              );
              return (
                <li key={u.key}>
                  {u.kind === 'fixed' ? (
                    <button
                      type="button"
                      onClick={() => openFixed(u)}
                      className="flex min-h-[44px] w-full items-center justify-between gap-2 py-1.5 text-left text-slate-300 hover:text-white"
                      aria-label={`Marcar ${u.name} como pagado`}
                    >
                      {row}
                    </button>
                  ) : (
                    <div className="flex min-h-[44px] items-center justify-between gap-2 py-1.5 text-slate-300">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {upcoming.some((u) => u.kind === 'fixed') && (
          <p className="mt-2 text-xs text-slate-500">
            Toca un gasto fijo para marcarlo como pagado. Ponle día de pago en <Link to="/ajustes" className="underline">Ajustes</Link> para ordenarlo por fecha.
          </p>
        )}
        {next?.kind === 'fixed' && (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => openFixed(next)}>
            Marcar {next.name} como pagado
          </Button>
        )}
      </Card>

      <Sheet title="Registrar pago de tarjeta" open={sheet === 'payment'} onClose={() => setSheet(null)}>
        <PaymentForm onDone={() => setSheet(null)} />
      </Sheet>
      <Sheet title="Gasto fijo pagado" open={sheet === 'fixed'} onClose={() => setSheet(null)}>
        <FixedPaymentForm
          key={fixedPick ? `${fixedPick.expenseId}-${fixedPick.month}` : 'any'}
          expenseId={fixedPick?.expenseId}
          month={fixedPick?.month}
          onDone={() => setSheet(null)}
        />
      </Sheet>
      <Sheet title="Registrar ingreso" open={sheet === 'income'} onClose={() => setSheet(null)}>
        <IncomeForm defaultSalary={settings.data?.monthly_income || undefined} onDone={() => setSheet(null)} />
      </Sheet>
    </div>
  );
}

function CheckinCard({ today, last }: { today: string; last?: BalanceCheckin }) {
  const save = useSaveCheckin();
  const online = useOnline();
  const userId = useUserId();
  const [value, setValue] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = value ?? (last ? String(last.balance).replace('.', ',') : '');
  const doneToday = last?.checked_on === today;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const balance = parseMoney(shown);
    if (!Number.isFinite(balance)) return setMsg({ ok: false, text: 'Ingresa un saldo válido' });
    try {
      await save.mutateAsync({ user_id: userId, checked_on: today, balance: Math.round(balance * 100) / 100 });
      setValue(null);
      setMsg({ ok: true, text: 'Saldo guardado' });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };

  return (
    <Card title="Check-in diario" action={doneToday ? <span className="text-xs text-emerald-300">✓ hecho hoy</span> : undefined}>
      <form onSubmit={submit} className="flex items-end gap-2" noValidate>
        <div className="flex-1">
          <Field label="Saldo de tu cuenta hoy" hint={last ? `Último: ${formatMoney(last.balance)} el ${formatDate(last.checked_on)}` : undefined}>
            <MoneyInput value={shown} onChange={(v) => { setValue(v); setMsg(null); }} />
          </Field>
        </div>
        <Button type="submit" disabled={save.isPending || !online} className={last ? 'mb-5' : ''}>
          {save.isPending ? '…' : 'Guardar'}
        </Button>
      </form>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${msg.ok ? 'text-emerald-300' : 'text-red-400'}`}>
          {msg.text}
        </p>
      )}
    </Card>
  );
}

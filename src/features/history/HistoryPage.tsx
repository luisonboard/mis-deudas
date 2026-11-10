import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  useCheckins,
  useDebts,
  useFixedExpenses,
  useFixedPayments,
  useIncomes,
  usePayments,
  useSavingsGoals,
  useSavingsMovements,
  useSettings,
} from '../../lib/api';
import { addMonths, monthOf, todayIn } from '../../lib/dates';
import { formatDate, formatMoney, formatMonth } from '../../lib/format';
import { buildHistory, dailyPoints, summarizeMonth, type DayPoint, type HistoryMovement, type HistoryRow } from '../../lib/finance/history';
import { INCOME_KIND_LABEL, PAYMENT_KIND_LABEL } from '../../lib/types';
import { Button, Card, Empty, ErrorBox, Loading, ProgressBar, Stat } from '../../components/ui';

// Paleta: azul (slot 1) = bajo el tope; rojo (estado "crítico") = sobre el tope, siempre con etiqueta en tooltip y lista.
const UNDER = '#3987e5';
const OVER = '#e66767';

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const weekday = (iso: string) => WEEKDAYS[new Date(`${iso}T12:00:00Z`).getUTCDay()];

type MovementRow = HistoryMovement & { affectsBalance?: boolean; detail?: string };

export function HistoryPage() {
  const settings = useSettings();
  const checkins = useCheckins();
  const payments = usePayments();
  const fixedPayments = useFixedPayments();
  const incomes = useIncomes();
  const movements = useSavingsMovements();
  const debts = useDebts();
  const fixed = useFixedExpenses();
  const goals = useSavingsGoals();
  const today = todayIn(settings.data?.timezone);
  const [month, setMonth] = useState(monthOf(today));
  const [open, setOpen] = useState<string | null>(null);
  const budget = settings.data?.daily_living_budget ?? 12.5;

  const allMovements = useMemo<MovementRow[]>(() => {
    const debtName = new Map((debts.data ?? []).map((d) => [d.id, d.name]));
    const fixedName = new Map((fixed.data ?? []).map((f) => [f.id, f.name]));
    const goalName = new Map((goals.data ?? []).map((g) => [g.id, g.name]));
    return [
      ...(incomes.data ?? []).map((i) => ({ date: i.received_on, type: 'income' as const, name: INCOME_KIND_LABEL[i.kind], amount: i.amount, detail: i.note ?? undefined })),
      ...(payments.data ?? []).map((p) => ({
        date: p.paid_on,
        type: 'debt' as const,
        name: debtName.get(p.debt_id) ?? 'Deuda',
        amount: p.amount,
        detail: PAYMENT_KIND_LABEL[p.kind],
      })),
      ...(fixedPayments.data ?? []).map((f) => ({ date: f.paid_on, type: 'fixed' as const, name: fixedName.get(f.expense_id) ?? 'Gasto fijo', amount: f.amount })),
      ...(movements.data ?? []).map((m) => ({
        date: m.moved_on,
        type: 'saving' as const,
        name: goalName.get(m.goal_id) ?? 'Ahorro',
        amount: m.amount,
        affectsBalance: m.from_main_account,
        detail: m.from_main_account ? undefined : 'no pasa por la cuenta',
      })),
    ];
  }, [incomes.data, payments.data, fixedPayments.data, movements.data, debts.data, fixed.data, goals.data]);

  const rows = useMemo(
    () => buildHistory((checkins.data ?? []).map((c) => ({ date: c.checked_on, balance: c.balance })), allMovements, budget),
    [checkins.data, allMovements, budget],
  );
  const summary = useMemo(() => summarizeMonth(rows, month, budget, allMovements), [rows, month, budget, allMovements]);
  const points = useMemo(() => dailyPoints(rows, month, budget), [rows, month, budget]);
  const monthRows = rows.filter((r) => monthOf(r.date) === month);

  const loading = checkins.isLoading || payments.isLoading || incomes.isLoading || fixedPayments.isLoading || movements.isLoading;
  const error = checkins.error || payments.error || incomes.error || fixedPayments.error || movements.error;
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={() => checkins.refetch()} />;

  const firstMonth = rows.length ? monthOf(rows[rows.length - 1].date) : monthOf(today);
  const canPrev = month > firstMonth;
  const canNext = month < monthOf(today);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <Link to="/" className="text-sm text-slate-400 underline">
          ← Hoy
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Historial</h1>
      </header>

      <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-1">
        <Button variant="ghost" aria-label="Mes anterior" disabled={!canPrev} onClick={() => setMonth(addMonths(month, -1))}>
          ◀
        </Button>
        <p className="font-semibold capitalize">{formatMonth(month)}</p>
        <Button variant="ghost" aria-label="Mes siguiente" disabled={!canNext} onClick={() => setMonth(addMonths(month, 1))}>
          ▶
        </Button>
      </div>

      {monthRows.length === 0 ? (
        <Empty>Sin check-ins en {formatMonth(month)}.</Empty>
      ) : (
        <>
          <Summary s={summary} budget={budget} />
          {points.length > 0 && (
            <Card title="Gasto por día">
              <DayChart points={points} budget={budget} />
            </Card>
          )}
          <Card title="Día por día">
            <ul className="divide-y divide-slate-800">
              {monthRows.map((r) => (
                <DayRow key={r.date} row={r} budget={budget} expanded={open === r.date} onToggle={() => setOpen(open === r.date ? null : r.date)} />
              ))}
            </ul>
          </Card>
        </>
      )}
      <p className="text-center text-xs text-slate-500">
        El gasto se estima con tus check-ins: saldo anterior + ingresos − pagos − ahorros − saldo actual. Si saltas días, se reparte entre ellos.
      </p>
    </div>
  );
}

function Summary({ s, budget }: { s: ReturnType<typeof summarizeMonth>; budget: number }) {
  const over = s.spent > s.budget + 0.005;
  return (
    <Card>
      <p className="text-sm text-slate-400">Gasto estimado del día a día</p>
      <p className="text-3xl font-bold tabular-nums">{formatMoney(s.spent)}</p>
      <p className={`text-sm ${over ? 'text-red-400' : 'text-emerald-300'}`}>
        {s.days > 0 ? (
          <>
            {formatMoney(s.avgPerDay)} / día en promedio · tope {formatMoney(budget)} ·{' '}
            {over ? `${formatMoney(s.spent - s.budget)} sobre el tope` : `${formatMoney(s.budget - s.spent)} bajo el tope`}
          </>
        ) : (
          'Haz check-in dos días para estimar el gasto.'
        )}
      </p>
      {s.days > 0 && (
        <div className="mt-3">
          <ProgressBar value={s.daysUnder / s.days} label="Días bajo el tope" />
          <p className="mt-1 text-xs text-slate-400">
            {s.daysUnder} de {s.days} día{s.days === 1 ? '' : 's'} bajo el tope
          </p>
        </div>
      )}
      {s.warnings > 0 && (
        <p role="alert" className="mt-2 text-xs text-amber-300">
          {s.warnings} día{s.warnings === 1 ? '' : 's'} con el saldo subiendo sin ingresos registrados (no cuentan en el gasto).
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Stat label="Ingresos" value={s.incomes} />
        <Stat label="Pagos a deudas" value={s.debtPaid} />
        <Stat label="Gastos fijos" value={s.fixedPaid} />
        <Stat label="Ahorro neto" value={s.saved} />
      </div>
      {s.firstBalance !== null && s.lastBalance !== null && (
        <p className="mt-3 text-xs text-slate-400 tabular-nums">
          Saldo de la cuenta: {formatMoney(s.firstBalance)} → {formatMoney(s.lastBalance)}
        </p>
      )}
    </Card>
  );
}

function DayTip({ active, payload }: { active?: boolean; payload?: { payload?: DayPoint }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-lg">
      <p className="text-slate-400">
        {weekday(p.date)} {formatDate(p.date)}
      </p>
      <p>
        <strong className="tabular-nums text-slate-100">{formatMoney(p.spent)}</strong>{' '}
        <span className={p.over ? 'text-red-300' : 'text-slate-400'}>{p.over ? '▲ sobre el tope' : 'bajo el tope'}</span>
      </p>
      {p.averaged && <p className="text-slate-500">promedio de varios días sin check-in</p>}
    </div>
  );
}

function DayChart({ points, budget }: { points: DayPoint[]; budget: number }) {
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNDER }} /> Bajo el tope
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: OVER }} /> Sobre el tope
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="6" aria-hidden>
            <line x1="0" y1="3" x2="16" y2="3" stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
          Tope {formatMoney(budget)}
        </span>
        <span className="text-slate-500">Más tenue = promedio de días sin check-in</span>
      </figcaption>
      <div className="h-48 w-full" role="img" aria-label="Gasto estimado por día frente al tope diario">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => String(Number(d.slice(8, 10)))}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
              minTickGap={8}
            />
            <YAxis tickFormatter={(n: number) => `$${Math.round(n)}`} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<DayTip />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} isAnimationActive={false} />
            <ReferenceLine y={budget} stroke="#cbd5e1" strokeDasharray="3 2" strokeWidth={1.5} ifOverflow="extendDomain" />
            <Bar dataKey="spent" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {points.map((p) => (
                <Cell key={p.date} fill={p.over ? OVER : UNDER} fillOpacity={p.averaged ? 0.55 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

const TYPE_LABEL: Record<HistoryMovement['type'], string> = { income: 'Ingreso', debt: 'Pago', fixed: 'Gasto fijo', saving: 'Ahorro' };

function DayRow({ row, budget, expanded, onToggle }: { row: HistoryRow; budget: number; expanded: boolean; onToggle: () => void }) {
  const movs = row.movements as MovementRow[];
  return (
    <li className="py-2">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left">
        <span className="min-w-0">
          <span className="block font-medium">
            {weekday(row.date)} {formatDate(row.date)}
          </span>
          <span className="text-xs text-slate-400 tabular-nums">
            Saldo {formatMoney(row.balance)}
            {movs.length > 0 && ` · ${movs.length} movimiento${movs.length === 1 ? '' : 's'}`}
            {row.days > 1 && ` · ${row.days} días desde el ${formatDate(row.prevDate!)}`}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {row.perDay === null ? (
            <span className="text-xs text-slate-500">primer check-in</span>
          ) : row.suspicious ? (
            <span className="text-xs text-amber-300">⚠ revisar</span>
          ) : (
            <>
              <span className={`block font-semibold tabular-nums ${row.overBudget ? 'text-red-400' : 'text-emerald-300'}`}>
                {formatMoney(row.perDay)}
                <span className="text-xs font-normal text-slate-400">/día</span>
              </span>
              <span className={`text-xs ${row.overBudget ? 'text-red-400' : 'text-slate-500'}`}>
                {row.overBudget ? `▲ ${formatMoney(row.perDay - budget)} sobre el tope` : 'bajo el tope'}
              </span>
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div className="mt-1 rounded-lg bg-slate-800/50 p-2 text-sm">
          {row.suspicious && (
            <p className="mb-1 text-xs text-amber-300">
              El saldo subió {formatMoney(-(row.estimated ?? 0))} más de lo registrado. ¿Falta un ingreso o sobra un pago?
            </p>
          )}
          {row.estimated !== null && !row.suspicious && row.days > 1 && (
            <p className="mb-1 text-xs text-slate-400">
              Gasto total del intervalo: {formatMoney(row.estimated)} en {row.days} días.
            </p>
          )}
          {movs.length === 0 ? (
            <p className="text-xs text-slate-500">Sin pagos, ingresos ni ahorros registrados.</p>
          ) : (
            <ul className="space-y-1">
              {movs.map((m, i) => (
                <li key={`${m.type}-${m.date}-${i}`} className="flex justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate">{m.name}</span>
                    <span className="text-xs text-slate-500">
                      {TYPE_LABEL[m.type]}
                      {m.detail && ` · ${m.detail}`}
                      {row.days > 1 && ` · ${formatDate(m.date)}`}
                    </span>
                  </span>
                  <span className={`shrink-0 tabular-nums ${m.type === 'income' || (m.type === 'saving' && m.amount < 0) ? 'text-emerald-300' : 'text-slate-200'}`}>
                    {m.type === 'income' || (m.type === 'saving' && m.amount < 0) ? '+' : '−'}
                    {formatMoney(Math.abs(m.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import {
  useAddMovement,
  useDeleteGoal,
  useDeleteMovement,
  useSaveGoal,
  useSavingsGoals,
  useSavingsMovements,
  useSettings,
  type SavingsGoalBalance,
} from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { formatDate, formatMoney, parseMoney } from '../../lib/format';
import { goalProgress, nextGoalToFund } from '../../lib/finance/savings';
import { Button, Card, Empty, ErrorBox, Field, Loading, MoneyInput, ProgressBar, Sheet, Stat, inputClass, useOnline } from '../../components/ui';

const toInput = (g: SavingsGoalBalance) => ({ id: g.id, name: g.name, target: g.target_amount, balance: g.balance, priority: g.priority });

export function SavingsPage() {
  const goals = useSavingsGoals();
  const movements = useSavingsMovements();
  const settings = useSettings();
  const online = useOnline();
  const [moving, setMoving] = useState<{ goalId: string; kind: 'save' | 'withdraw' } | null>(null);
  const [editing, setEditing] = useState<SavingsGoalBalance | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  if (goals.isLoading) return <Loading />;
  if (goals.error) return <ErrorBox error={goals.error} onRetry={() => goals.refetch()} />;

  const list = goals.data ?? [];
  const total = list.reduce((s, g) => s + g.balance, 0);
  const next = nextGoalToFund(list.map(toInput));
  const colchonTarget = settings.data?.colchon_target ?? 300;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ahorros</h1>
        <Button variant="secondary" onClick={() => setEditing('new')} disabled={!online}>
          + Meta
        </Button>
      </header>

      <Card className="border-sky-500/30">
        <p className="font-semibold">Primero el colchón de {formatMoney(colchonTarget)}, luego el extra a deuda.</p>
        <p className="mt-1 text-sm text-slate-400">
          {next ? (
            <>
              El próximo ahorro va a <strong className="text-slate-200">{next.name}</strong>: le faltan {formatMoney(next.remaining)}.
            </>
          ) : list.length > 0 ? (
            'Todas tus metas están completas. 🎉'
          ) : (
            'Crea tus metas: el colchón con la prioridad más alta (número menor).'
          )}
        </p>
        {list.length > 0 && (
          <div className="mt-3">
            <Stat label="Total ahorrado" value={total} />
          </div>
        )}
      </Card>

      {list.length === 0 && <Empty>Sin metas de ahorro todavía.</Empty>}

      {list.map((g) => {
        const p = goalProgress(toInput(g));
        const mine = (movements.data ?? []).filter((m) => m.goal_id === g.id);
        return (
          <Card key={g.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{g.name}</h2>
                <p className="text-xs text-slate-400">
                  Meta {formatMoney(g.target_amount)} · prioridad {g.priority}
                </p>
              </div>
              <p className="text-right text-xl font-bold tabular-nums">{formatMoney(g.balance)}</p>
            </div>
            <div className="mt-3">
              <ProgressBar value={p.pct} tone={p.done ? 'emerald' : 'sky'} label={`${g.name}: avance hacia la meta`} />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {Math.round(p.pct * 100)} % · {p.done ? 'meta cumplida ✓' : `faltan ${formatMoney(p.remaining)}`}
            </p>
            <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
              <Button onClick={() => setMoving({ goalId: g.id, kind: 'save' })} disabled={!online}>
                Ahorrar
              </Button>
              <Button variant="secondary" onClick={() => setMoving({ goalId: g.id, kind: 'withdraw' })} disabled={!online || g.balance <= 0}>
                Retirar
              </Button>
              <Button variant="ghost" aria-label={`Editar ${g.name}`} onClick={() => setEditing(g)} disabled={!online}>
                ✎
              </Button>
            </div>
            {mine.length > 0 && (
              <MovementsList goalName={g.name} movements={mine} expanded={open === g.id} onToggle={() => setOpen(open === g.id ? null : g.id)} />
            )}
          </Card>
        );
      })}

      <Sheet
        title={moving?.kind === 'withdraw' ? 'Retirar ahorro' : 'Ahorrar'}
        open={moving !== null}
        onClose={() => setMoving(null)}
      >
        {moving && <MovementForm key={`${moving.goalId}-${moving.kind}`} goals={list} goalId={moving.goalId} kind={moving.kind} onDone={() => setMoving(null)} />}
      </Sheet>
      <Sheet title={editing === 'new' ? 'Nueva meta' : 'Editar meta'} open={editing !== null} onClose={() => setEditing(null)}>
        {editing && <GoalForm key={editing === 'new' ? 'new' : editing.id} goal={editing === 'new' ? undefined : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

function MovementsList({
  goalName,
  movements,
  expanded,
  onToggle,
}: {
  goalName: string;
  movements: { id: string; moved_on: string; amount: number; from_main_account: boolean; note: string | null }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const del = useDeleteMovement();
  const online = useOnline();
  return (
    <div className="mt-2">
      <button type="button" onClick={onToggle} className="min-h-[44px] text-sm text-slate-400 underline" aria-expanded={expanded}>
        {expanded ? 'Ocultar movimientos' : `Ver movimientos (${movements.length})`}
      </button>
      {expanded && (
        <ul className="divide-y divide-slate-800 text-sm">
          {movements.slice(0, 30).map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <p className={`font-medium tabular-nums ${m.amount < 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                  {m.amount < 0 ? '−' : '+'}
                  {formatMoney(Math.abs(m.amount))}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {formatDate(m.moved_on)}
                  {!m.from_main_account && ' · fuera de la cuenta'}
                  {m.note && ` · ${m.note}`}
                </p>
              </div>
              <Button
                variant="ghost"
                aria-label={`Borrar movimiento de ${goalName}`}
                disabled={!online || del.isPending}
                onClick={() => confirm('¿Borrar este movimiento?') && del.mutate(m.id)}
              >
                🗑
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const movementSchema = z.object({
  goal_id: z.uuid('Elige una meta'),
  moved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha no válida'),
  amount: z.number({ error: 'Monto no válido' }).finite('Monto no válido').positive('El monto debe ser mayor a 0'),
});

export function MovementForm({
  goals,
  goalId,
  kind: initialKind = 'save',
  initialAmount,
  onDone,
}: {
  goals: SavingsGoalBalance[];
  goalId?: string;
  kind?: 'save' | 'withdraw';
  initialAmount?: number;
  onDone?: () => void;
}) {
  const add = useAddMovement();
  const online = useOnline();
  const [selected, setSelected] = useState(goalId ?? goals[0]?.id ?? '');
  const [kind, setKind] = useState(initialKind);
  const [amount, setAmount] = useState(initialAmount ? String(initialAmount).replace('.', ',') : '');
  const [movedOn, setMovedOn] = useState(todayIn());
  // El colchón (meta de mayor prioridad) se queda dentro de la cuenta (sección 5.5); las demás salen de ella.
  const colchonId = [...goals].sort((a, b) => a.priority - b.priority)[0]?.id;
  const [fromMainChoice, setFromMain] = useState<boolean | null>(null);
  const fromMain = fromMainChoice ?? selected !== colchonId;
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const goal = goals.find((g) => g.id === selected);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = movementSchema.safeParse({ goal_id: selected, moved_on: movedOn, amount: parseMoney(amount) });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (kind === 'withdraw' && goal && parsed.data.amount > goal.balance + 0.005) {
      return setError(`No puedes retirar más de lo ahorrado (${formatMoney(goal.balance)}).`);
    }
    const value = Math.round(parsed.data.amount * 100) / 100;
    try {
      await add.mutateAsync({
        goal_id: parsed.data.goal_id,
        moved_on: parsed.data.moved_on,
        amount: kind === 'withdraw' ? -value : value,
        from_main_account: fromMain,
        note: note.trim() || null,
      });
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (goals.length === 0) return <p className="text-slate-400">Primero crea una meta de ahorro.</p>;

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de movimiento">
        {(['save', 'withdraw'] as const).map((k) => (
          <Button key={k} type="button" role="radio" aria-checked={kind === k} variant={kind === k ? 'primary' : 'secondary'} onClick={() => setKind(k)}>
            {k === 'save' ? 'Ahorrar' : 'Retirar'}
          </Button>
        ))}
      </div>
      <Field label="Meta">
        <select className={inputClass} value={selected} onChange={(e) => { setSelected(e.target.value); setFromMain(null); }}>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · {formatMoney(g.balance)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Monto">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <Field label="Fecha">
          <input type="date" className={inputClass} value={movedOn} onChange={(e) => setMovedOn(e.target.value)} />
        </Field>
      </div>
      <label className="flex min-h-[44px] items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={fromMain} onChange={(e) => setFromMain(e.target.checked)} />
        <span>
          {kind === 'save' ? 'El dinero sale de mi cuenta principal' : 'El dinero vuelve a mi cuenta principal'}
          <span className="block text-xs text-slate-500">
            {selected === colchonId
              ? 'El colchón se queda dentro de tu cuenta, por eso viene desmarcado.'
              : 'Desmárcalo si el dinero no pasa por la cuenta de tus check-ins (así no altera el gasto estimado).'}
          </span>
        </span>
      </label>
      <Field label="Nota (opcional)">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      {!online && <p className="text-xs text-amber-300">Sin conexión: no se puede guardar ahora.</p>}
      <Button type="submit" disabled={add.isPending || !online}>
        {add.isPending ? 'Guardando…' : kind === 'save' ? 'Guardar ahorro' : 'Guardar retiro'}
      </Button>
    </form>
  );
}

const goalSchema = z.object({
  name: z.string().trim().min(1, 'Ponle un nombre').max(80),
  target_amount: z.number({ error: 'Meta no válida' }).finite('Meta no válida').min(0, 'Meta no válida'),
  priority: z.number().int('Prioridad no válida').min(0, 'Prioridad no válida').max(32767),
});

function GoalForm({ goal, onDone }: { goal?: SavingsGoalBalance; onDone: () => void }) {
  const save = useSaveGoal();
  const del = useDeleteGoal();
  const online = useOnline();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? String(goal.target_amount).replace('.', ',') : '');
  const [priority, setPriority] = useState(String(goal?.priority ?? 100));
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = goalSchema.safeParse({ name, target_amount: parseMoney(target || '0'), priority: Number(priority) });
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    try {
      await save.mutateAsync({ ...parsed.data, id: goal?.id });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!goal || !confirm(`¿Borrar “${goal.name}” y todos sus movimientos?`)) return;
    try {
      await del.mutateAsync(goal.id);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Field label="Nombre">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Meta">
          <MoneyInput value={target} onChange={setTarget} />
        </Field>
        <Field label="Prioridad" hint="Menor = se llena primero">
          <input className={inputClass} inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </Field>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <Button type="submit" disabled={save.isPending || !online}>
        {save.isPending ? 'Guardando…' : goal ? 'Guardar cambios' : 'Crear meta'}
      </Button>
      {goal && (
        <Button type="button" variant="danger" onClick={remove} disabled={del.isPending || !online}>
          Borrar meta
        </Button>
      )}
    </form>
  );
}

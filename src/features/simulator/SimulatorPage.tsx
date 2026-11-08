import { useEffect, useMemo, useState } from 'react';
import { useDebts, useSavePlan, useSettings } from '../../lib/api';
import { todayIn } from '../../lib/dates';
import { formatMoney, formatMonth } from '../../lib/format';
import { useUserId } from '../auth/AuthProvider';
import { DebtChart } from '../../components/DebtChart';
import { Button, Card, Empty, ErrorBox, Field, Loading, Stat, inputClass, useOnline } from '../../components/ui';
import { usePlan } from './usePlan';

interface SimState {
  extra: number;
  pct: number; // 0–100
  startMonth: string; // 'YYYY-MM'
  order: string[]; // ids de deudas loan/revolving, de mayor a menor prioridad
}

export function SimulatorPage() {
  const settings = useSettings();
  const debts = useDebts();
  const save = useSavePlan();
  const online = useOnline();
  const userId = useUserId();
  const today = todayIn(settings.data?.timezone);
  const [sim, setSim] = useState<SimState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const eligible = useMemo(
    () => (debts.data ?? []).filter((d) => d.status === 'active' && d.current_balance > 0.005 && d.kind !== 'fixed_installments'),
    [debts.data],
  );

  // Estado inicial = "mi plan" guardado.
  const initial = useMemo<SimState | null>(() => {
    if (settings.isLoading || !debts.data) return null;
    const s = settings.data;
    const start = s?.extra_start_month?.slice(0, 7) ?? today.slice(0, 7);
    return {
      extra: s?.extra_monthly ?? 0,
      pct: Math.round((s?.decimos_pct_to_debt ?? 0.5) * 100),
      startMonth: start < today.slice(0, 7) ? today.slice(0, 7) : start,
      order: [...eligible].sort((a, b) => a.payoff_priority - b.payoff_priority).map((d) => d.id),
    };
  }, [settings.isLoading, settings.data, debts.data, eligible, today]);

  useEffect(() => {
    if (initial && !sim) setSim(initial);
  }, [initial, sim]);

  // Prioridades 10, 20, 30… según el orden elegido; las cuotas fijas no se tocan.
  const priorities = useMemo(() => Object.fromEntries((sim?.order ?? []).map((id, i) => [id, (i + 1) * 10])), [sim?.order]);
  const { plan, base, input, startDebt, isLoading, error, refetch } = usePlan(
    sim ? { extraMonthly: sim.extra, decimosPct: sim.pct / 100, extraStartMonth: sim.startMonth, priorities } : {},
  );

  if (isLoading || !sim) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!plan || !base || !input || input.debts.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Simulador</h1>
        <Empty>No tienes deudas activas para simular. 🎉</Empty>
      </div>
    );
  }

  const set = (patch: Partial<SimState>) => {
    setSim((s) => (s ? { ...s, ...patch } : s));
    setMsg(null);
  };
  const move = (i: number, dir: -1 | 1) => {
    const order = [...sim.order];
    [order[i], order[i + dir]] = [order[i + dir], order[i]];
    set({ order });
  };
  const changed = initial && JSON.stringify(sim) !== JSON.stringify(initial);
  const monthsSaved = plan.monthsToZero !== null && base.monthsToZero !== null ? base.monthsToZero - plan.monthsToZero : null;

  const savePlan = async () => {
    try {
      await save.mutateAsync({
        user_id: userId,
        extra_monthly: sim.extra,
        decimos_pct_to_debt: sim.pct / 100,
        extra_start_month: `${sim.startMonth}-01`,
        priorities,
      });
      setSim(null); // se reinicia desde lo guardado
      setMsg('Guardado como mi plan');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Simulador</h1>

      <Card>
        <p className="text-sm text-slate-400">Libre de deudas en</p>
        <p className="text-3xl font-bold">{plan.debtFreeMonth ? formatMonth(plan.debtFreeMonth) : 'más de 7 años'}</p>
        <p className="text-sm text-slate-300">
          {plan.monthsToZero !== null ? `${plan.monthsToZero} meses` : '—'} · sin abonos: {base.debtFreeMonth ? formatMonth(base.debtFreeMonth, true) : 'más de 7 años'}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Interés total" value={plan.totalInterest} />
          <Stat label="Total pagado" value={plan.totalPaid} />
          <Stat label="Meses que ahorras" value={monthsSaved !== null ? String(monthsSaved) : '—'} />
          <Stat label="Interés que ahorras" value={base.totalInterest - plan.totalInterest} />
        </div>
      </Card>

      <Card title="Ajusta tu plan">
        <div className="flex flex-col gap-5">
          <Field label={`Abono extra mensual: ${formatMoney(sim.extra)}`}>
            <input
              type="range"
              min={0}
              max={600}
              step={10}
              value={sim.extra}
              onChange={(e) => set({ extra: Number(e.target.value) })}
              className="h-11 w-full accent-emerald-400"
              aria-valuetext={formatMoney(sim.extra)}
            />
          </Field>
          <Field label={`Décimos a deuda: ${sim.pct} %`}>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={sim.pct}
              onChange={(e) => set({ pct: Number(e.target.value) })}
              className="h-11 w-full accent-emerald-400"
              aria-valuetext={`${sim.pct} %`}
            />
          </Field>
          <Field label="Mes de inicio del extra">
            <input
              type="month"
              className={inputClass}
              min={today.slice(0, 7)}
              value={sim.startMonth}
              onChange={(e) => e.target.value && set({ startMonth: e.target.value })}
            />
          </Field>
          {sim.order.length > 1 && (
            <div>
              <p className="mb-1 text-sm font-medium text-slate-300">Orden de los abonos extra</p>
              <ol className="flex flex-col gap-2">
                {sim.order.map((id, i) => {
                  const d = eligible.find((x) => x.id === id);
                  if (!d) return null;
                  return (
                    <li key={id} className="flex items-center gap-2 rounded-lg bg-slate-800/60 px-3">
                      <span className="w-5 text-slate-400">{i + 1}.</span>
                      <span className="flex-1 truncate">{d.name}</span>
                      <span className="text-xs tabular-nums text-slate-400">{formatMoney(d.current_balance)}</span>
                      <Button variant="ghost" aria-label={`Subir ${d.name}`} disabled={i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </Button>
                      <Button variant="ghost" aria-label={`Bajar ${d.name}`} disabled={i === sim.order.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </Button>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-1 text-xs text-slate-500">Las cuotas fijas no reciben abonos extra.</p>
            </div>
          )}
        </div>
      </Card>

      <Card title="Deuda total proyectada">
        <DebtChart startMonth={input.startMonth} startDebt={startDebt ?? 0} plan={plan} base={base} />
      </Card>

      {msg && (
        <p role="status" className="text-center text-sm text-emerald-300">
          {msg}
        </p>
      )}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={savePlan} disabled={!changed || save.isPending || !online}>
          {save.isPending ? 'Guardando…' : 'Guardar como mi plan'}
        </Button>
        <Button variant="secondary" onClick={() => initial && set(initial)} disabled={!changed}>
          Deshacer
        </Button>
      </div>
      <p className="text-center text-xs text-slate-500">
        Simulación desde {formatMonth(input.startMonth)} con los saldos actuales. El extra se abona el día de cobro.
      </p>
    </div>
  );
}

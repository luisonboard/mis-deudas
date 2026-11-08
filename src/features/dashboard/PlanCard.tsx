import { Link } from 'react-router-dom';
import { useDebts } from '../../lib/api';
import { formatMonth } from '../../lib/format';
import { DebtChart } from '../../components/DebtChart';
import { Card, Empty, ErrorBox, Loading, ProgressBar, Stat } from '../../components/ui';
import { usePlan } from '../simulator/usePlan';

/** "Libre de deudas en…", cifras restantes, avance y gráfico frente a la base. */
export function PlanCard() {
  const debts = useDebts();
  const { plan, base, input, startDebt, isLoading, error, refetch } = usePlan();

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const all = (debts.data ?? []).filter((d) => d.status !== 'archived');
  const initial = all.reduce((s, d) => s + d.initial_balance, 0);
  const current = all.reduce((s, d) => s + d.current_balance, 0);
  if (initial === 0) {
    return (
      <Card title="Deudas">
        <Empty>
          Sin deudas registradas. <Link to="/deudas" className="underline">Agregar</Link>
        </Empty>
      </Card>
    );
  }
  if (!plan || !base || !input) return null;

  const done = input.debts.length === 0;

  return (
    <>
      <Card className="border-emerald-500/30">
        {done ? (
          <p className="text-2xl font-bold text-emerald-300">¡Estás libre de deudas! 🎉</p>
        ) : (
          <>
            <p className="text-sm text-slate-400">Libre de deudas en</p>
            <p className="text-3xl font-bold">{plan.debtFreeMonth ? formatMonth(plan.debtFreeMonth) : 'más de 7 años'}</p>
            {plan.monthsToZero !== null && (
              <p className="text-slate-300">
                faltan {plan.monthsToZero} {plan.monthsToZero === 1 ? 'mes' : 'meses'}
              </p>
            )}
            <p className="mt-1 text-sm text-slate-400">
              Sin abonos extra: {base.debtFreeMonth ? formatMonth(base.debtFreeMonth) : 'más de 7 años'}
            </p>
          </>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Deuda actual" value={current} />
          <Stat label="Interés restante" value={plan.totalInterest} />
          <Stat label="Total restante" value={plan.totalPaid} />
        </div>
        <div className="mt-4">
          <ProgressBar value={(initial - current) / initial} label="Capital pagado sobre deuda inicial" />
          <p className="mt-1 text-xs text-slate-400">
            {Math.round(((initial - current) / initial) * 100)} % del capital pagado
          </p>
        </div>
      </Card>

      {!done && (
        <Card title="Deuda proyectada" action={<Link to="/simulador" className="text-xs text-slate-400 underline">Simular</Link>}>
          <DebtChart startMonth={input.startMonth} startDebt={startDebt ?? 0} plan={plan} base={base} />
        </Card>
      )}
    </>
  );
}

import { Link } from 'react-router-dom';
import { useSavingsGoals } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { goalProgress } from '../../lib/finance/savings';
import { Card, Empty, ProgressBar } from '../../components/ui';

/** Ahorro en Hoy: cada meta con su saldo y barra. */
export function SavingsCard() {
  const goals = useSavingsGoals();
  if (goals.isLoading || goals.error) return null;
  const list = goals.data ?? [];

  return (
    <Card title="Ahorro" action={<Link to="/ahorros" className="text-xs text-slate-400 underline">Ver</Link>}>
      {list.length === 0 ? (
        <Empty>
          Sin metas. <Link to="/ahorros" className="underline">Crear colchón</Link>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.map((g) => {
            const p = goalProgress({ id: g.id, name: g.name, target: g.target_amount, balance: g.balance, priority: g.priority });
            return (
              <li key={g.id}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">{g.name}</span>
                  <span className="shrink-0 tabular-nums">
                    <strong>{formatMoney(g.balance)}</strong>
                    <span className="text-slate-400"> / {formatMoney(g.target_amount)}</span>
                  </span>
                </div>
                <ProgressBar value={p.pct} tone={p.done ? 'emerald' : 'sky'} label={`${g.name}: avance hacia la meta`} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

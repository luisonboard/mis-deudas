import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDebts, useDeleteDebt, useDeletePayment, usePayments } from '../../lib/api';
import { formatDate, formatMoney, formatMonth, formatPct } from '../../lib/format';
import { amortizationSchedule } from '../../lib/finance/schedule';
import { DEBT_KIND_LABEL, PAYMENT_KIND_LABEL } from '../../lib/types';
import { Button, Card, Empty, ErrorBox, Loading, ProgressBar, Sheet, Stat, useOnline } from '../../components/ui';
import { PaymentForm } from '../daily/forms';
import { DebtForm } from './DebtForm';
import { estimatedEnd } from './DebtsPage';

export function DebtDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const debts = useDebts();
  const payments = usePayments();
  const delPayment = useDeletePayment();
  const delDebt = useDeleteDebt();
  const online = useOnline();
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (debts.isLoading) return <Loading />;
  if (debts.error) return <ErrorBox error={debts.error} onRetry={() => debts.refetch()} />;
  const debt = debts.data?.find((d) => d.id === id);
  if (!debt) return <Empty>No se encontró la deuda. <Link to="/deudas" className="underline">Volver</Link></Empty>;

  const mine = (payments.data ?? []).filter((p) => p.debt_id === debt.id);
  const payment = debt.kind === 'revolving' ? debt.min_payment ?? 0 : debt.monthly_payment;
  const schedule = amortizationSchedule(debt.current_balance, debt.kind === 'fixed_installments' ? 0 : debt.annual_rate, payment);
  const scheduleInterest = schedule.reduce((s, r) => s + r.interest, 0);
  const end = estimatedEnd(debt);
  const paidPct = debt.initial_balance > 0 ? 1 - debt.current_balance / debt.initial_balance : 1;

  const removePayment = (pid: string) => {
    if (confirm('¿Borrar este pago? El saldo de la deuda se restaurará.')) delPayment.mutate(pid);
  };
  const removeDebt = async () => {
    if (!confirm(`¿Borrar “${debt.name}” y todos sus pagos? No se puede deshacer.`)) return;
    await delDebt.mutateAsync(debt.id);
    navigate('/deudas');
  };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <Link to="/deudas" className="text-sm text-slate-400 underline">
          ← Deudas
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{debt.name}</h1>
        <p className="text-sm text-slate-400">
          {DEBT_KIND_LABEL[debt.kind]}
          {debt.lender && ` · ${debt.lender}`} · {formatPct(debt.annual_rate)} anual
        </p>
      </header>

      <Card>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Saldo actual" value={debt.current_balance} />
          <Stat label={debt.kind === 'revolving' ? 'Pago mínimo' : 'Cuota'} value={payment} />
          <Stat label="Saldo inicial" value={debt.initial_balance} />
          <Stat label="Fin estimado" value={end ? formatMonth(end) : debt.status === 'paid' ? 'Pagada' : '—'} sub="pagando solo la cuota" />
        </div>
        <div className="mt-4">
          <ProgressBar value={paidPct} label="Capital pagado" />
          <p className="mt-1 text-xs text-slate-400">{formatPct(paidPct, 0)} del capital pagado</p>
        </div>
        {debt.notes && <p className="mt-3 text-sm text-slate-300">{debt.notes}</p>}
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" onClick={() => setPaying(true)} disabled={!online || debt.status !== 'active'}>
            Registrar pago
          </Button>
          <Button variant="secondary" onClick={() => setEditing(true)} disabled={!online}>
            Editar
          </Button>
        </div>
      </Card>

      <Card title="Historial de pagos">
        {payments.isLoading && <Loading />}
        {payments.error && <ErrorBox error={payments.error} />}
        {mine.length === 0 && !payments.isLoading && <Empty>Sin pagos registrados.</Empty>}
        <ul className="divide-y divide-slate-800">
          {mine.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium tabular-nums">{formatMoney(p.amount)}</p>
                <p className="text-xs text-slate-400">
                  {formatDate(p.paid_on)} · {PAYMENT_KIND_LABEL[p.kind]} · capital {formatMoney(p.principal_part)} · interés {formatMoney(p.interest_part)}
                </p>
                {p.note && <p className="text-xs text-slate-500">{p.note}</p>}
              </div>
              <Button variant="ghost" aria-label="Borrar pago" onClick={() => removePayment(p.id)} disabled={!online || delPayment.isPending}>
                🗑
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Los pagos no se editan: bórralo y regístralo de nuevo.</p>
      </Card>

      <Card title="Cronograma restante (solo cuota)">
        {schedule.length === 0 ? (
          <Empty>{debt.current_balance <= 0.005 ? 'Deuda pagada.' : 'La cuota no cubre el interés.'}</Empty>
        ) : (
          <>
            <p className="mb-2 text-sm text-slate-400">
              {schedule.length} pagos · interés restante {formatMoney(scheduleInterest)}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm tabular-nums">
                <thead className="text-xs text-slate-400">
                  <tr>
                    <th className="py-1 text-left">#</th>
                    <th>Pago</th>
                    <th>Interés</th>
                    <th>Capital</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAll ? schedule : schedule.slice(0, 12)).map((r) => (
                    <tr key={r.index} className="border-t border-slate-800">
                      <td className="py-1 text-left">{r.index}</td>
                      <td>{formatMoney(r.payment)}</td>
                      <td>{formatMoney(r.interest)}</td>
                      <td>{formatMoney(r.principal)}</td>
                      <td>{formatMoney(r.balanceEnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schedule.length > 12 && (
              <Button variant="ghost" className="mt-2 w-full" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Ver menos' : `Ver los ${schedule.length} meses`}
              </Button>
            )}
          </>
        )}
      </Card>

      <Button variant="danger" onClick={removeDebt} disabled={!online || delDebt.isPending}>
        Borrar deuda
      </Button>

      <Sheet title={`Pago · ${debt.name}`} open={paying} onClose={() => setPaying(false)}>
        <PaymentForm debtId={debt.id} onDone={() => setPaying(false)} />
      </Sheet>
      <Sheet title="Editar deuda" open={editing} onClose={() => setEditing(false)}>
        <DebtForm debt={debt} onDone={() => setEditing(false)} />
      </Sheet>
    </div>
  );
}

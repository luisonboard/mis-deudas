import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { OfflineBanner, TabBar, Card } from './components/ui';
import { TodayPage } from './features/dashboard/TodayPage';
import { DebtsPage } from './features/debts/DebtsPage';
import { DebtDetailPage } from './features/debts/DebtDetailPage';
import { SettingsPage } from './features/settings/SettingsPage';

function Layout() {
  return (
    <>
      <OfflineBanner />
      <main className="mx-auto max-w-xl px-4 pb-28 pt-[calc(1rem+env(safe-area-inset-top))]">
        <Outlet />
      </main>
      <TabBar />
    </>
  );
}

function Upcoming({ title, phase, text }: { title: string; phase: number; text: string }) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card>
        <p className="text-slate-300">{text}</p>
        <p className="mt-2 text-sm text-slate-500">Llega en la Fase {phase}.</p>
      </Card>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TodayPage /> },
      { path: '/deudas', element: <DebtsPage /> },
      { path: '/deudas/:id', element: <DebtDetailPage /> },
      {
        path: '/simulador',
        element: <Upcoming title="Simulador" phase={2} text="Simula abonos extra y compara tu fecha libre de deudas con el plan base." />,
      },
      {
        path: '/ahorros',
        element: <Upcoming title="Ahorros" phase={3} text="Colchón de imprevistos y fondo de mudanza con sus metas. Regla: primero el colchón de $300, luego el extra a deuda." />,
      },
      { path: '/ajustes', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

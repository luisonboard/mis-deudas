import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { OfflineBanner, TabBar } from './components/ui';
import { TodayPage } from './features/dashboard/TodayPage';
import { DebtsPage } from './features/debts/DebtsPage';
import { DebtDetailPage } from './features/debts/DebtDetailPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { SimulatorPage } from './features/simulator/SimulatorPage';
import { SavingsPage } from './features/savings/SavingsPage';
import { HistoryPage } from './features/history/HistoryPage';

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

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TodayPage /> },
      { path: '/deudas', element: <DebtsPage /> },
      { path: '/deudas/:id', element: <DebtDetailPage /> },
      { path: '/simulador', element: <SimulatorPage /> },
      { path: '/ahorros', element: <SavingsPage /> },
      { path: '/ajustes', element: <SettingsPage /> },
      { path: '/historial', element: <HistoryPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

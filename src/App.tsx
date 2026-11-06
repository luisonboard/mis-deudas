import { RouterProvider } from 'react-router-dom';
import { useAuth } from './features/auth/AuthProvider';
import { LoginPage } from './features/auth/LoginPage';
import { Loading } from './components/ui';
import { router } from './routes';

export function App() {
  const { session, loading } = useAuth();
  if (loading) return <Loading label="Abriendo…" />;
  if (!session) return <LoginPage />;
  return <RouterProvider router={router} />;
}

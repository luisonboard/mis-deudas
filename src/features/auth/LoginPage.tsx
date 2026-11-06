import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { Button, Field, inputClass } from '../../components/ui';

const schema = z.object({
  email: z.email('Correo no válido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    setBusy(false);
    if (error) setError(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos' : error.message);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <div className="text-center">
        <img src="/icons/icon.svg" alt="" className="mx-auto mb-3 h-16 w-16" />
        <h1 className="text-2xl font-bold">Mis Deudas</h1>
        <p className="text-sm text-slate-400">Inicia sesión para continuar</p>
      </div>
      {!supabaseConfigured && (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          Falta configurar <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> en <code>.env.local</code>.
        </p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Correo">
          <input className={inputClass} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Contraseña">
          <input
            className={inputClass}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
      <p className="text-center text-xs text-slate-500">No hay registro público. El usuario se crea en Supabase.</p>
    </main>
  );
}

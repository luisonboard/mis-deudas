# Mis Deudas

PWA personal para seguir deudas, pagos, abonos extra y ahorros. Stack: Vite + React 18 + TypeScript, Tailwind, TanStack Query, Zod, Supabase (Auth + Postgres + RLS) y Cloudflare Pages.

La especificación completa está en [`docs/PWA_Mis_Deudas_spec.md`](docs/PWA_Mis_Deudas_spec.md).

## Estado por fases

| Fase | Estado |
|---|---|
| 1. Proyecto, Auth, migración, CRUD de deudas, pagos, check-in diario, gastos fijos, ingresos, pantalla Hoy básica | ✅ |
| 2. `simulatePlan`, `recommend`, Simulador, gráfico | pendiente |
| 3. Ahorros (metas y movimientos) | pendiente |
| 4. PWA instalable, caché sin conexión, despliegue | parcial: manifest, service worker, `_headers` y `_redirects` ya están |
| 5. Exportar CSV / `.ics`, cola de escrituras sin conexión | pendiente |

## Comandos

```bash
npm install
npm run dev        # http://localhost:5173
npm run test       # Vitest (cálculos financieros)
npm run build      # tsc + vite build + service worker
```

## Configurar Supabase (una sola vez)

1. **Crear el proyecto.** En [supabase.com](https://supabase.com) → *New project*. Región cercana (São Paulo `sa-east-1` o US East). Guarda la contraseña de la base de datos en tu gestor de contraseñas.
2. **Correr la migración.** *SQL Editor* → *New query* → pega todo `supabase/migrations/0001_init.sql` → *Run*. Debe terminar con “Success. No rows returned”.
3. **Desactivar el registro público.** *Authentication* → *Sign In / Providers*: deja **Email** activado y **desactiva “Allow new users to sign up”**. Puedes desactivar también “Confirm email”, porque el usuario se crea a mano.
4. **Crear tu usuario.** *Authentication* → *Users* → *Add user* → *Create new user*: tu correo, una contraseña larga y única, y marca **Auto Confirm User**.
5. **Cargar datos iniciales (opcional).** Abre `supabase/seed.sql`, cambia `TU_CORREO@ejemplo.com` por tu correo, **revisa cada cifra con tus estados de cuenta** y córrelo en el *SQL Editor*.
6. **Verificar trigger y RLS (opcional, recomendado).** Cambia el correo en `supabase/tests/verify.sql` (línea marcada con ←) y córrelo. Si ves **“Success. No rows returned”**, pasaron las 4 pruebas; si algo falla, verás un error que empieza con `FALLA` y dice cuál. No deja datos.
7. **Copiar las claves.**
   - **Clave:** *Project Settings* → *API Keys* → sección **Publishable key** → copia la clave `sb_publishable_…` (la `anon` *legacy* también funciona, pero Supabase la retira en 2027). **Nunca** uses una **Secret key** (`sb_secret_…`) ni la `service_role` en el front.
   - **URL:** *Project Settings* → *Data API* (o el botón **Connect** arriba): `https://<id-del-proyecto>.supabase.co`.
8. **Variables locales.** Copia `.env.example` a `.env.local` y pega los valores:

   ```bash
   cp .env.example .env.local
   ```

9. **URL del sitio.** Cuando despliegues: *Authentication* → *URL Configuration* → *Site URL* = tu dominio `https://mis-deudas.pages.dev` (o el tuyo).
10. **Opcional:** activa MFA (TOTP) en *Authentication* → *Multi-Factor*.

> La migración agrega una columna que la especificación pedía de forma implícita: `debts.one_off_first_month`, el “cargo único” del mes 1 (18,85 de exigibles en Produbanco). Se suma al total pagado, no al capital. También revoca todos los permisos de `anon` y concede CRUD a `authenticated`; RLS limita cada fila a su dueño.

## Desplegar en Cloudflare Pages

1. Cloudflare Dashboard → *Workers & Pages* → *Create* → *Pages* → *Connect to Git* → elige este repo.
2. Framework preset **Vite** · Build command `npm run build` · Output directory `dist`.
3. Variables de entorno (Production y Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
4. Despliega. Cada push a `main` publica solo.
5. En el celular: abre la URL en Chrome → menú → **Instalar app**.

## Decisiones de la Fase 1

- **Pagos.** El interés se sugiere con `saldo × tasa / 12` en pagos regulares (editable). En abonos extra parte de 0 y también se puede editar. Un pago tipo *cargo* no cambia el saldo. Los pagos no se editan: se borran y se vuelven a registrar (el trigger mantiene `current_balance`).
- **Gasto estimado.** Cuenta los ingresos, pagos y ahorros con fecha en el intervalo `(check-in anterior, check-in actual]`. Si un pago se hace el mismo día de un check-in, cuenta para el siguiente intervalo.
- **Próximo pago.** Usa `first_payment_date` mientras no haya llegado (con el cargo único) y luego `due_day`. Una cuota se da por cubierta si hay un pago *regular* en los 28 días previos al vencimiento.
- **Sin conexión.** Se ven los últimos datos (caché `NetworkFirst` del service worker) y los botones de guardar se deshabilitan con un aviso.

-- Verificación del trigger de saldo y de RLS (vectores de la sección 5.4).
-- Córrelo en el SQL Editor DESPUÉS de cargar seed.sql. Cambia el correo en la línea marcada.
--
-- Es UNA sola sentencia (un bloque DO), sin tablas temporales, para que funcione en el
-- SQL Editor de Supabase. Corre en una sola transacción: si algo falla, se revierte todo.
--
-- Resultado:
--   · "Success. No rows returned"  → pasaron las 4 pruebas.
--   · Un error que empieza con "FALLA" → dice qué prueba falló.
-- El pago de prueba se inserta y se borra, así que no deja datos.

do $$
declare
  v_email  text := 'TU_CORREO@ejemplo.com';   -- ← cambia esto
  v_uid    uuid;
  v_debt   uuid;
  v_pay    uuid;
  v_before numeric;
  v_after  numeric;
  v_n      bigint;
begin
  -- Como postgres: buscar al usuario
  select id into v_uid from auth.users where email = v_email;
  if v_uid is null then
    raise exception 'FALLA: no existe un usuario con el correo %', v_email;
  end if;

  -- ── Como el usuario A (dueño de los datos) ──
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select id, current_balance into v_debt, v_before from public.debts where name = 'Diners Titanium';
  if v_debt is null then
    raise exception 'FALLA: el usuario A no ve la deuda "Diners Titanium" (¿corriste seed.sql?)';
  end if;

  insert into public.payments (debt_id, paid_on, amount, kind, interest_part, principal_part)
  values (v_debt, current_date, 100, 'extra', 20, 80)
  returning id into v_pay;

  select current_balance into v_after from public.debts where id = v_debt;
  if round(v_before - v_after, 2) <> 80 then
    raise exception 'FALLA trigger: el saldo bajó % (esperado 80)', v_before - v_after;
  end if;

  delete from public.payments where id = v_pay;

  select current_balance into v_after from public.debts where id = v_debt;
  if v_after <> v_before then
    raise exception 'FALLA trigger: al borrar el pago el saldo quedó en % (esperado %)', v_after, v_before;
  end if;

  -- ── Como un usuario B cualquiera ──
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;

  select (select count(*) from public.debts) + (select count(*) from public.payments)
       + (select count(*) from public.settings) + (select count(*) from public.fixed_expenses)
       + (select count(*) from public.savings_goals) + (select count(*) from public.balance_checkins)
    into v_n;
  if v_n <> 0 then
    raise exception 'FALLA RLS: el usuario B ve % filas', v_n;
  end if;

  -- ── Sin sesión (anon) ──
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;

  begin
    select count(*) into v_n from public.debts;
    if v_n <> 0 then
      raise exception 'FALLA RLS: sin sesión se ven % deudas', v_n;
    end if;
  exception when insufficient_privilege then
    null; -- anon no tiene permiso sobre la tabla: correcto
  end;

  reset role;
end $$;

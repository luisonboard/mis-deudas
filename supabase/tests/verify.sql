-- Verificación del trigger de saldo y de RLS (vectores de la sección 5.4).
-- Córrelo en el SQL Editor DESPUÉS de cargar seed.sql. Cambia el correo.
-- Todo ocurre dentro de una transacción que se revierte al final: no deja datos.

begin;

create temp table _uid as select id from auth.users where email = 'TU_CORREO@ejemplo.com';
grant select on _uid to authenticated, anon;

-- ── Como el usuario A (dueño de los datos) ──
select set_config('request.jwt.claims', json_build_object('sub', (select id from _uid), 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table _before on commit drop as
  select current_balance from public.debts where name = 'Diners Titanium';

insert into public.payments (debt_id, paid_on, amount, kind, interest_part, principal_part)
select id, current_date, 100, 'extra', 20, 80 from public.debts where name = 'Diners Titanium';

do $$
declare b numeric := (select current_balance from _before);
        a numeric := (select current_balance from public.debts where name = 'Diners Titanium');
begin
  if round(b - a, 2) <> 80 then raise exception 'FALLA trigger: bajó % (esperado 80)', b - a; end if;
  raise notice 'OK trigger: el pago extra de 100 con 20 de interés bajó el saldo 80';
end $$;

delete from public.payments where debt_id = (select id from public.debts where name = 'Diners Titanium') and amount = 100 and kind = 'extra';

do $$
begin
  if (select current_balance from public.debts where name = 'Diners Titanium') <> (select current_balance from _before) then
    raise exception 'FALLA trigger: el saldo no volvió al valor anterior';
  end if;
  raise notice 'OK trigger: al borrar el pago el saldo vuelve al valor anterior';
end $$;

-- ── Como un usuario B cualquiera ──
reset role;
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare n int := (select count(*) from public.debts) + (select count(*) from public.settings)
               + (select count(*) from public.fixed_expenses) + (select count(*) from public.savings_goals);
begin
  if n <> 0 then raise exception 'FALLA RLS: el usuario B ve % filas', n; end if;
  raise notice 'OK RLS: el usuario B ve 0 filas';
end $$;

-- ── Sin sesión (anon) ──
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
begin
  begin
    perform 1 from public.debts limit 1;
    if found then raise exception 'FALLA RLS: anon ve deudas'; end if;
  exception when insufficient_privilege then null; -- sin permiso: correcto
  end;
  raise notice 'OK RLS: sin sesión no se ve ninguna fila';
end $$;

rollback;

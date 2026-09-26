-- A regression from 20260921110000 (README R89), caught by suite 11 on 26/09. Rewriting app.swms_problems for filed
-- SWMSs dropped the ::text on three plain messages, so `text[] || 'no steps'` read the message as an array literal
-- and the check raised "malformed array literal" instead of listing what was missing. An incomplete SWMS was still
-- refused — the error stopped the transition — but the supervisor was told nothing useful. 20260914130000 fixed this
-- once already; the same body, with the casts back.
create or replace function app.swms_problems(p public.swms)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_problems text[] := '{}';
  v_step jsonb;
  v_n integer := 0;
begin
  if p.file_path is not null then
    return '{}';
  end if;
  if jsonb_typeof(p.steps) <> 'array' or jsonb_array_length(p.steps) = 0 then
    v_problems := v_problems || 'no steps'::text;
  else
    for v_step in select * from jsonb_array_elements(p.steps) loop
      v_n := v_n + 1;
      if length(btrim(coalesce(v_step ->> 'step', ''))) = 0 then v_problems := v_problems || format('step %s has no description', v_n); end if;
      if length(btrim(coalesce(v_step ->> 'hazards', ''))) = 0 then v_problems := v_problems || format('step %s names no hazard', v_n); end if;
      if length(btrim(coalesce(v_step ->> 'controls', ''))) = 0 then v_problems := v_problems || format('step %s has no control', v_n); end if;
    end loop;
  end if;
  if p.kind = 'swms' and coalesce(array_length(p.hrcw, 1), 0) = 0 then
    v_problems := v_problems || 'a SWMS must name its high-risk construction work'::text;
  end if;
  if length(btrim(coalesce(p.prepared_by, ''))) = 0 then
    v_problems := v_problems || 'nobody is named as having prepared it'::text;
  end if;
  return v_problems;
end;
$$;

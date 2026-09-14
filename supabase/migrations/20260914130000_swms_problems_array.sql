-- app.swms_problems: appending a bare string literal to a text[] made
-- Postgres read the literal as an array ("a SWMS must name its high-risk
-- construction work" is not one). array_append says what is meant.
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
  if jsonb_typeof(p.steps) <> 'array' or jsonb_array_length(p.steps) = 0 then
    v_problems := array_append(v_problems, 'no steps');
  else
    for v_step in select * from jsonb_array_elements(p.steps) loop
      v_n := v_n + 1;
      if length(btrim(coalesce(v_step ->> 'step', ''))) = 0 then v_problems := array_append(v_problems, format('step %s has no description', v_n)); end if;
      if length(btrim(coalesce(v_step ->> 'hazards', ''))) = 0 then v_problems := array_append(v_problems, format('step %s names no hazard', v_n)); end if;
      if length(btrim(coalesce(v_step ->> 'controls', ''))) = 0 then v_problems := array_append(v_problems, format('step %s has no control', v_n)); end if;
    end loop;
  end if;
  if p.kind = 'swms' and coalesce(array_length(p.hrcw, 1), 0) = 0 then
    v_problems := array_append(v_problems, 'a SWMS must name its high-risk construction work');
  end if;
  if length(btrim(coalesce(p.prepared_by, ''))) = 0 then
    v_problems := array_append(v_problems, 'nobody is named as having prepared it');
  end if;
  return v_problems;
end;
$$;

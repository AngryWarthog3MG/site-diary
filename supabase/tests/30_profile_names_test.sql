-- A person's name, not their email address, goes on the sheets. A person sets their own
-- name; it cannot be blank or an email address; nobody sets someone else's through RLS.
begin;
create schema tests;
grant usage on schema tests to public;
create function tests.expect_error(p_sql text, p_fragment text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TESTFAIL: expected failure but statement succeeded: %', p_sql;
exception
  when others then
    if sqlerrm like 'TESTFAIL:%' then raise; end if;
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'TESTFAIL: wrong error for [%] — got "%", expected "%"', p_sql, sqlerrm, p_fragment;
    end if;
end;
$$;

insert into auth.users (id, email) values
  ('71111111-1111-1111-1111-111111111111', 'new.starter@example.com'),
  ('72222222-2222-2222-2222-222222222222', 'other@example.com');
do $$ begin
  assert (select full_name from public.profiles where id = '71111111-1111-1111-1111-111111111111') is null, 'a new account should start with no name';
end $$;

select set_config('request.jwt.claims', '{"sub":"71111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
set local role authenticated;
update public.profiles set full_name = 'Sam Nguyen' where id = '71111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select full_name from public.profiles where id = '71111111-1111-1111-1111-111111111111') = 'Sam Nguyen', 'a person could not set their own name';
  raise notice 'PASS  a person sets their own name';
end $$;
select tests.expect_error($q$ update public.profiles set full_name = 'new.starter@example.com' where id = '71111111-1111-1111-1111-111111111111' $q$, 'profiles_full_name_is_a_name');
select tests.expect_error($q$ update public.profiles set full_name = '   ' where id = '71111111-1111-1111-1111-111111111111' $q$, 'profiles_full_name_is_a_name');
do $$ begin raise notice 'PASS  an email address or a blank is refused as a name'; end $$;
update public.profiles set full_name = 'Renamed' where id = '72222222-2222-2222-2222-222222222222';
reset role;
do $$ begin
  assert (select full_name from public.profiles where id = '72222222-2222-2222-2222-222222222222') is null, 'someone set another person''s name';
  raise notice 'PASS  nobody sets another person''s name through RLS';
end $$;
select set_config('request.jwt.claims', '', true);
do $$ begin raise notice 'ALL PROFILE NAME TESTS PASSED'; end $$;
rollback;

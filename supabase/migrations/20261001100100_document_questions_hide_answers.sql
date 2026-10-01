-- Supabase's default privileges hand every new table in public to anon and authenticated wholesale, so the column
-- list granted in 20261001100000 sat beside a table-wide select and hid nothing. The right answer is read by the
-- grader and the answer-key function only (README R120).
revoke all on public.document_questions from anon, authenticated;
grant select (id, version_id, position, prompt, options), insert, update (position, prompt, options, correct_index), delete
  on public.document_questions to authenticated;
revoke all on public.document_assignments, public.document_quiz_attempts, public.document_events from anon;

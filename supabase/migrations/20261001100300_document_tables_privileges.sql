-- The new document tables keep only the privileges their policies mean (README R120). Supabase's default grant gave
-- authenticated everything; the stamps and events are written by definer functions, never by a signed-in account.
revoke insert, update, delete on public.document_events from authenticated;
revoke insert, delete on public.document_assignments from authenticated;
revoke insert, update, delete on public.document_quiz_attempts from authenticated;

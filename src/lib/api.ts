import type { SupabaseClient } from '@supabase/supabase-js';
import { sees, type Screen } from '@/lib/roles';
import type { MemberRole } from '@/types/database';
import 'server-only';

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export type ApiErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'day_signed'
  | 'day_open'
  | 'entry_signed'
  | 'transcription_failed'
  | 'server_error';

export function fail(code: ApiErrorCode, message: string, status: number, extra?: object) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export function ok<T extends object>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

/**
 * The API half of the role gate, for routes addressed by a record id rather
 * than a job: the row has proven membership under RLS; this asks whether the
 * caller's role ON THAT JOB may see the screen the route belongs to. A
 * mixed-role account — labourer here, supervisor elsewhere — is judged here,
 * not by its best role. Returns the 403 to hand straight back, or null.
 */
export async function forbidUnlessSees(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  screen: Screen,
): Promise<NextResponse | null> {
  // Fail closed: a lookup that errors, or finds no role on this job, refuses (Codex pass 42).
  const { data, error } = await supabase.from('project_members').select('role, screens').eq('project_id', projectId).eq('user_id', userId).maybeSingle();
  if (error) return fail('server_error', `Could not check your role on this job: ${error.message}`, 500);
  const member = data ? { role: data.role as MemberRole, screens: (data.screens as string[] | null) ?? null } : null;
  if (!member || !sees(member, screen)) return fail('forbidden', 'Your role on this job does not include that.', 403);
  return null;
}

/** Resolves the caller, or returns the 401 to hand straight back. */
export async function requireApiUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, response: fail('unauthenticated', 'Sign in again.', 401) };
  }
  return { supabase, user, response: null as null };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

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

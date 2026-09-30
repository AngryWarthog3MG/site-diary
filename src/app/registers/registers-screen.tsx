'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { navPending } from '@/components/nav-progress';
import { OTHER_REGISTERS, REGISTER_KINDS, type RegisterKind } from '@/lib/registers/kinds';

/**
 * The dropdown and the frame around whichever register is chosen (README
 * R118). The choice is in the address, so a register can be bookmarked, sent
 * to someone, and survives a refresh.
 */
export function RegistersScreen({ kind, projectId, summary, children }: { kind: RegisterKind; projectId: string; summary: string[]; children: ReactNode }) {
  const router = useRouter();
  const chosen = REGISTER_KINDS.find((k) => k.key === kind) ?? REGISTER_KINDS[0];
  return (
    <>
      <div className="regs__pick">
        <label className="fieldcell">
          <span className="label">Register</span>
          <select
            className="field"
            id="register-kind"
            value={kind}
            onChange={(e) => { navPending.start(); router.push(`/registers?project=${projectId}&r=${e.target.value}`); }}
          >
            {REGISTER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
        </label>
      </div>
      <p className="caption regs__what">{chosen.what}</p>
      <div className="regs__counts">
        {summary.map((line) => <p key={line} className="caption">{line}</p>)}
      </div>

      {children}

      <hr className="rule" />
      <p className="label">Registers kept on their own screens</p>
      <p className="caption">Their lines are signed, numbered or frozen records, so they are made and read where they live.</p>
      <ul className="regs__others">
        {OTHER_REGISTERS.map((o) => (
          <li key={o.href}><Link className="linklike" href={`${o.href}?project=${projectId}`}>{o.label}</Link> <span className="caption">— {o.what}</span></li>
        ))}
      </ul>
    </>
  );
}

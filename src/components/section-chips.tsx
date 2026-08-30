'use client';

import type { EntrySection } from '@/types/database';
import { SECTION_ORDER, SECTION_LABELS } from '@/lib/capture/sections';

/**
 * The six required sections as a row of chips — the pre-printed field list on
 * a docket, lighting up as each subject gets covered. An ambient reminder of
 * what is still uncovered, not a form to fill in.
 */
export function SectionChips({
  covered,
  compact = false,
}: {
  covered: Set<EntrySection>;
  compact?: boolean;
}) {
  return (
    <ul className={`chips${compact ? ' chips--compact' : ''}`}>
      {SECTION_ORDER.map((section) => {
        const isCovered = covered.has(section);
        return (
          <li
            key={section}
            className={`chip${isCovered ? ' chip--on' : ''}`}
            aria-label={`${SECTION_LABELS[section]}: ${isCovered ? 'covered' : 'not yet'}`}
          >
            {SECTION_LABELS[section]}
          </li>
        );
      })}
    </ul>
  );
}

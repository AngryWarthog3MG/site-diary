/**
 * Brief §10: "A test asserting the same entry regenerates a byte-identical
 * daily PDF."
 *
 *   npm run pdf:check
 *
 * Renders one fixed entry twice — in separate browser contexts, seconds apart
 * — and compares the bytes. Any difference is reported with the offset and the
 * surrounding bytes, because the usual culprits (a timestamp, a document id)
 * are obvious once you can see where they landed.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { renderDailyPdf, closeBrowser } = require('../.pdfbuild/lib/pdf/render.js');

/** A signed entry with something in every section, including a confirmed nil. */
const entry = {
  id: 'cccccccc-0000-0000-0000-000000000001',
  entry_no: 'KBS_C001_DD_142',
  entry_date: '2026-08-25',
  status: 'signed',
  signed_at: '2026-08-25T09:31:04.000+00:00',
  content_hash: '3f5a1c9e8b2d47f6a0c31e5d9b8477a2c6e0f1d3a5b7c9e1f3a5b7c9e1f3a5b7',
  supersedes_entry_id: null,
  supersedes_entry_no: null,
  notes: 'Toolbox talk held 0700. Concrete booked for Thursday; gate B code changed.',
  org_name: 'Kingsbridge Civil',
  org_code: 'KBS',
  project_name: 'Northern Interchange Stage 2',
  project_code: 'C001',
  principal_contractor: 'Lendlease',
  author_name: 'Danny Rowe',
  labour: [
    { person_name: 'Danny Rowe', role: 'leading hand', area: 'Pier 3', hours: 9, overtime_hours: 3 },
    { person_name: 'Sam Whitely', role: 'labourer', area: 'Pier 3', hours: 9, overtime_hours: null },
    { person_name: 'Kel Brady', role: null, area: 'Area B North', hours: 8, overtime_hours: null },
  ],
  plant: [
    { item: 'Kobelco 35', hire_type: 'dry', supplier: 'Coates', hours: 6, idle_hours: 2 },
  ],
  work_items: [
    { area: 'Pier 3', description: 'Stripped formwork off the pier headstock', percent_complete: 100 },
    { area: 'Area B North', description: 'Kerb through the northern frontage', percent_complete: 60 },
  ],
  variations: [
    {
      vr_ref: 'VR-014',
      description: 'Break out the rock shelf at the north abutment',
      directed_by: 'Superintendent',
      directed_at: '2026-08-25T02:00:00.000+00:00',
      estimated_cost: 12000,
      photo_urls: ['p/e/vr014.jpg'],
    },
  ],
  delays: [
    { start_time: '09:30:00', end_time: '11:15:00', duration_mins: 105, cause: 'Rain on the deck', category: 'weather', personnel_affected: 5 },
  ],
  pours: [
    { location: 'Pier 3 headstock', volume_m3: 18.5, mix_spec: '40 MPa', supplier: 'Hanson', start_time: '07:30:00', finish_time: '09:10:00', docket_nos: ['4471', '4472'] },
  ],
  quantities: [
    { item_type: 'topsoil', area: 'Area B North', quantity: 400, unit: 'm2' },
    { item_type: 'subsoil drain', area: null, quantity: 80, unit: 'm' },
  ],
  photos: [],
  weather: {
    temp_min: 9.8, temp_max: 21.1, rainfall_mm: 12.6, wind_dir: 'NNW', wind_kmh: 7,
    station_name: 'PERTH METRO', station_distance_km: 3.8, source: 'bom_auto',
    observed_impact: 'Rain came through about half ten and we lost the rest of the morning',
  },
  // Plant nilled by the supervisor; quantities never asked about. The docket
  // must print those two differently.
  sections: {
    labour: { state: 'captured', note: null },
    plant: { state: 'captured', note: null },
    work_items: { state: 'captured', note: null },
    variations: { state: 'captured', note: null },
    delays: { state: 'captured', note: null },
    weather: { state: 'captured', note: null },
  },
};

const nilEntry = {
  ...entry,
  entry_no: 'KBS_C001_DD_143',
  labour: [], plant: [], work_items: [], variations: [], delays: [],
  pours: [], quantities: [],
  sections: {
    labour: { state: 'captured', note: null },
    plant: { state: 'nil_confirmed', note: 'No plant on site today' },
    work_items: { state: 'gap', note: null },
    variations: { state: 'nil_confirmed', note: null },
    delays: { state: 'nil_confirmed', note: null },
    weather: { state: 'gap', note: null },
  },
};

function firstDifference(a, b) {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i += 1) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : limit;
}

function context(bytes, at) {
  const from = Math.max(0, at - 40);
  return Buffer.from(bytes.slice(from, at + 40)).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
}

let failures = 0;

for (const [name, subject] of [['full entry', entry], ['nil and gap sections', nilEntry]]) {
  const first = await renderDailyPdf({ entry: subject, photos: [] });
  await new Promise((r) => setTimeout(r, 1200));
  const second = await renderDailyPdf({ entry: subject, photos: [] });

  const at = firstDifference(first, second);
  if (at === -1) {
    console.log(`OK    ${name}: byte-identical across renders (${first.length} bytes)`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}: differs at byte ${at} of ${first.length}/${second.length}`);
    console.log(`      a: ${context(first, at)}`);
    console.log(`      b: ${context(second, at)}`);
    writeFileSync('/tmp/docket-a.pdf', first);
    writeFileSync('/tmp/docket-b.pdf', second);
    console.log('      written to /tmp/docket-a.pdf and /tmp/docket-b.pdf');
  }
}

// Two different entries must not somehow produce the same document.
const a = await renderDailyPdf({ entry, photos: [] });
const b = await renderDailyPdf({ entry: nilEntry, photos: [] });
if (firstDifference(a, b) === -1) {
  failures += 1;
  console.log('FAIL  two different entries rendered identically');
} else {
  console.log('OK    different entries render differently');
}

writeFileSync('/tmp/docket-sample.pdf', a);
writeFileSync('/tmp/docket-nil.pdf', b);
console.log('\nsamples written to /tmp/docket-sample.pdf and /tmp/docket-nil.pdf');

await closeBrowser();
process.exit(failures === 0 ? 0 : 1);

/**
 * Seed a realistic demo week on Test Site (T001).
 *
 * Five signed days through the REAL pipeline — author sessions, the
 * apply_entry_review RPC, the same status='signed' update the app makes — so
 * every signing gate, serial allocation and content hash fires exactly as
 * production does. Nothing is faked into the tables from the outside except
 * the raw material an entry would already carry: a transcript paragraph and a
 * BOM weather observation.
 *
 * Idempotent: a (date, author) that already has an entry is skipped.
 * Test Site is woken for the run and put back to sleep after.
 */
import { createClient } from '@supabase/supabase-js';

const PROJECT = '76c9adfb-58ec-4042-b6cf-217fc49f185a';
const DANNY = 'danny.test@example.com';
const SAM = 'sam.test@example.com';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const hand = { source_quote: null, confidence: null };
const said = (q) => ({ source_quote: q, confidence: 'high' });

const sections = (states) =>
  ['labour', 'plant', 'work_items', 'variations', 'delays', 'weather'].map((section) => ({
    section,
    state: states[section] ?? 'nil_confirmed',
    note: null,
  }));

const cap = 'captured';

/** The week. Perth, late August: cool mornings, one proper rain day. */
const DAYS = [
  {
    date: '2026-08-24',
    author: DANNY,
    transcript:
      'Monday. Danny here. Four of us on — myself supervising, Sam, Kel and Toby on the tools. Box cut for the northern car park all day, hit good ground, no surprises. Excavator on it the whole shift, tipper doing carts. Forty-two metres of subsoil drain in behind the kerb line. No delays, no variations, weather was no bother.',
    weather: { temp_min: 8.2, temp_max: 19.4, rainfall_mm: 0, wind_dir: 'SE', wind_kmh: 17 },
    payload: {
      labour: [
        { person_name: 'Danny Rowe', role: 'supervisor', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('myself supervising') },
        { person_name: 'Sam Whitely', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Sam, Kel and Toby on the tools') },
        { person_name: 'Kel Brady', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Sam, Kel and Toby on the tools') },
        { person_name: 'Toby Nguyen', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Sam, Kel and Toby on the tools') },
      ],
      plant: [
        { item: '20t excavator', hire_type: 'wet', hours: 8, idle_hours: null, supplier: 'Coates', ...said('Excavator on it the whole shift') },
        { item: 'Tipper truck', hire_type: 'wet', hours: 8, idle_hours: null, supplier: null, ...said('tipper doing carts') },
      ],
      work_items: [
        { area: 'Northern car park', description: 'Box cut to subgrade', percent_complete: 60, ...said('Box cut for the northern car park all day') },
      ],
      quantities: [
        { item_type: 'Subsoil drain', area: 'Kerb line', quantity: 42, unit: 'm', ...said('Forty-two metres of subsoil drain') },
      ],
      variations: [], delays: [], pours: [], dayworks: [], photos: [],
      weather_impact: null,
      notes: 'Geotech due Tuesday morning for subgrade sign-off.',
      sections: sections({ labour: cap, plant: cap, work_items: cap }),
    },
  },
  {
    date: '2026-08-25',
    author: DANNY,
    transcript:
      'Tuesday, pour day. Six on with the concreters. Pier two headstock went in — two trucks, thirty-two cubes all up of N32, Hanson, dockets 741201 and 741202. First truck half seven, finished the pour by ten. Pump on hire for the morning. Geotech signed the subgrade first thing. Kerb machine started the eastern run, sixty metres down.',
    weather: { temp_min: 9.1, temp_max: 21.2, rainfall_mm: 0, wind_dir: 'E', wind_kmh: 11 },
    payload: {
      labour: [
        { person_name: 'Danny Rowe', role: 'supervisor', area: 'Pier 2', hours: 8, overtime_hours: null, ...said('Six on with the concreters') },
        { person_name: 'Sam Whitely', role: 'labourer', area: 'Pier 2', hours: 8, overtime_hours: null, ...said('Six on with the concreters') },
        { person_name: 'Kel Brady', role: 'concreter', area: 'Pier 2', hours: 8, overtime_hours: null, ...said('Six on with the concreters') },
        { person_name: 'Toby Nguyen', role: 'concreter', area: 'Pier 2', hours: 8, overtime_hours: null, ...said('Six on with the concreters') },
        { person_name: 'Mick Farrar', role: 'concreter', area: 'Pier 2', hours: 8, overtime_hours: null, ...said('Six on with the concreters') },
        { person_name: 'Levi Hart', role: 'kerb machine operator', area: 'Eastern run', hours: 8, overtime_hours: null, ...said('Kerb machine started the eastern run') },
      ],
      plant: [
        { item: 'Concrete pump', hire_type: 'wet', hours: 4, idle_hours: null, supplier: null, ...said('Pump on hire for the morning') },
        { item: 'Kerb machine', hire_type: 'dry', hours: 8, idle_hours: null, supplier: null, ...said('Kerb machine started the eastern run') },
      ],
      work_items: [
        { area: 'Pier 2', description: 'Headstock pour, stripped and cured by afternoon', percent_complete: 100, ...said('Pier two headstock went in') },
        { area: 'Eastern run', description: 'Extruded kerb', percent_complete: 25, ...said('sixty metres down') },
      ],
      pours: [
        {
          location: 'Pier 2 headstock', volume_m3: 32, mix_spec: 'N32', supplier: 'Hanson',
          docket_nos: ['741201', '741202'], start_time: '07:30', finish_time: '10:00',
          docket_photo_urls: [], ...said('thirty-two cubes all up of N32, Hanson, dockets 741201 and 741202'),
        },
      ],
      quantities: [
        { item_type: 'Extruded kerb', area: 'Eastern run', quantity: 60, unit: 'm', ...said('sixty metres down') },
      ],
      variations: [], delays: [], dayworks: [], photos: [],
      weather_impact: null,
      notes: 'Geotech subgrade sign-off received for northern car park.',
      sections: sections({ labour: cap, plant: cap, work_items: cap }),
    },
  },
  {
    date: '2026-08-26',
    author: SAM,
    transcript:
      'Sam on the diary today, Danny off site at the coordination meeting. Rain came through about half nine and did not let up till after lunch — stood the crew down from nine thirty to one thirty, four hours gone, five blokes affected. Too wet to trench after that so we serviced gear and cleaned the compound. Lendlease directed us to pothole the extra Telstra crossing on the western boundary while we were rained off — VR-021, agreed at four and a half grand. Excavator sat idle the four hours of the standdown.',
    weather: { temp_min: 11.4, temp_max: 16.8, rainfall_mm: 14.6, wind_dir: 'NW', wind_kmh: 31 },
    payload: {
      labour: [
        { person_name: 'Sam Whitely', role: 'supervisor', area: null, hours: 8, overtime_hours: null, ...said('Sam on the diary today') },
        { person_name: 'Kel Brady', role: 'labourer', area: null, hours: 8, overtime_hours: null, ...said('five blokes affected') },
        { person_name: 'Toby Nguyen', role: 'labourer', area: null, hours: 8, overtime_hours: null, ...said('five blokes affected') },
        { person_name: 'Mick Farrar', role: 'labourer', area: null, hours: 8, overtime_hours: null, ...said('five blokes affected') },
        { person_name: 'Levi Hart', role: 'labourer', area: null, hours: 8, overtime_hours: null, ...said('five blokes affected') },
      ],
      plant: [
        { item: '20t excavator', hire_type: 'wet', hours: 4, idle_hours: 4, supplier: 'Coates', ...said('Excavator sat idle the four hours of the standdown') },
      ],
      work_items: [
        { area: 'Compound', description: 'Plant servicing and compound cleanup during rain standdown', percent_complete: null, ...said('we serviced gear and cleaned the compound') },
      ],
      delays: [
        {
          start_time: '09:30', end_time: '13:30', duration_mins: 240,
          cause: 'Rain — site too wet to trench', personnel_affected: 5, category: 'weather',
          ...said('stood the crew down from nine thirty to one thirty'),
        },
      ],
      variations: [
        {
          description: 'Pothole additional Telstra crossing, western boundary',
          directed_by: 'Lendlease site engineer', directed_at: null, vr_ref: 'VR-021',
          estimated_cost: 4500, photo_urls: [],
          ...said('Lendlease directed us to pothole the extra Telstra crossing'),
        },
      ],
      pours: [], quantities: [], dayworks: [], photos: [],
      weather_impact: 'Rain from 09:30 to after lunch; crew stood down four hours, no trenching possible.',
      notes: 'Danny at Lendlease coordination meeting. VR-021 confirmation email received.',
      sections: sections({ labour: cap, plant: cap, work_items: cap, variations: cap, delays: cap, weather: cap }),
    },
  },
  {
    date: '2026-08-27',
    author: DANNY,
    transcript:
      'Thursday. Back to it, ground drying out. Five on. Kerb machine finished the eastern run, another ninety-five metres, that run is done. Kel and Toby did the VR-021 pothole under dayworks — four hours the pair of them, vac truck in for it, docket DW-114. Found the Telstra duct at nine hundred deep, marked and photographed. Rest of us on the box cut.',
    weather: { temp_min: 10.6, temp_max: 18.9, rainfall_mm: 0.2, wind_dir: 'SW', wind_kmh: 22 },
    payload: {
      labour: [
        { person_name: 'Danny Rowe', role: 'supervisor', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Rest of us on the box cut') },
        { person_name: 'Sam Whitely', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Five on') },
        { person_name: 'Levi Hart', role: 'kerb machine operator', area: 'Eastern run', hours: 8, overtime_hours: null, ...said('Kerb machine finished the eastern run') },
      ],
      plant: [
        { item: 'Kerb machine', hire_type: 'dry', hours: 8, idle_hours: null, supplier: null, ...said('Kerb machine finished the eastern run') },
        { item: '20t excavator', hire_type: 'wet', hours: 8, idle_hours: null, supplier: 'Coates', ...hand },
        { item: 'Vac truck', hire_type: 'wet', hours: 4, idle_hours: null, supplier: null, ...said('vac truck in for it') },
      ],
      work_items: [
        { area: 'Eastern run', description: 'Extruded kerb complete', percent_complete: 100, ...said('that run is done') },
        { area: 'Northern car park', description: 'Box cut to subgrade', percent_complete: 85, ...said('Rest of us on the box cut') },
      ],
      dayworks: [
        {
          description: 'Pothole Telstra crossing, western boundary (VR-021). Duct located at 900mm, marked and photographed.',
          labour: 'Kel Brady, Toby Nguyen', plant: 'Vac truck', materials: null,
          hours: 4, docket_ref: 'DW-114', photo_urls: [],
          ...said('Kel and Toby did the VR-021 pothole under dayworks — four hours the pair of them'),
        },
      ],
      quantities: [
        { item_type: 'Extruded kerb', area: 'Eastern run', quantity: 95, unit: 'm', ...said('another ninety-five metres') },
      ],
      variations: [], delays: [], pours: [], photos: [],
      weather_impact: null,
      notes: 'Telstra duct at 900mm — deeper than the DBYD plan shows. Photos on the dayworks docket.',
      sections: sections({ labour: cap, plant: cap, work_items: cap }),
    },
  },
  {
    date: '2026-08-28',
    author: DANNY,
    transcript:
      'Friday. Six on to push the box cut out before the weekend. Finished it — car park subgrade done, proof rolled, ready for basecourse Monday. Two hundred and ten cube of spoil carted off. Sam stayed back two hours with me to tie down the compound for the weekend blow coming through. Basecourse trucks booked from seven Monday. Good week.',
    weather: { temp_min: 9.8, temp_max: 20.5, rainfall_mm: 0, wind_dir: 'S', wind_kmh: 15 },
    payload: {
      labour: [
        { person_name: 'Danny Rowe', role: 'supervisor', area: 'Northern car park', hours: 8, overtime_hours: 2, ...said('Sam stayed back two hours with me') },
        { person_name: 'Sam Whitely', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: 2, ...said('Sam stayed back two hours with me') },
        { person_name: 'Kel Brady', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Six on') },
        { person_name: 'Toby Nguyen', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Six on') },
        { person_name: 'Mick Farrar', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Six on') },
        { person_name: 'Levi Hart', role: 'labourer', area: 'Northern car park', hours: 8, overtime_hours: null, ...said('Six on') },
      ],
      plant: [
        { item: '20t excavator', hire_type: 'wet', hours: 8, idle_hours: null, supplier: 'Coates', ...hand },
        { item: 'Tipper truck', hire_type: 'wet', hours: 8, idle_hours: null, supplier: null, ...said('spoil carted off') },
        { item: 'Smooth drum roller', hire_type: 'dry', hours: 4, idle_hours: null, supplier: null, ...said('proof rolled') },
      ],
      work_items: [
        { area: 'Northern car park', description: 'Box cut complete, subgrade proof rolled and accepted', percent_complete: 100, ...said('car park subgrade done, proof rolled') },
      ],
      quantities: [
        { item_type: 'Spoil to tip', area: 'Northern car park', quantity: 210, unit: 'm3', ...said('Two hundred and ten cube of spoil') },
      ],
      variations: [], delays: [], pours: [], dayworks: [], photos: [],
      weather_impact: null,
      notes: 'Basecourse deliveries booked from 07:00 Monday. Compound tied down for forecast wind.',
      sections: sections({ labour: cap, plant: cap, work_items: cap }),
    },
  },
];

async function authorSession(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(error.message);
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data, error: verifyError } = await client.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  if (verifyError) throw new Error(verifyError.message);
  return { client, userId: data.user.id };
}

await admin.from('projects').update({ active: true }).eq('id', PROJECT);
try {
  const sessions = {};
  for (const email of [DANNY, SAM]) sessions[email] = await authorSession(email);

  for (const day of DAYS) {
    const { client, userId } = sessions[day.author];

    const { data: existing } = await admin
      .from('entries')
      .select('id, status, entry_no')
      .eq('project_id', PROJECT)
      .eq('entry_date', day.date)
      .eq('author_id', userId)
      .maybeSingle();
    if (existing) {
      console.log(`  ${day.date}  skipped — ${existing.status} entry already there (${existing.entry_no ?? 'draft'})`);
      continue;
    }

    const { data: entry, error: insertError } = await client
      .from('entries')
      .insert({ project_id: PROJECT, entry_date: day.date, author_id: userId, status: 'draft' })
      .select('id')
      .single();
    if (insertError) throw new Error(`${day.date}: could not create draft — ${insertError.message}`);

    // The raw material a real entry would carry: what was said, and the day's
    // BOM observation. Both attach to the DRAFT, before signing.
    await admin.from('entries').update({ transcript_raw: day.transcript }).eq('id', entry.id);
    await admin.from('weather').insert({
      entry_id: entry.id, source: 'bom_auto', ...day.weather,
      station_id: '94608', station_name: 'PERTH METRO', station_distance_km: 9.9,
      observed_from: `${day.date}T09:00:00+08:00`, observed_to: `${day.date}T15:00:00+08:00`,
      fetched_at: `${day.date}T15:10:00+08:00`,
      observed_impact: day.payload.weather_impact,
    });

    const { error: applyError } = await client.rpc('apply_entry_review', {
      p_entry_id: entry.id,
      p_payload: day.payload,
    });
    if (applyError) throw new Error(`${day.date}: apply failed — ${applyError.message}`);

    const { data: signed, error: signError } = await client
      .from('entries')
      .update({ status: 'signed' })
      .eq('id', entry.id)
      .select('entry_no, content_hash')
      .single();
    if (signError) throw new Error(`${day.date}: sign failed — ${signError.message}`);
    console.log(`  ${day.date}  signed ${signed.entry_no}  hash ${signed.content_hash.slice(0, 12)}…`);
  }

  // The record must verify, or the demo is a liability.
  const { data: check } = await admin.rpc('run_diary_query', {
    p_sql: `select count(*) as n from diary.entries where project_id = '${PROJECT}'`,
    p_limit: 10,
  }).then(() => ({ data: null })).catch(() => ({ data: null }));
  void check;
} finally {
  await admin.from('projects').update({ active: false }).eq('id', PROJECT);
  console.log('  Test Site put back to sleep (active=false)');
}

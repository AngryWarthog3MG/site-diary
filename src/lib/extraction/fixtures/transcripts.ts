import type { ExtractionProposal } from '../schema.ts';
import { C, D, L, P, Q, S, V, W, proposal } from './builders.ts';

/**
 * The fixture set (brief §10).
 *
 * Twenty supervisor transcripts with hand-written expected output. Extraction
 * accuracy is measured against these on every prompt change — `npm run
 * extraction:eval`.
 *
 * They are deliberately awkward. A clean dictated paragraph is not what a
 * supervisor produces at knock-off with a compressor running: expect
 * self-corrections, casual times, hedged figures, Australian idiom, sentences
 * that run into each other, and words the transcriber has plainly mangled.
 *
 * Several exist only to catch invention. Fixture 16 gives hours for two of
 * four named workers; the other two must come back null. Fixture 20 mentions a
 * concrete delivery with no docket number; the docket list must stay empty.
 * A model that fills those in scores worse than one that leaves them blank,
 * which is the whole point.
 */

export interface Fixture {
  id: string;
  /** What this one is testing. */
  tests: string;
  entryDate: string;
  vocabulary?: string[];
  transcript: string;
  expected: ExtractionProposal;
}

const CREW = ['Danny Rowe', 'Sam Whitely', 'Kel Brady', 'Mick Farrar', 'Toby Nguyen'];
const VOCAB = [...CREW, 'Kobelco 35', 'Area B North', 'Pier 3', 'Chainage 4200', 'Hanson', 'Coates'];

export const FIXTURES: Fixture[] = [
  {
    id: '01-ordinary-day',
    tests: 'A clean, ordinary day. The baseline — nothing tricky.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Righto, Tuesday. Had Danny and Sam on the deck at Pier 3 all day, nine hours each. Kel was over in Area B North on the kerb, eight hours. We got the formwork stripped off the pier headstock and started setting up for the pour Thursday. Kobelco was on site all day, about six hours of actual work out of it. No delays, weather was fine, no variations.`,
    expected: proposal({
      labour: [
        L('Danny Rowe', { area: 'Pier 3', hours: 9 }),
        L('Sam Whitely', { area: 'Pier 3', hours: 9 }),
        L('Kel Brady', { area: 'Area B North', role: null, hours: 8 }),
      ],
      plant: [P('Kobelco 35', { hours: 6, confidence: 'low' })],
      work_items: [
        W('Stripped formwork off the pier headstock', { area: 'Pier 3' }),
        W('Started setting up for Thursday pour', { area: 'Pier 3' }),
      ],
      sections: { variations: S.nil, delays: S.nil, weather: S.nil },
    }),
  },

  {
    id: '02-self-correction-count',
    tests: 'Self-correction on a headcount — the later value wins.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Had four blokes on today, no, five — Danny, Sam, Kel, Mick and Toby. All of them on the subgrade in Area B. Eight hours each. Nothing else to report, no plant, no variations, no delays.`,
    expected: proposal({
      labour: [
        L('Danny Rowe', { area: 'Area B North', hours: 8 }),
        L('Sam Whitely', { area: 'Area B North', hours: 8 }),
        L('Kel Brady', { area: 'Area B North', hours: 8 }),
        L('Mick Farrar', { area: 'Area B North', hours: 8 }),
        L('Toby Nguyen', { area: 'Area B North', hours: 8 }),
      ],
      work_items: [W('Subgrade works', { area: 'Area B North' })],
      sections: { plant: S.nil, variations: S.nil, delays: S.nil, weather: S.gap },
    }),
  },

  {
    id: '03-casual-times',
    tests: 'Casual times resolve to a 24-hour clock; "smoko" is not a time.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Started at half seven. Concrete truck turned up at quarter past eleven so we were standing around from half nine till then waiting on it — that's Danny, Sam and Kel doing nothing for the best part of two hours. Poured after smoko. Knocked off at four.`,
    expected: proposal({
      delays: [
        D({
          start_time: '09:30',
          end_time: '11:15',
          cause: 'Waiting on concrete truck',
          personnel_affected: 3,
          category: 'other',
        }),
      ],
      work_items: [W('Poured after smoko')],
      pours: [C({})],
      sections: { labour: S.gap, plant: S.gap, variations: S.gap, weather: S.gap },
    }),
  },

  {
    id: '04-explicit-nils',
    tests: 'Explicit nils are answers, not gaps.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Quiet one. Danny on site by himself, eight hours, tidying up around the compound. No plant on site today. No variations. No delays. Weather didn't bother us.`,
    expected: proposal({
      labour: [L('Danny Rowe', { hours: 8 })],
      work_items: [W('Tidying up around the compound')],
      weather_impact: "Weather didn't bother us",
      sections: { plant: S.nil, variations: S.nil, delays: S.nil, weather: S.captured },
    }),
  },

  {
    id: '05-pour-with-docket',
    tests: '"Cubes" normalises to m3; docket numbers are recorded as spoken.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Big day. Poured the Pier 3 headstock this morning, eighteen cubes of forty MPa off Hanson, docket numbers 4471 and 4472. Started the pour at half seven, finished up about ten past nine. Danny, Sam, Kel and Mick on it, nine hours each.`,
    expected: proposal({
      labour: [
        L('Danny Rowe', { hours: 9 }),
        L('Sam Whitely', { hours: 9 }),
        L('Kel Brady', { hours: 9 }),
        L('Mick Farrar', { hours: 9 }),
      ],
      work_items: [W('Poured the Pier 3 headstock', { area: 'Pier 3' })],
      pours: [
        C({
          location: 'Pier 3 headstock',
          volume_m3: 18,
          mix_spec: '40 MPa',
          supplier: 'Hanson',
          docket_nos: ['4471', '4472'],
          start_time: '07:30',
          finish_time: '09:10',
          confidence: 'low',
        }),
      ],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '06-variation-with-ref',
    tests: 'A variation with a reference and a directing person.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Superintendent came through about ten this morning and directed us to break out the rock shelf at the north abutment — that's a variation, VR dash zero one four. Reckons it'll be twelve grand or thereabouts. Danny and Mick on it the rest of the day, six hours each.`,
    expected: proposal({
      labour: [L('Danny Rowe', { hours: 6 }), L('Mick Farrar', { hours: 6 })],
      variations: [
        V('Break out the rock shelf at the north abutment', {
          directed_by: 'Superintendent',
          directed_at: '2026-08-25T10:00',
          vr_ref: 'VR-014',
          estimated_cost: 12000,
          confidence: 'low',
        }),
      ],
      work_items: [W('Breaking out rock shelf at the north abutment')],
      sections: { plant: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '07-variation-no-ref',
    tests: 'A variation with no reference number — vr_ref must stay null.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Client asked us to shift the site fence twenty metres back along the frontage. No paperwork on it yet, he just said do it. Took Kel and Toby about four hours each.`,
    expected: proposal({
      labour: [L('Kel Brady', { hours: 4, confidence: 'low' }), L('Toby Nguyen', { hours: 4, confidence: 'low' })],
      variations: [V('Shift the site fence twenty metres back along the frontage', { directed_by: 'Client' })],
      work_items: [W('Shifted site fence along the frontage')],
      quantities: [Q('site fence', { quantity: 20, unit: 'm' })],
      sections: { plant: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '08-weather-delay',
    tests: 'Weather impact is recorded; temperatures and rainfall are not.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Rain came through about half ten and we lost the rest of the morning — couldn't get the screed off. Stood the boys down from ten thirty till half twelve, that's five of them. Picked up after lunch. Got to about twenty two degrees in the arvo.`,
    expected: proposal({
      delays: [
        D({
          start_time: '10:30',
          end_time: '12:30',
          cause: 'Rain',
          personnel_affected: 5,
          category: 'weather',
        }),
      ],
      weather_impact: 'Rain came through about half ten and we lost the rest of the morning',
      sections: { labour: S.gap, plant: S.gap, work_items: S.gap, variations: S.gap },
    }),
  },

  {
    id: '09-garbled-audio',
    tests: 'Mangled words become low confidence, not invented terms.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `[wind noise] ...had the co bell co out at the pier, ran it about seven hours. Danny and someone else, didn't catch — [noise] — on the [inaudible] all day.`,
    expected: proposal({
      labour: [L('Danny Rowe', { confidence: 'low' })],
      plant: [P('Kobelco 35', { hours: 7, confidence: 'low' })],
      sections: { work_items: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '10-hedged-numbers',
    tests: 'Hedged figures are extracted but flagged low confidence.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Reckon we did about sixty metres of pipe today, give or take. Roughly four blokes on it — Danny, Sam, Kel, Mick — call it eight hours each. Bobcat was there, I think six hours.`,
    expected: proposal({
      labour: [
        L('Danny Rowe', { hours: 8, confidence: 'low' }),
        L('Sam Whitely', { hours: 8, confidence: 'low' }),
        L('Kel Brady', { hours: 8, confidence: 'low' }),
        L('Mick Farrar', { hours: 8, confidence: 'low' }),
      ],
      plant: [P('Bobcat', { hours: 6, confidence: 'low' })],
      work_items: [W('Pipe laying')],
      quantities: [Q('pipe', { quantity: 60, unit: 'm', confidence: 'low' })],
      sections: { variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '11-mixed-quantities',
    tests: 'Several quantity types with different units in one breath.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Landscaping crew got through it today. Spread four hundred square metres of topsoil in Area B North, put in a hundred and twenty plants, and laid another eighty lineal of subsoil drain. Toby and Kel, eight hours each.`,
    expected: proposal({
      labour: [
        L('Toby Nguyen', { hours: 8 }),
        L('Kel Brady', { hours: 8 }),
      ],
      work_items: [
        W('Spread topsoil, planted, laid subsoil drain', { area: 'Area B North' }),
      ],
      quantities: [
        Q('topsoil', { area: 'Area B North', quantity: 400, unit: 'm2' }),
        Q('plants', { quantity: 120, unit: 'no' }),
        Q('subsoil drain', { quantity: 80, unit: 'm' }),
      ],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '12-plant-idle-breakdown',
    tests: 'Idle hours and a breakdown, on wet hire.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Excavator off Coates threw a hose about nine and sat there till the fitter turned up at one. So call it eight hours on hire, four of them idle. It's wet hire so we're wearing it either way. Danny was operating, eight hours.`,
    expected: proposal({
      labour: [L('Danny Rowe', { role: 'operator', hours: 8 })],
      plant: [
        P('Excavator', { hire_type: 'wet', hours: 8, idle_hours: 4, supplier: 'Coates', confidence: 'low' }),
      ],
      delays: [
        D({ start_time: '09:00', end_time: '13:00', cause: 'Excavator hose failure', category: 'other', confidence: 'low' }),
      ],
      sections: { work_items: S.gap, variations: S.gap, weather: S.gap },
    }),
  },

  {
    id: '13-interruption',
    tests: 'Someone else talks over the middle of it; the record is unaffected.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `So today we — hang on. Yeah mate, chuck it in the skip. Sorry. Today we finished the kerb through Area B North, that's done now, and Sam and Toby were on it nine hours each. Right, gotta go.`,
    expected: proposal({
      labour: [L('Sam Whitely', { hours: 9 }), L('Toby Nguyen', { hours: 9 })],
      work_items: [W('Finished the kerb through Area B North', { area: 'Area B North' })],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '14-plant-never-mentioned',
    tests: 'A section never addressed is a gap, not a nil.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Danny and Sam formed up the headwall at Chainage 4200 today. Eight hours each. That's about it really.`,
    expected: proposal({
      labour: [L('Danny Rowe', { hours: 8 }), L('Sam Whitely', { hours: 8 })],
      work_items: [W('Formed up the headwall', { area: 'Chainage 4200' })],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '15-unit-mil',
    tests: '"Mil" normalises to mm and the number is not converted.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Laid a hundred and fifty mil sleeve under the driveway, twelve metres of it. Slump was eighty mil on the batch that came in. Mick on it, seven hours.`,
    expected: proposal({
      labour: [L('Mick Farrar', { hours: 7 })],
      work_items: [W('Laid sleeve under the driveway')],
      quantities: [
        Q('sleeve', { quantity: 12, unit: 'm' }),
        Q('sleeve diameter', { quantity: 150, unit: 'mm' }),
      ],
      pours: [C({ mix_spec: '80 mm slump', confidence: 'low' })],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '16-partial-hours',
    tests: 'Hours are given for two of four workers. The others stay null.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `On site today: Danny, Sam, Kel and Mick. Danny and Sam did nine hours on the pier. Kel and Mick were floating around helping out, didn't track their time.`,
    expected: proposal({
      labour: [
        L('Danny Rowe', { hours: 9, area: 'Pier 3' }),
        L('Sam Whitely', { hours: 9, area: 'Pier 3' }),
        L('Kel Brady'),
        L('Mick Farrar'),
      ],
      sections: { plant: S.gap, work_items: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '17-overtime',
    tests: 'Overtime is separated from ordinary hours.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Long one. Danny and Kel did their eight then stayed back another three to get the pour finished, so eight plus three overtime each. Sam went home on the eight.`,
    expected: proposal({
      labour: [
        L('Danny Rowe', { hours: 8, overtime_hours: 3 }),
        L('Kel Brady', { hours: 8, overtime_hours: 3 }),
        L('Sam Whitely', { hours: 8 }),
      ],
      work_items: [W('Finished the pour')],
      pours: [C({})],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '18-multiple-delays',
    tests: 'Two distinct delays with different causes and categories.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Two hold ups today. Couldn't get into Area B till nine because the traffic control mob were late — that's an hour lost from eight. Then the drawings for the headwall were wrong so we downed tools on that from one till half two while the engineer sorted it. Four blokes affected both times.`,
    expected: proposal({
      delays: [
        D({
          start_time: '08:00',
          end_time: '09:00',
          duration_mins: 60,
          cause: 'Traffic control late, no access to Area B',
          personnel_affected: 4,
          category: 'access',
        }),
        D({
          start_time: '13:00',
          end_time: '14:30',
          cause: 'Headwall drawings wrong',
          personnel_affected: 4,
          category: 'design',
        }),
      ],
      sections: { labour: S.gap, plant: S.gap, work_items: S.gap, variations: S.gap, weather: S.gap },
    }),
  },

  {
    id: '19-pour-no-volume',
    tests: 'A pour with no volume stated. volume_m3 must stay null.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Poured the blinding under the Pier 3 footing this morning off Hanson. Didn't get the docket off the driver, I'll chase it tomorrow. Sam and Kel on it, eight hours each.`,
    expected: proposal({
      labour: [L('Sam Whitely', { hours: 8 }), L('Kel Brady', { hours: 8 })],
      work_items: [W('Poured blinding under the Pier 3 footing', { area: 'Pier 3' })],
      pours: [C({ location: 'Pier 3 footing', supplier: 'Hanson' })],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '20-almost-nothing',
    tests: 'A near-empty recording. Nothing should be conjured out of it.',
    entryDate: '2026-08-25',
    vocabulary: VOCAB,
    transcript: `Yeah nothing much today mate. Bit of a write off. Talk tomorrow.`,
    expected: proposal({
      sections: {
        labour: S.gap,
        plant: S.gap,
        work_items: S.gap,
        variations: S.gap,
        delays: S.gap,
        weather: S.gap,
      },
    }),
  },

  {
    id: '21-morning-brief',
    tests: 'A morning brief. Everything is future tense, so nothing is the record.',
    entryDate: '2026-08-26',
    vocabulary: VOCAB,
    // Verbatim from the first real recording made on site. The extraction read
    // it as work completed and a 20 m3 pour that had happened — which is how
    // this rule came to exist.
    transcript: `There is rain forecasted today between 9 and 10. We will be excavating pad footings and doing 20 cube of concrete.`,
    expected: proposal({
      sections: {
        labour: S.gap,
        plant: S.gap,
        work_items: S.gap,
        variations: S.gap,
        delays: S.gap,
        weather: S.gap,
      },
    }),
  },

  {
    id: '22-mixed-tense',
    tests: 'Past and future in one breath. Only what happened is recorded.',
    entryDate: '2026-08-26',
    vocabulary: VOCAB,
    transcript: `Poured the blinding at Pier 3 this morning, eight cube off Hanson, Danny and Sam on it eight hours each. This arvo we'll be setting up formwork for the headstock, and tomorrow we're back on the kerb in Area B North.`,
    expected: proposal({
      labour: [
        L('Danny Rowe', { hours: 8, area: 'Pier 3' }),
        L('Sam Whitely', { hours: 8, area: 'Pier 3' }),
      ],
      work_items: [W('Poured the blinding', { area: 'Pier 3' })],
      pours: [C({ location: 'Pier 3', volume_m3: 8, supplier: 'Hanson' })],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },

  {
    id: '23-finish-time',
    tests: 'Stated finish times resolve against the 07:00 site start; unstated stay null for the policy fill.',
    entryDate: '2026-08-27',
    vocabulary: VOCAB,
    transcript: `Danny worked till one and went home. Sam did his full day. Kel knocked off at three.`,
    expected: proposal({
      labour: [
        // 06:30 to 13:00. The model does this arithmetic because the finish
        // was actually said.
        L('Danny Rowe', { hours: 6.5 }),
        // "His full day" states the standard day in words, so 10 here is the
        // model reading what was said, not inventing. (Silence about someone's
        // time stays null — fixture 16 pins that — and the policy fill covers it.)
        L('Sam Whitely', { hours: 10 }),
        // 06:30 to 15:00.
        L('Kel Brady', { hours: 8.5 }),
      ],
      sections: { plant: S.gap, work_items: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },
  {
    id: '24-dayworks',
    tests:
      'Dayworks land in the dayworks array, not work_items or labour; a spoken docket ref is kept, hours only when stated.',
    entryDate: '2026-08-28',
    vocabulary: VOCAB,
    transcript: `Kel and Toby spent four hours on dayworks this morning, exposing the Telstra conduit for the principal, docket DW-114. Rest of the crew, Danny and Sam, were on the kerb line all day as normal.`,
    expected: proposal({
      labour: [
        // Ordinary contract work stays in labour; the dayworks pair are
        // accounted for in the dayworks item, not duplicated here.
        L('Danny Rowe', {}),
        L('Sam Whitely', {}),
      ],
      work_items: [
        {
          area: null,
          description: 'Kerb line',
          percent_complete: null,
          source_quote: 'were on the kerb line all day as normal',
          confidence: 'high',
        },
      ],
      dayworks: [
        {
          description: 'Exposing the Telstra conduit for the principal',
          labour: 'Kel Brady, Toby Nguyen',
          plant: null,
          materials: null,
          hours: 4,
          docket_ref: 'DW-114',
          source_quote:
            'Kel and Toby spent four hours on dayworks this morning, exposing the Telstra conduit for the principal, docket DW-114',
          confidence: 'high',
        },
      ],
      sections: { plant: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },
  {
    id: '25-start-finish-break',
    tests:
      'Spoken start/finish land as clock times, a stated break in break_mins, and hours are the net arithmetic.',
    entryDate: '2026-09-01',
    vocabulary: VOCAB,
    transcript: `Danny started at seven and knocked off at half three, half hour smoko as usual. Sam did seven till three with no break today.`,
    expected: proposal({
      labour: [
        // 07:00–15:30 minus 30 = 8.0
        L('Danny Rowe', {
          start_time: '07:00',
          finish_time: '15:30',
          break_mins: 30,
          hours: 8,
          source_quote: 'Danny started at seven and knocked off at half three, half hour smoko as usual',
        }),
        // 07:00–15:00 minus 0 = 8.0
        L('Sam Whitely', {
          start_time: '07:00',
          finish_time: '15:00',
          break_mins: 0,
          hours: 8,
          source_quote: 'Sam did seven till three with no break today',
        }),
      ],
      sections: { plant: S.gap, work_items: S.gap, variations: S.gap, delays: S.gap, weather: S.gap },
    }),
  },
];

export const FIXTURES_BY_ID = new Map(FIXTURES.map((f) => [f.id, f]));

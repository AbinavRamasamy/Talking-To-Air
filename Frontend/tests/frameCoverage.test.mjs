// Stamps are naive UTC; run under a non-UTC zone so a local-time parse fails.
process.env.TZ = 'America/New_York'

import assert from 'node:assert/strict'
import test from 'node:test'
import { buildScrubAxis, coverageSentence } from '../src/utils/frameAxis.js'

const OBSERVED = { n_granules: 1, valid_fraction: 0.9, qa_pass_rate: 1.0, statistics: { count: 100 } }
const QA_REJECTED = { n_granules: 0, valid_fraction: 0.0, qa_pass_rate: 0.0, statistics: { count: 0 } }
const NOT_RETRIEVED = { n_granules: 0, valid_fraction: 0.0, qa_pass_rate: null, statistics: { count: 0 } }

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 19)
}

// One frame per step from `start`, each in the given state.
function axisOf(start, stepMs, states, { cadence = 'hourly', tier = 'cadence', bucketsPerFrame = 1 } = {}) {
  const t0 = Date.parse(`${start}Z`)
  const frames = states.map((state, i) => ({
    ...state, t_start: iso(t0 + i * stepMs), t_end: iso(t0 + (i + 1) * stepMs),
  }))
  return buildScrubAxis({ frames: { frames, period_index: 0, cadence, tier, buckets_per_frame: bucketsPerFrame } })
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const hours = (pattern) => [...pattern].map((c) => ({ o: OBSERVED, q: QA_REJECTED, '.': NOT_RETRIEVED })[c])

test('a full UTC day of hourly slots, as TEMPO retrieves it (live: 13 of 24)', () => {
  // 10:00–22:00 observed, the rest is night.
  const axis = axisOf('2026-06-05T00:00:00', HOUR, hours('..........ooooooooooooo.'))
  assert.equal(coverageSentence(axis), '13 hourly granules hold data, across 13 of 24 hours (05 Jun 00:00–24:00 UTC).')
})

test('a partial day names the hours it spans, and a rejected hour is disclosed (live: 11 of 12)', () => {
  const axis = axisOf('2024-08-05T10:00:00', HOUR, hours('qooooooooooo'))
  assert.equal(
    coverageSentence(axis),
    '11 hourly granules hold data, across 11 of 12 hours (05 Aug 10:00–22:00 UTC). '
      + '1 more hour had data that failed quality checks.',
  )
})

test('hourly slots across several days', () => {
  const axis = axisOf('2026-06-04T00:00:00', HOUR, hours('o'.repeat(26) + '.'.repeat(22)))
  assert.equal(coverageSentence(axis), '26 hourly granules hold data, across 26 of 48 hours (04 Jun 00:00 – 06 Jun 00:00 UTC).')
})

test('daily slots count days, with an inclusive last day', () => {
  const axis = axisOf('2026-06-01T00:00:00', DAY, hours('oo.oooo'), { cadence: 'daily' })
  assert.equal(coverageSentence(axis), '6 daily granules hold data, across 6 of 7 days (01 Jun – 07 Jun 2026).')
})

test('monthly slots count months', () => {
  const frames = Array.from({ length: 12 }, (_, m) => ({
    ...(m === 3 || m === 7 ? NOT_RETRIEVED : OBSERVED),
    t_start: iso(Date.UTC(2025, m, 1)),
    t_end: iso(Date.UTC(2025, m + 1, 1)),
  }))
  const axis = buildScrubAxis({ frames: { frames, period_index: 0, cadence: 'monthly', tier: 'cadence', buckets_per_frame: 1 } })
  assert.equal(coverageSentence(axis), '10 monthly granules hold data, across 10 of 12 months (Jan 2025 – Dec 2025).')
})

test('coarsened frames are counted as the blocks they are, not as hours', () => {
  const axis = axisOf('2026-06-01T00:00:00', 3 * HOUR, hours('..oooo..'), { tier: 'coarsened', bucketsPerFrame: 3 })
  assert.equal(
    coverageSentence(axis),
    '4 hourly granules hold data, across 4 of 8 three-hour blocks (01 Jun 00:00–24:00 UTC).',
  )
})

test('a cadence the axis cannot name falls back to intervals', () => {
  const axis = axisOf('2026-06-01T00:00:00', HOUR, hours('oo.o'), { cadence: 'unknown' })
  assert.equal(coverageSentence(axis), '3 granules hold data, across 3 of 4 intervals.')
})

test('singular units read naturally', () => {
  const axis = axisOf('2026-06-05T14:00:00', HOUR, hours('o'))
  assert.equal(coverageSentence(axis), '1 hourly granule holds data, across 1 of 1 hour (05 Jun 14:00–15:00 UTC).')
  const twoRejected = axisOf('2026-06-05T10:00:00', HOUR, hours('qqo'))
  assert.match(coverageSentence(twoRejected), /2 more hours had data that failed quality checks\.$/)
})

// The map's title counts granules (14 on the live OTR map) while the axis
// counts hours (13): two TEMPO scans can share an hour. The sentence names
// both, so the title's number appears on the time axis too.
test('the sentence counts granules as well as the hours they fall in (live: 14 in 13)', () => {
  const states = hours('..........ooooooooooooo.')
  states[10] = { ...OBSERVED, n_granules: 2 }
  const axis = axisOf('2026-06-05T00:00:00', HOUR, states)
  assert.equal(coverageSentence(axis), '14 hourly granules hold data, across 13 of 24 hours (05 Jun 00:00–24:00 UTC).')
})

test('an axis whose frames carry no granule count keeps the hour-only sentence', () => {
  const axis = axisOf('2026-06-05T14:00:00', HOUR, [{ ...OBSERVED, n_granules: undefined }])
  assert.equal(coverageSentence(axis), 'Hourly observations are available for 1 of 1 hour (05 Jun 14:00–15:00 UTC).')
})

test('no axis, no sentence', () => {
  assert.equal(coverageSentence(null), null)
})

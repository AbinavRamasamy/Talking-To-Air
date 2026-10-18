import test from 'node:test'
import assert from 'node:assert/strict'

import { quickLookView } from '../src/utils/quickLook.js'

const ready = {
  loading: false,
  error: null,
  gibs_url: 'https://gibs.example/wms?LAYERS=TEMPO_L3_NO2_Vertical_Column_Troposphere',
  layer: 'TEMPO_L3_NO2_Vertical_Column_Troposphere',
  layer_is_guess: false,
  time: '2026-06-05T17:00:00Z',
}

test('nothing is shown before a quick-look is asked for', () => {
  assert.equal(quickLookView(undefined, null), null)
})

test('a pending quick-look says so', () => {
  assert.deepEqual(quickLookView({ loading: true }, null), { kind: 'loading', text: 'Loading quick-look…' })
})

test('a failed request shows its message', () => {
  assert.deepEqual(quickLookView({ loading: false, error: 'Area not found' }, null), { kind: 'error', text: 'Area not found' })
})

test('a ready quick-look shows the image captioned with its layer and the hour it shows', () => {
  assert.deepEqual(quickLookView(ready, null), {
    kind: 'image',
    url: ready.gibs_url,
    caption: 'NASA GIBS · TEMPO_L3_NO2_Vertical_Column_Troposphere · 2026-06-05 17:00 UTC',
  })
})

test('a daily layer is captioned with its date alone', () => {
  const view = quickLookView({ ...ready, layer: 'MODIS_Terra_Aerosol', time: '2026-06-05' }, null)
  assert.equal(view.caption, 'NASA GIBS · MODIS_Terra_Aerosol · 2026-06-05')
})

test('an image that failed to load is replaced by a sentence, not a broken icon', () => {
  const view = quickLookView(ready, ready.gibs_url)
  assert.equal(view.kind, 'none')
  assert.match(view.text, /GIBS returned no image/)
})

test('a guessed layer that fails says the dataset has no GIBS browse layer', () => {
  const guessed = { ...ready, layer: 'TEMPO_NO2_L2', layer_is_guess: true }
  const view = quickLookView(guessed, guessed.gibs_url)
  assert.equal(view.kind, 'none')
  assert.match(view.text, /no NASA GIBS browse imagery/)
})

test('a failure recorded for an earlier image does not hide a new one', () => {
  assert.equal(quickLookView(ready, 'https://gibs.example/older').kind, 'image')
})

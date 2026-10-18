/**
 * What a discovery card shows for its Quick-look: a status line, or the GIBS
 * image with a caption naming the layer and the time it shows. Pure, so it is
 * unit-testable under plain `node --test`.
 *
 * `failedUrl` is the image URL whose <img> fired `onError`. GIBS answers an
 * unknown layer with an XML error page, which the browser cannot draw, so a
 * failed load is how a missing layer surfaces.
 */
export function quickLookView(preview, failedUrl) {
  if (!preview) return null
  if (preview.loading) return { kind: 'loading', text: 'Loading quick-look…' }
  if (preview.error) return { kind: 'error', text: preview.error }
  if (!preview.gibs_url) return null
  if (preview.gibs_url === failedUrl) {
    return {
      kind: 'none',
      text: preview.layer_is_guess
        ? 'This dataset has no NASA GIBS browse imagery.'
        : 'NASA GIBS returned no image for this area and day.',
    }
  }
  return {
    kind: 'image',
    url: preview.gibs_url,
    caption: ['NASA GIBS', preview.layer, gibsTimeLabel(preview.time)].filter(Boolean).join(' · '),
  }
}

function gibsTimeLabel(time) {
  if (!time) return ''
  const [date, clock] = String(time).split('T')
  return clock ? `${date} ${clock.slice(0, 5)} UTC` : date
}

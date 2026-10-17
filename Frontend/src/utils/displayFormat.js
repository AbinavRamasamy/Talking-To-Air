/**
 * Display formatting for science values and units: `molecules/cm^2` reads as
 * molecules/cm², and 1.406e+15 reads as 1.406 × 10¹⁵. Pure, so it is
 * unit-testable under plain `node --test`.
 */

const SUPERSCRIPT = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}
const MINUS = '−'

function superscript(exponent) {
  return [...String(exponent)].map(ch => SUPERSCRIPT[ch] ?? ch).join('')
}

/** `cm^2`, `m^-2` and CF-style `cm-2`, `m3` written with superscript
 * exponents. A digit run counts as an exponent only right after a letter
 * and not followed by more of a word or a decimal point, so `PM2.5` stays. */
export function formatUnits(units) {
  if (units == null) return ''
  return String(units)
    .replace(/\^(-?\d+)/g, (_, exp) => superscript(exp))
    .replace(/([A-Za-zµμ])(-?\d+)(?![\w.])/g, (_, unit, exp) => unit + superscript(exp))
}

/** `n` with `digits` mantissa decimals as `m × 10ⁿ` when it is very large or
 * very small, and as a plain 4-significant-figure number otherwise. */
export function formatScientific(n, digits = 3) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e4)) {
    const [mantissa, exponent] = n.toExponential(digits).split('e')
    return `${mantissa.replace('-', MINUS)} × 10${superscript(Number(exponent))}`
  }
  return String(Number(n.toPrecision(4))).replace('-', MINUS)
}

/** A statistic with its units, both formatted for display. */
export function formatStatValue(n, units) {
  const value = formatScientific(n)
  if (value === '—') return value
  const shown = formatUnits(units)
  return shown ? `${value} ${shown}` : value
}

/** Colorbar tick labels sharing one power of ten, so long labels like
 * 4.5 × 10¹⁴ do not crowd a narrow bar. `multiplier` names that power once
 * (empty for ordinary magnitudes) and belongs beside the units. */
export function scaledTicks(values) {
  const finite = values.filter(v => typeof v === 'number' && Number.isFinite(v))
  const maxAbs = Math.max(0, ...finite.map(Math.abs))
  const needsScale = maxAbs !== 0 && (maxAbs < 1e-3 || maxAbs >= 1e4)
  const exponent = needsScale ? Math.floor(Math.log10(maxAbs)) : 0
  const label = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
    const scaled = needsScale ? v / 10 ** exponent : v
    return String(Number(scaled.toPrecision(needsScale ? 2 : 3))).replace('-', MINUS)
  }
  return {
    labels: values.map(label),
    multiplier: needsScale ? `× 10${superscript(exponent)}` : '',
  }
}

export function scaledUnitsLabel(multiplier, units) {
  return [multiplier, formatUnits(units)].filter(Boolean).join(' ')
}

const FROM_SUPERSCRIPT = Object.fromEntries(Object.entries(SUPERSCRIPT).map(([plain, sup]) => [sup, plain]))
const SUPERSCRIPT_RUN = new RegExp(`[${Object.values(SUPERSCRIPT).join('')}]+`, 'g')

/** `text` split into plain and exponent runs, exponents back in plain digits.
 * Components render the exponent runs in <sup>: most fonts carry ¹²³ but not
 * ⁴–⁹ or ⁰, so Unicode exponents mix two typefaces. */
export function superscriptRuns(text) {
  const runs = []
  let last = 0
  for (const match of String(text ?? '').matchAll(SUPERSCRIPT_RUN)) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), sup: false })
    runs.push({ text: [...match[0]].map(ch => FROM_SUPERSCRIPT[ch]).join(''), sup: true })
    last = match.index + match[0].length
  }
  if (last < String(text ?? '').length) runs.push({ text: String(text).slice(last), sup: false })
  return runs
}

/** `text` with its exponents as the <sup> markup Plotly renders. */
export function plotlySuperscript(text) {
  return superscriptRuns(text).map(run => (run.sup ? `<sup>${run.text}</sup>` : run.text)).join('')
}

/** An ISO timestamp as its calendar date (`2026-06-04T10:26:42.03` → `2026-06-04`).
 * Anything that does not start with a date passes through. */
export function compactDate(value) {
  if (!value) return ''
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(text) ? text.slice(0, 10) : text
}

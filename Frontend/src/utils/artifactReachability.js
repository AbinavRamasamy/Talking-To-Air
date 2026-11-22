// Which artifacts get their own clickable card.
//
// `table` artifacts have no other rendering, so they're always reachable.
// Chart-backed artifact types (map, comparison, and a chart-backed
// `timeseries`) duplicate what the parallel entry in msg.charts already
// shows -- deliberately excluded (Chat.jsx's original comment). Ground-
// validation `timeseries` artifacts (validate_against_ground/
// exceedance_overlay, Backend/tools/satellite_tools/validation_tools.py)
// mint their own chart_id and never call emit_chart, so nothing in
// msg.charts shares that id -- they have no duplicate to avoid and need
// their own card too.
function hasMatchingChart(artifact, charts) {
  return (charts || []).some(chart => {
    const chartId = chart?.chart_id ?? chart?.id
    return chartId != null && chartId === artifact.id
  })
}

export function isReachableArtifact(artifact, charts) {
  if (!artifact) return false
  if (artifact.type === 'table') return true
  if (artifact.type === 'timeseries') return !hasMatchingChart(artifact, charts)
  return false
}

export function reachableArtifacts(msg) {
  const list = (msg?.artifacts || []).filter(artifact => isReachableArtifact(artifact, msg?.charts))
  if (list.length <= 1) return list

  const merged = []
  const groundTablesByKey = new Map()

  for (const art of list) {
    if (art.type === 'table') {
      const meta = art.metadata || {}
      const baseTitle = String(art.title || '').replace(/\s*\([^)]*\)$/, '').trim().toLowerCase()
      const loc = String(meta.location || meta.site_id || baseTitle).trim().toLowerCase()
      const dataset = String(meta.dataset || '').trim().toLowerCase()
      const isGround = Boolean(meta.has_coordinates || dataset.includes('epa') || meta.query_type)

      if (isGround && (loc || baseTitle)) {
        const key = `${dataset}::${loc || baseTitle}`
        if (!groundTablesByKey.has(key)) {
          groundTablesByKey.set(key, [art])
        } else {
          groundTablesByKey.get(key).push(art)
        }
        continue
      }
    }
    merged.push(art)
  }

  for (const group of groundTablesByKey.values()) {
    if (group.length === 1) {
      merged.push(group[0])
    } else {
      const first = group[0]
      const cleanTitle = String(first.title || '').replace(/\s*\([^)]*\)$/, '').trim()
      const allMergedIds = group.map(g => g.id).filter(Boolean)
      const totalRows = group.reduce((sum, g) => sum + (g.row_count ?? g.rows?.length ?? 0), 0)
      const combinedRows = group.some(g => g.rows?.length) ? group.flatMap(g => g.rows || []) : null
      const pollutants = []
      for (const g of group) {
        const p = g.metadata?.pollutant
        if (p && p !== 'ALL') {
          for (const sub of String(p).split(',')) {
            const clean = sub.trim()
            if (clean && !pollutants.includes(clean)) pollutants.push(clean)
          }
        }
      }

      merged.push({
        ...first,
        id: first.id,
        merged_ids: allMergedIds,
        title: pollutants.length ? `${cleanTitle} (${pollutants.join(', ')})` : cleanTitle,
        row_count: totalRows,
        rows: combinedRows,
        metadata: {
          ...first.metadata,
          pollutant: pollutants.length ? pollutants.join(',') : first.metadata?.pollutant,
          merged_artifact_ids: allMergedIds,
        },
      })
    }
  }

  return merged
}

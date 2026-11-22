import { useEffect, useMemo, useRef, useState } from 'react'
// maplibre-gl 6 is ESM-only with no default export.
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildMapStyle, fetchTileConfig } from '../utils/mapTiles.js'
import { fetchUsStatesGeoJSON, isConusBounds } from '../utils/regionBorders.js'
import { apiFetch } from '../utils/apiFetch.js'
import { API_BASE } from '../config.js'

const NO_ROWS = []

function getAQIColor(val, minVal, maxVal) {
  if (val == null || isNaN(val)) return '#94a3b8'
  const range = maxVal - minVal
  const ratio = range > 0 ? Math.max(0, Math.min(1, (val - minVal) / range)) : 0.5
  if (ratio < 0.25) return '#10b981' // Green / Good
  if (ratio < 0.5) return '#f59e0b'  // Amber / Moderate
  if (ratio < 0.75) return '#f97316' // Orange / Sensitive
  return '#ef4444'                  // Red / High
}

function StatCard({ label, value, subtitle }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: '10px',
      padding: '11px 13px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '5px' }}>{label}</div>
      <div style={{ fontSize: '15px', fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value}</div>
      {subtitle && (
        <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '4px', lineHeight: 1.35 }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

function MapColorbar({ minVal, maxVal, units, title = 'EPA Ground Monitors' }) {
  const gradientId = 'ground-colorbar-gradient'
  const gradientStops = [
    { offset: '0%', color: '#10b981' },
    { offset: '33%', color: '#f59e0b' },
    { offset: '66%', color: '#f97316' },
    { offset: '100%', color: '#ef4444' },
  ]

  const ticks = useMemo(() => {
    const steps = [0, 0.25, 0.5, 0.75, 1]
    return steps.map(ratio => {
      const v = minVal + ratio * (maxVal - minVal)
      const label = Number.isFinite(v) ? (v >= 10 ? v.toFixed(1) : v.toFixed(2)) : '—'
      return { ratio, value: v, label }
    })
  }, [minVal, maxVal])

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        background: 'rgba(255,255,255,0.92)',
        borderRadius: '6px',
        padding: '6px 10px 8px',
        boxShadow: 'var(--shadow-sm)',
        zIndex: 1,
        pointerEvents: 'auto',
      }}
    >
      <svg width={180} height={14} style={{ display: 'block' }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
            {gradientStops.map((stop, i) => (
              <stop key={i} offset={stop.offset} stopColor={stop.color} />
            ))}
          </linearGradient>
        </defs>
        <rect x={0} y={0} width={180} height={14} fill={`url(#${gradientId})`} rx={2} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: 180, marginTop: 3 }}>
        {ticks.map((tick, i) => (
          <span key={i} style={{ fontSize: '9px', color: '#333', fontFamily: 'var(--font)' }}>
            {tick.label}
          </span>
        ))}
      </div>
      {units && (
        <div style={{ fontSize: '9px', color: '#555', textAlign: 'center', marginTop: 2 }}>{units}</div>
      )}
      {title && (
        <div style={{ fontSize: '8px', color: '#777', textAlign: 'center', marginTop: 2, fontStyle: 'italic' }}>
          {title}
        </div>
      )}
    </div>
  )
}

function normalizeParam(r) {
  if (!r) return { key: 'OTHER', label: 'Other', defaultUnit: '' }
  const rawParam = String(r.parameter || r.parameter_name || r.pollutant || r.param_name || '').trim()
  const rawCode = String(r.parameter_code || r.param_code || '').trim()
  const p = rawParam.toUpperCase()

  if (rawCode === '44201' || p === 'O3' || p === 'OZONE') {
    return { key: 'O3', label: 'Ozone (O₃)', defaultUnit: r.units || 'PPB' }
  }
  if (rawCode === '88101' || rawCode === '88502' || p === 'PM25' || p === 'PM2.5' || p.includes('PM2.5')) {
    return { key: 'PM25', label: 'PM₂.₅', defaultUnit: r.units || 'UG/M3' }
  }
  if (rawCode === '81102' || p === 'PM10' || p.includes('PM10')) {
    return { key: 'PM10', label: 'PM₁₀', defaultUnit: r.units || 'UG/M3' }
  }
  if (rawCode === '42602' || p === 'NO2' || p.includes('NITROGEN DIOXIDE')) {
    return { key: 'NO2', label: 'NO₂', defaultUnit: r.units || 'PPB' }
  }
  if (rawCode === '42401' || p === 'SO2' || p.includes('SULFUR DIOXIDE')) {
    return { key: 'SO2', label: 'SO₂', defaultUnit: r.units || 'PPB' }
  }
  if (rawCode === '42101' || p === 'CO' || p.includes('CARBON MONOXIDE')) {
    return { key: 'CO', label: 'CO', defaultUnit: r.units || 'PPM' }
  }

  const key = rawParam || rawCode || 'Other'
  return { key, label: key, defaultUnit: r.units || '' }
}

export default function TableMapPanel({ artifact, height = 480, isCompare = false }) {
  const inlineRows = artifact?.rows?.length ? artifact.rows : null
  const [fetched, setFetched] = useState({ id: null, rows: NO_ROWS, error: null })
  const [selectedSiteId, setSelectedSiteId] = useState(null)
  const [selectedParamKey, setSelectedParamKey] = useState(null)

  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const activePopupRef = useRef(null)

  // 1. Fetch artifact rows if not already populated on the artifact object
  useEffect(() => {
    if (inlineRows || !artifact?.id) return undefined
    let cancelled = false
    const id = artifact.id
    apiFetch(`${API_BASE}/artifacts/${id}?offset=0&limit=500`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (!cancelled) setFetched({ id, rows: data.rows || NO_ROWS, error: null })
      })
      .catch(err => {
        if (!cancelled) setFetched({ id, rows: NO_ROWS, error: err.message || 'Failed to load table data' })
      })

    return () => {
      cancelled = true
    }
  }, [artifact?.id, inlineRows])

  const fetchedThis = fetched.id === artifact?.id
  const rows = inlineRows || (fetchedThis ? fetched.rows : NO_ROWS)
  const error = !inlineRows && fetchedThis ? fetched.error : null
  const loading = !inlineRows && Boolean(artifact?.id) && !fetchedThis

  // 2. Extract available pollutant parameters across rows
  const availableParameters = useMemo(() => {
    if (!rows || !rows.length) return []
    const map = new Map()
    for (const r of rows) {
      const norm = normalizeParam(r)
      const unit = r.units || norm.defaultUnit || ''
      if (!map.has(norm.key)) {
        map.set(norm.key, {
          key: norm.key,
          label: norm.label,
          unit,
          count: 1,
        })
      } else {
        const item = map.get(norm.key)
        item.count++
        if (!item.unit && unit) item.unit = unit
      }
    }
    return Array.from(map.values())
  }, [rows])

  const activeParamKey = useMemo(() => {
    if (!availableParameters.length) return null
    if (selectedParamKey && availableParameters.some(p => p.key === selectedParamKey)) {
      return selectedParamKey
    }
    return availableParameters[0].key
  }, [availableParameters, selectedParamKey])

  // Filter rows by the active pollutant parameter to avoid mixing units
  const filteredRows = useMemo(() => {
    if (!rows || !rows.length) return []
    if (!activeParamKey || availableParameters.length <= 1) return rows
    return rows.filter(r => normalizeParam(r).key === activeParamKey)
  }, [rows, activeParamKey, availableParameters.length])

  // 3. Filter rows with valid coordinates and combine rows by unique monitor station location
  const monitors = useMemo(() => {
    if (!filteredRows || !filteredRows.length) return []

    const parseNum = (v) => {
      if (v == null || v === '' || v === '—') return null
      const n = Number(v)
      return !isNaN(n) && n > -900 ? n : null
    }

    const stationsMap = new Map()

    for (const r of filteredRows) {
      const lat = Number(r.latitude)
      const lon = Number(r.longitude)
      if (isNaN(lat) || isNaN(lon) || lat === 0 || lon === 0) continue

      const siteId = r.site_id || `${lat.toFixed(4)},${lon.toFixed(4)}`
      const meanVal = parseNum(r.mean)
      const maxVal = parseNum(r.max)
      const peakVal = r.peak?.value != null ? parseNum(r.peak.value) : null
      const primaryVal = meanVal ?? maxVal ?? peakVal

      const cleanName = (r.local_site_name || r.station_name || r.monitor_name || r.site_id || 'Monitor')
        .replace(/\s*\([^)]*\)\s*$/, '')

      if (!stationsMap.has(siteId)) {
        stationsMap.set(siteId, {
          ...r,
          lat,
          lon,
          site_id: siteId,
          displayName: cleanName,
          units: r.units || '',
          pollutant_standard: r.pollutant_standard || '',
          values: primaryVal != null ? [primaryVal] : [],
          means: meanVal != null ? [meanVal] : [],
          maxs: maxVal != null ? [maxVal] : [],
          peaks: peakVal != null ? [peakVal] : [],
          parameters: new Set(r.parameter ? [r.parameter] : []),
        })
      } else {
        const existing = stationsMap.get(siteId)
        if (primaryVal != null) existing.values.push(primaryVal)
        if (meanVal != null) existing.means.push(meanVal)
        if (maxVal != null) existing.maxs.push(maxVal)
        if (peakVal != null) existing.peaks.push(peakVal)
        if (r.parameter) existing.parameters.add(r.parameter)
        if ((!existing.displayName || existing.displayName === 'Monitor') && cleanName) {
          existing.displayName = cleanName
        }
      }
    }

    return Array.from(stationsMap.values()).map(st => {
      const avgMean = st.means.length ? st.means.reduce((a, b) => a + b, 0) / st.means.length : null
      const peakMax = st.maxs.length ? Math.max(...st.maxs) : null
      const primary = avgMean ?? peakMax ?? (st.values.length ? st.values[0] : null)
      return {
        ...st,
        mean: avgMean,
        max: peakMax,
        primaryVal: primary,
        parameter_list: Array.from(st.parameters).join(', '),
      }
    })
  }, [filteredRows])

  // Summary statistics
  const { minVal, maxVal, spatialMean, peakMonitor, lowestMonitor, units, pollutant } = useMemo(() => {
    const validVals = monitors.map(m => m.primaryVal).filter(v => v != null && v > -900)
    const min = validVals.length ? Math.min(...validVals) : 0
    const max = validVals.length ? Math.max(...validVals) : 1
    const mean = validVals.length ? (validVals.reduce((acc, v) => acc + v, 0) / validVals.length) : 0
    const peakMon = monitors.find(m => m.primaryVal === max) || null
    const lowMon = monitors.find(m => m.primaryVal === min) || null

    const activeParam = availableParameters.find(p => p.key === activeParamKey)
    const u = monitors.find(m => m.units)?.units || activeParam?.unit || ''
    const p = activeParam ? `${activeParam.label} Ground Monitors` : (artifact?.title || 'Air Quality')
    return {
      minVal: min,
      maxVal: max,
      spatialMean: mean,
      peakMonitor: peakMon,
      lowestMonitor: lowMon,
      units: u,
      pollutant: p,
    }
  }, [monitors, activeParamKey, availableParameters, artifact?.title])

  // Helper to open station popup
  const openStationPopup = (m, mapInstance = mapRef.current) => {
    if (!mapInstance) return
    if (activePopupRef.current) {
      activePopupRef.current.remove()
      activePopupRef.current = null
    }

    const html = `
      <div style="font-family: var(--font, sans-serif); padding: 4px; min-width: 180px;">
        <div style="font-weight: 800; font-size: 13.5px; color: #111; margin-bottom: 2px;">
          ${m.displayName}
        </div>
        <div style="font-size: 10.5px; font-family: monospace; color: #666; margin-bottom: 8px;">
          Site ${m.site_id}${m.parameter_list ? ` · ${m.parameter_list}` : ''}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
          <span style="font-size: 11.5px; color: #555;">Daily Mean:</span>
          <span style="font-weight: 800; font-size: 13px; color: #000;">
            ${m.mean != null ? Number(m.mean).toFixed(2) : '—'} ${m.units}
          </span>
        </div>
        ${m.max != null && !isNaN(Number(m.max)) ? `
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
          <span style="font-size: 11.5px; color: #555;">Daily Max:</span>
          <span style="font-weight: 800; font-size: 13px; color: #e11d48;">
            ${Number(m.max).toFixed(2)} ${m.units}
          </span>
        </div>` : ''}
        ${m.peak?.first_max_hour != null ? `
        <div style="font-size: 10px; color: #777; margin-top: 4px; border-top: 1px solid #eee; padding-top: 4px;">
          Peak at hour ${m.peak.first_max_hour}:00
        </div>` : ''}
      </div>
    `

    const popup = new maplibregl.Popup({ offset: 12, closeButton: true })
      .setLngLat([m.lon, m.lat])
      .setHTML(html)
      .addTo(mapInstance)

    activePopupRef.current = popup
  }

  // 3. Initialize and mount MapLibre map
  useEffect(() => {
    if (!containerRef.current || !monitors.length) return

    let cancelled = false
    let map = null

    // Compute bounding box
    const lons = monitors.map(m => m.lon)
    const lats = monitors.map(m => m.lat)
    let minx = Math.min(...lons)
    let maxx = Math.max(...lons)
    let miny = Math.min(...lats)
    let maxy = Math.max(...lats)

    // Expand bounding box if points are tightly clustered
    if (maxx - minx < 0.08) {
      minx -= 0.05
      maxx += 0.05
    }
    if (maxy - miny < 0.08) {
      miny -= 0.05
      maxy += 0.05
    }

    fetchTileConfig().then(tileConfig => {
      if (cancelled || !containerRef.current) return

      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle(tileConfig),
        attributionControl: false,
      })
      mapRef.current = map

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')

      map.on('load', () => {
        if (cancelled) return

        map.resize()
        map.fitBounds([[minx, miny], [maxx, maxy]], { padding: 40, maxZoom: 14, animate: false })

        // Add US state boundaries
        if (isConusBounds(minx, miny, maxx, maxy)) {
          fetchUsStatesGeoJSON().then(geojson => {
            if (!cancelled && map.getSource && !map.getSource('region-borders')) {
              map.addSource('region-borders', { type: 'geojson', data: geojson })
              map.addLayer({
                id: 'region-borders',
                type: 'line',
                source: 'region-borders',
                paint: { 'line-color': 'rgba(40,40,40,0.6)', 'line-width': 1.1 },
              })
            }
          })
        }

        // Build GeoJSON FeatureCollection
        const geojson = {
          type: 'FeatureCollection',
          features: monitors.map(m => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
            properties: {
              site_id: m.site_id,
              name: m.displayName,
              mean: m.mean != null ? Number(m.mean).toFixed(2) : '—',
              max: m.max != null ? Number(m.max).toFixed(2) : '—',
              peak_hour: m.peak?.first_max_hour != null ? `${m.peak.first_max_hour}:00` : '',
              units: m.units,
              standard: m.pollutant_standard || '',
              color: getAQIColor(m.primaryVal, minVal, maxVal),
            },
          })),
        }

        map.addSource('ground-monitors', {
          type: 'geojson',
          data: geojson,
        })

        // Outer halo circle
        map.addLayer({
          id: 'ground-monitors-halo',
          type: 'circle',
          source: 'ground-monitors',
          paint: {
            'circle-radius': 14,
            'circle-color': ['get', 'color'],
            'circle-opacity': 0.25,
          },
        })

        // Core marker circle
        map.addLayer({
          id: 'ground-monitors-pin',
          type: 'circle',
          source: 'ground-monitors',
          paint: {
            'circle-radius': 8,
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': '#ffffff',
          },
        })

        // Cursor & interactive popup
        map.on('mouseenter', 'ground-monitors-pin', () => {
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'ground-monitors-pin', () => {
          map.getCanvas().style.cursor = ''
        })

        map.on('click', 'ground-monitors-pin', e => {
          const feature = e.features?.[0]
          if (!feature) return
          const props = feature.properties
          const matchingMon = monitors.find(m => m.site_id === props.site_id)
          if (matchingMon) {
            setSelectedSiteId(matchingMon.site_id)
            openStationPopup(matchingMon, map)
          }
        })
      })
    })

    return () => {
      cancelled = true
      if (activePopupRef.current) {
        activePopupRef.current.remove()
        activePopupRef.current = null
      }
      if (map) map.remove()
      mapRef.current = null
    }
  }, [monitors, minVal, maxVal])

  // Fly to monitor when clicked from the station selector
  const handleSelectMonitor = (m) => {
    setSelectedSiteId(m.site_id)
    if (!mapRef.current) return
    mapRef.current.flyTo({
      center: [m.lon, m.lat],
      zoom: 12,
      essential: true,
    })
    openStationPopup(m, mapRef.current)
  }

  if (loading) {
    return (
      <div style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading spatial monitor coordinates...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px', color: 'var(--error)' }}>
        Error loading monitor coordinates: {error}
      </div>
    )
  }

  if (!monitors.length) {
    return (
      <div style={{
        padding: '48px 24px', textAlign: 'center',
        background: 'var(--bg-secondary)', borderRadius: '12px',
        border: '1px dashed var(--border)',
      }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '8px' }}>
          No Coordinate Data Found
        </div>
        <div style={{ fontSize: '12.5px', color: 'var(--text-muted)', maxWidth: '420px', margin: '0 auto' }}>
          This table does not contain valid latitude and longitude fields to plot on a map.
        </div>
      </div>
    )
  }

  const mapHeight = height ? (typeof height === 'number' ? `${height}px` : height) : (isCompare ? '360px' : '480px')

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Pollutant Parameter Radio Selection Area */}
      {availableParameters.length > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '8px 12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Ground Pollutant:
            </span>
            <span style={{ fontSize: '11px', color: 'var(--text-hint)' }}>
              (select to isolate specific parameter and units)
            </span>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {availableParameters.map(p => {
              const isSelected = activeParamKey === p.key
              return (
                <label
                  key={p.key}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: isSelected ? 700 : 500,
                    cursor: 'pointer',
                    background: isSelected ? 'var(--bg-card)' : 'transparent',
                    border: `1px solid ${isSelected ? 'var(--teal)' : 'transparent'}`,
                    color: isSelected ? 'var(--teal-text)' : 'var(--text-secondary)',
                    boxShadow: isSelected ? 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.06))' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <input
                    type="radio"
                    name="ground-data-pollutant"
                    value={p.key}
                    checked={isSelected}
                    onChange={() => {
                      setSelectedParamKey(p.key)
                      setSelectedSiteId(null)
                    }}
                    style={{ cursor: 'pointer', accentColor: 'var(--teal)' }}
                  />
                  <span>{p.label}</span>
                  {p.unit && (
                    <span style={{ fontSize: '10px', opacity: 0.8, fontFamily: 'var(--font-mono)' }}>
                      [{p.unit}]
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* MapLibre container matching MapLibreHeatmapPanel structure */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: mapHeight,
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Scientific Overlay Colorbar */}
        <MapColorbar
          minVal={minVal}
          maxVal={maxVal}
          units={units}
          title={pollutant}
        />
      </div>

      {/* Supporting Information & Statistics Grid (rendered in single view) */}
      {!isCompare && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <StatCard
              label="Spatial Mean"
              value={`${spatialMean.toFixed(2)} ${units}`}
              subtitle="average across active monitors"
            />
            {peakMonitor && (
              <StatCard
                label="Regional Peak"
                value={`${peakMonitor.primaryVal.toFixed(2)} ${units}`}
                subtitle={`${peakMonitor.displayName}${peakMonitor.peak?.first_max_hour != null ? ` · hr ${peakMonitor.peak.first_max_hour}:00` : ''}`}
              />
            )}
            {lowestMonitor && (
              <StatCard
                label="Lowest Reading"
                value={`${lowestMonitor.primaryVal.toFixed(2)} ${units}`}
                subtitle={lowestMonitor.displayName}
              />
            )}
            <StatCard
              label="Active Monitors"
              value={monitors.length.toLocaleString()}
              subtitle="reporting valid coordinates"
            />
          </div>

          {/* Interactive Monitor Stations List */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            padding: '12px 14px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px' }}>
              Monitor stations — select to inspect
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {monitors.map(m => {
                const isSelected = selectedSiteId === m.site_id
                const color = getAQIColor(m.primaryVal, minVal, maxVal)
                return (
                  <button
                    key={m.site_id}
                    type="button"
                    onClick={() => handleSelectMonitor(m)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '11.5px',
                      fontWeight: isSelected ? 700 : 500,
                      color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      background: isSelected ? 'var(--bg-card)' : 'var(--bg-primary)',
                      border: `1px solid ${isSelected ? 'var(--teal)' : 'var(--border)'}`,
                      borderRadius: '6px',
                      padding: '5px 10px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }} />
                    <span>{m.displayName}</span>
                    {m.primaryVal != null && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10.5px', opacity: 0.85 }}>
                        {m.primaryVal.toFixed(1)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

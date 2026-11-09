import { useRef, useState } from 'react'
import ConnectorsPanel from './ConnectorsPanel'
import AccountMenu from './AccountMenu.jsx'
import { apiFetch } from '../utils/apiFetch.js'
import { API_BASE } from '../config.js'
import {
  isChartComparable,
  slotIndexOf,
  isSelectionFull,
  compareBadgeLabel,
} from '../utils/compareMode.js'

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function filenameFromDisposition(disposition, fallback) {
  const match = /filename="?([^";]+)"?/i.exec(disposition || '')
  return match?.[1]?.trim() || fallback
}

async function downloadArtifact(artifact) {
  const url = artifact.type === 'table'
    ? `${API_BASE}/artifacts/${artifact.id}/csv`
    : `${API_BASE}/chart/${artifact.id}/export.csv`
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  downloadBlob(filenameFromDisposition(res.headers.get('content-disposition'), `${artifact.title || artifact.id}.csv`), blob)
}

const TYPE_TAG = { table: 'CSV', map: 'MAP', comparison: 'CMP', timeseries: 'TS', heatmap: 'MAP' }

function SidebarSeparator() {
  return (
    <div
      style={{
        width: '32px',
        height: '1px',
        background: 'var(--border)',
        margin: '8px auto',
        flexShrink: 0,
      }}
    />
  )
}

function FileRow({
  artifact,
  tag,
  title,
  subtitle,
  focusedOutput,
  onFocusOutput,
  compareMode,
  compareSelection,
  onToggleCompareSlot,
  onDownload,
}) {
  const [state, setState] = useState('')
  const targetItem = artifact?.chart || artifact
  const isChart = Boolean(artifact?.chart)

  const comparing = compareMode === 'active'
  const comparable = comparing && targetItem ? isChartComparable(targetItem, compareSelection) : true
  const inSlot = comparing && targetItem ? slotIndexOf(compareSelection, targetItem) !== -1 : false
  const slotBadge = comparing && targetItem ? compareBadgeLabel(compareSelection, targetItem) : null
  const isFocused = !comparing && (
    (isChart && focusedOutput?.kind === 'chart' && (
      focusedOutput.data === targetItem ||
      (focusedOutput.data?.id && focusedOutput.data.id === artifact?.id) ||
      (focusedOutput.data?.chart_id && focusedOutput.data.chart_id === artifact?.id)
    )) ||
    (!isChart && focusedOutput?.kind === 'artifact' && (
      focusedOutput.data === targetItem ||
      (focusedOutput.data?.id && focusedOutput.data.id === artifact?.id)
    ))
  )

  const handleRowClick = () => {
    if (!targetItem) return
    if (comparing) {
      if (!comparable) return
      if (!inSlot && isSelectionFull(compareSelection)) return
      onToggleCompareSlot?.(targetItem)
      return
    }
    if (isChart) {
      onFocusOutput?.({ kind: 'chart', data: targetItem })
    } else {
      onFocusOutput?.({ kind: 'artifact', data: targetItem })
    }
  }

  const handleDownload = async (e) => {
    e.stopPropagation()
    setState('downloading')
    try {
      await onDownload()
      setState('')
    } catch (err) {
      setState(err.message || 'Failed')
      window.setTimeout(() => setState(''), 2000)
    }
  }

  return (
    <div
      onClick={handleRowClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '9px',
        padding: '9px 10px', borderRadius: '8px',
        background: isFocused || inSlot ? 'var(--teal-light)' : 'var(--bg-card)',
        border: `1px solid ${isFocused || inSlot ? 'var(--teal)' : 'var(--border)'}`,
        cursor: comparing && !comparable ? 'not-allowed' : 'pointer',
        opacity: comparing && !comparable ? 0.45 : 1,
        transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
      }}
    >
      <div style={{
        width: '26px', height: '26px', borderRadius: '6px', flexShrink: 0,
        background: 'var(--teal-light)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '8.5px', fontWeight: 800, letterSpacing: '0.02em', color: 'var(--teal-text)',
      }}>
        {tag}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '12px', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ fontSize: '10.5px', color: state && state !== 'downloading' ? 'var(--error)' : 'var(--text-muted)', marginTop: '1px' }}>
          {state === 'downloading' ? 'Downloading…' : (slotBadge || state || subtitle)}
        </div>
      </div>
      <svg
        onClick={handleDownload}
        title="Download CSV"
        width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
        style={{ color: 'var(--text-muted)', cursor: 'pointer', flexShrink: 0 }}
      >
        <path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 19h14" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function CollapsedFileItem({
  artifact,
  focusedOutput,
  onFocusOutput,
  compareMode,
  compareSelection,
  onToggleCompareSlot,
  onDownload,
  isHovered,
  onHover,
  onLeave,
}) {
  const [downloadState, setDownloadState] = useState('')
  const [coords, setCoords] = useState({ top: 0 })
  const itemRef = useRef(null)

  const tag = TYPE_TAG[artifact.type] || 'OUT'
  const title = artifact.title || 'Untitled output'
  const subtitle = artifact.type || 'Output'

  const targetItem = artifact?.chart || artifact
  const isChart = Boolean(artifact?.chart)

  const comparing = compareMode === 'active'
  const comparable = comparing && targetItem ? isChartComparable(targetItem, compareSelection) : true
  const inSlot = comparing && targetItem ? slotIndexOf(compareSelection, targetItem) !== -1 : false
  const slotBadge = comparing && targetItem ? compareBadgeLabel(compareSelection, targetItem) : null
  const isFocused = !comparing && (
    (isChart && focusedOutput?.kind === 'chart' && (
      focusedOutput.data === targetItem ||
      (focusedOutput.data?.id && focusedOutput.data.id === artifact.id) ||
      (focusedOutput.data?.chart_id && focusedOutput.data.chart_id === artifact.id)
    )) ||
    (!isChart && focusedOutput?.kind === 'artifact' && (
      focusedOutput.data === targetItem ||
      (focusedOutput.data?.id && focusedOutput.data.id === artifact.id)
    ))
  )

  const handleMouseEnter = () => {
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect()
      setCoords({ top: rect.top + rect.height / 2 })
    }
    onHover?.()
  }

  const handleMouseLeave = () => {
    onLeave?.()
  }

  const handleClick = (e) => {
    e?.stopPropagation?.()
    if (comparing) {
      if (!comparable) return
      if (!inSlot && isSelectionFull(compareSelection)) return
      onToggleCompareSlot?.(targetItem)
      return
    }
    if (isChart) {
      onFocusOutput?.({ kind: 'chart', data: targetItem })
    } else {
      onFocusOutput?.({ kind: 'artifact', data: targetItem })
    }
  }

  const handleDownloadClick = async (e) => {
    e.stopPropagation()
    if (downloadState === 'downloading') return
    setDownloadState('downloading')
    try {
      await onDownload()
      setDownloadState('')
    } catch (err) {
      setDownloadState(err.message || 'Failed')
      window.setTimeout(() => setDownloadState(''), 2000)
    }
  }

  return (
    <>
      <button
        ref={itemRef}
        type="button"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={title}
        aria-label={`Open ${title}`}
        style={{
          width: '34px',
          height: '34px',
          borderRadius: '8px',
          position: 'relative',
          background: isFocused || inSlot ? 'var(--teal-light)' : 'var(--teal-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: comparing && !comparable ? 'not-allowed' : 'pointer',
          opacity: comparing && !comparable ? 0.45 : 1,
          overflow: 'hidden',
          border: `1.5px solid ${isFocused || inSlot ? 'var(--teal)' : 'var(--border)'}`,
          padding: 0,
          flexShrink: 0,
          transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
          boxShadow: isHovered ? 'var(--shadow-sm)' : 'none',
        }}
      >
        <span style={{
          fontSize: '9px',
          fontWeight: 800,
          letterSpacing: '0.02em',
          color: 'var(--teal-text)',
          userSelect: 'none',
        }}>
          {tag}
        </span>

        {inSlot && (
          <div
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: 'var(--teal)',
            }}
          />
        )}
      </button>

      {/* Floating card to the side (styled like profile card) */}
      {isHovered && (
        <div
          role="tooltip"
          onMouseEnter={onHover}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{
            position: 'fixed',
            left: '68px',
            top: `${coords.top}px`,
            transform: 'translateY(-50%)',
            zIndex: 1000,
            background: 'var(--bg-card)',
            border: `1px solid ${isFocused || inSlot ? 'var(--teal)' : 'var(--border)'}`,
            borderRadius: '10px',
            boxShadow: 'var(--shadow-md)',
            padding: '10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            maxWidth: '260px',
            minWidth: '180px',
            pointerEvents: 'auto',
            cursor: comparing && !comparable ? 'not-allowed' : 'pointer',
            opacity: comparing && !comparable ? 0.6 : 1,
            whiteSpace: 'normal',
          }}
        >
          {/* Transparent bridge spanning the gap between sidebar button and floating card */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '-22px',
              width: '22px',
              background: 'transparent',
            }}
          />

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            <span style={{
              fontSize: '8.5px',
              fontWeight: 800,
              padding: '2px 5px',
              borderRadius: '4px',
              background: 'var(--teal-light)',
              color: 'var(--teal-text)',
              letterSpacing: '0.02em',
              flexShrink: 0,
            }}>
              {tag}
            </span>
            <span style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {title}
            </span>
          </div>

          <div style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
          }}>
            {subtitle}
          </div>

          {comparing ? (
            <div style={{ marginTop: '2px' }}>
              {inSlot ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{
                    display: 'inline-block',
                    fontSize: '10.5px',
                    fontWeight: 700,
                    color: 'var(--teal-text)',
                    background: 'var(--teal-light)',
                    border: '1px solid var(--teal)',
                    borderRadius: '5px',
                    padding: '2px 7px',
                    width: 'fit-content',
                  }}>
                    {slotBadge}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    Click to remove from comparison
                  </div>
                </div>
              ) : comparable ? (
                <div style={{ fontSize: '10.5px', color: 'var(--teal-text)', fontWeight: 600 }}>
                  Click to add to comparison
                </div>
              ) : (
                <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                  Cannot compare with current selection
                </div>
              )}
            </div>
          ) : (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              marginTop: '4px',
              paddingTop: '4px',
              borderTop: '1px solid var(--border)',
            }}>
              <span style={{
                fontSize: '11px',
                color: isFocused ? 'var(--teal-text)' : 'var(--text-secondary)',
                fontWeight: 600,
              }}>
                {isFocused ? 'Currently open' : 'Click to open'}
              </span>

              <button
                type="button"
                onClick={handleDownloadClick}
                title="Download CSV"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 4px',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '10.5px',
                  borderRadius: '4px',
                  lineHeight: 1,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
              >
                {downloadState === 'downloading' ? (
                  <span>Downloading…</span>
                ) : (
                  <>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 4v12m0 0l-4.5-4.5M12 16l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5 19h14" strokeLinecap="round" />
                    </svg>
                    <span>{downloadState || 'Download'}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function CollapsedSessionItem({
  isActive,
  title,
  status,
  onSwitch,
  isHovered,
  onHover,
  onLeave,
}) {
  const [coords, setCoords] = useState({ top: 0 })
  const itemRef = useRef(null)

  const handleMouseEnter = () => {
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect()
      setCoords({ top: rect.top + rect.height / 2 })
    }
    onHover?.()
  }

  const handleMouseLeave = () => {
    onLeave?.()
  }

  return (
    <>
      <button
        ref={itemRef}
        type="button"
        onClick={onSwitch}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={title}
        aria-label={title}
        style={{
          width: '34px',
          height: '34px',
          borderRadius: '8px',
          border: 'none',
          background: isActive ? 'var(--teal-light)' : isHovered ? 'var(--bg-secondary)' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
          transition: 'background 0.15s',
          position: 'relative',
        }}
      >
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: isActive ? 'var(--teal)' : 'var(--border-hover)',
            flexShrink: 0,
          }}
        />
        {!isActive && status && (
          <span style={{ position: 'absolute', top: '4px', right: '4px' }}>
            <TurnStatusDot status={status} />
          </span>
        )}
      </button>

      {isHovered && (
        <div
          role="tooltip"
          onMouseEnter={onHover}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'fixed',
            left: '68px',
            top: `${coords.top}px`,
            transform: 'translateY(-50%)',
            zIndex: 1000,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            boxShadow: 'var(--shadow-md)',
            padding: '8px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            maxWidth: '240px',
            minWidth: '140px',
            pointerEvents: 'auto',
          }}
        >
          {/* Bridge */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: '-22px',
              width: '22px',
              background: 'transparent',
            }}
          />
          <div style={{
            fontSize: '12px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {title}
          </div>
          <div style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
            {isActive ? 'Current analysis' : (STATUS_LABEL[status] || 'Click to open')}
          </div>
        </div>
      )}
    </>
  )
}

const STATUS_LABEL = { running: 'Still working', done: 'Finished', error: "Didn't finish" }

/** The badge on a "Recent analyses" row: a thread this browser sent a
 * message to, told apart from an ordinary row by what its turn is doing.
 *
 * Absent entirely once the user is looking at the thread it describes
 * (`SessionSidebar` only passes a status for rows that are not `threadId`):
 * the chat panel already shows that one's own progress, and a second
 * indicator saying the same thing would just be noise next to it.
 */
function TurnStatusDot({ status }) {
  if (!status) return null
  const color = status === 'running' ? 'var(--teal)' : status === 'done' ? 'var(--success)' : 'var(--error)'
  return (
    <span
      title={STATUS_LABEL[status]}
      aria-label={STATUS_LABEL[status]}
      style={{
        width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
        background: color,
        animation: status === 'running' ? 'tta-turn-pulse 1.1s ease-in-out infinite' : 'none',
      }}
    />
  )
}

export default function SessionSidebar({
  sessions,
  hasMoreSessions = false,
  onLoadMoreSessions,
  threadId,
  turnStatus = {},
  onSwitch,
  onNew,
  onDelete,
  onLogout,
  user,
  artifacts = [],
  collapsed = false,
  onCollapse,
  onExpand,
  focusedOutput,
  onFocusOutput,
  compareMode = 'off',
  compareSelection = [],
  onToggleCompareSlot,
}) {
  const [nav, setNav] = useState('chats')
  const [hoveredItemId, setHoveredItemId] = useState(null)
  const hoverLeaveTimerRef = useRef(null)

  const handleItemHover = (id) => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
      hoverLeaveTimerRef.current = null
    }
    setHoveredItemId(id)
  }

  const handleItemLeave = () => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current)
    }
    hoverLeaveTimerRef.current = setTimeout(() => {
      setHoveredItemId(null)
    }, 180)
  }

  const getSessionId = (session) => typeof session === 'string' ? session : session?.id
  const getSessionTitle = (session, index) => {
    if (session && typeof session === 'object' && session.title) return session.title
    return `Session ${index + 1}`
  }

  const handleDelete = (event, id) => {
    event.stopPropagation()
    if (!window.confirm('Delete this session?\n\nThis action cannot be undone.')) return
    onDelete(id)
  }

  return (
    <div
      className="session-sidebar"
      style={{
        width:         collapsed ? '60px' : '232px',
        flexShrink:    0,
        background:    'var(--bg-card)',
        borderRight:   '1px solid var(--border)',
        display:       'flex',
        flexDirection: 'column',
        overflow:      'hidden',
        position:      'relative',
        boxSizing:     'border-box',
        height:        '100%',
        transition:    'width 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Collapsed sidebar view */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: '59px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          overflow: 'hidden',
          padding: '14px 0',
          boxSizing: 'border-box',
          opacity: collapsed ? 1 : 0,
          pointerEvents: collapsed ? 'auto' : 'none',
          transition: 'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Section 1: Expand and New chat */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', width: '100%' }}>
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              style={{
                width: '36px',
                height: '24px',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                color: 'var(--text-muted)',
                transition: 'color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onNew}
            title="New chat"
            aria-label="New chat"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '9px',
              background: 'var(--teal)',
              color: 'white',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              padding: 0,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ display: 'block' }}
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* Separator between Section 1 and Section 2 */}
        <SidebarSeparator />

        {/* Section 2: Navigation icons (Chats, Files, Connectors) - clicking does NOT auto-expand */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', width: '100%' }}>
          <button
            type="button"
            onClick={() => setNav('chats')}
            title="Chats"
            aria-label="Chats"
            style={{
              width: '36px', height: '36px', borderRadius: '8px', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: nav === 'chats' ? 'var(--bg-secondary)' : 'transparent',
              color: nav === 'chats' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (nav !== 'chats') e.currentTarget.style.background = 'var(--bg-secondary)' }}
            onMouseLeave={e => { if (nav !== 'chats') e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M4 5.5h16v10.5H9.5L5 20v-4H4z" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setNav('files')}
            title="Files"
            aria-label="Files"
            style={{
              width: '36px', height: '36px', borderRadius: '8px', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: nav === 'files' ? 'var(--bg-secondary)' : 'transparent',
              color: nav === 'files' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (nav !== 'files') e.currentTarget.style.background = 'var(--bg-secondary)' }}
            onMouseLeave={e => { if (nav !== 'files') e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M4 6.5h6l1.6 2H20V18H4z" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setNav('connectors')}
            title="Connectors"
            aria-label="Connectors"
            style={{
              width: '36px', height: '36px', borderRadius: '8px', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: nav === 'connectors' ? 'var(--bg-secondary)' : 'transparent',
              color: nav === 'connectors' ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer', transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={e => { if (nav !== 'connectors') e.currentTarget.style.background = 'var(--bg-secondary)' }}
            onMouseLeave={e => { if (nav !== 'connectors') e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" />
              <path d="M6 12H3m18 0h-3M12 6V3m0 18v-3" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Separator between Section 2 and Section 3 */}
        <SidebarSeparator />

        {/* Section 3: Active section content */}
        <div style={{
          flex: 1,
          width: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
        }}>
          {nav === 'files' && (
            <>
              {artifacts.length === 0 ? (
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0', userSelect: 'none' }}>
                  No files
                </div>
              ) : (
                artifacts.map((artifact, i) => {
                  const id = artifact.id || `file-${i}`
                  return (
                    <CollapsedFileItem
                      key={id}
                      artifact={artifact}
                      focusedOutput={focusedOutput}
                      onFocusOutput={onFocusOutput}
                      compareMode={compareMode}
                      compareSelection={compareSelection}
                      onToggleCompareSlot={onToggleCompareSlot}
                      onDownload={() => downloadArtifact(artifact)}
                      isHovered={hoveredItemId === id}
                      onHover={() => handleItemHover(id)}
                      onLeave={handleItemLeave}
                    />
                  )
                })
              )}
            </>
          )}

          {nav === 'chats' && (
            <>
              {sessions.map((session, i) => {
                const id = getSessionId(session)
                const isActive = id === threadId
                const title = getSessionTitle(session, i)
                const hoverId = `session-${id}`
                return (
                  <CollapsedSessionItem
                    key={id}
                    isActive={isActive}
                    title={title}
                    status={turnStatus[id]}
                    onSwitch={() => onSwitch(id)}
                    isHovered={hoveredItemId === hoverId}
                    onHover={() => handleItemHover(hoverId)}
                    onLeave={handleItemLeave}
                  />
                )
              })}
            </>
          )}

          {nav === 'connectors' && (
            <div
              title="Connected services"
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" />
                <path d="M6 12H3m18 0h-3M12 6V3m0 18v-3" strokeLinecap="round" />
              </svg>
            </div>
          )}
        </div>

        {/* Separator between Section 3 and Section 4 */}
        <SidebarSeparator />

        {/* Section 4: Profile avatar */}
        <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
          <AccountMenu
            user={user}
            onLogout={onLogout}
            onManageConnectors={() => setNav('connectors')}
            collapsed={true}
          />
        </div>
      </div>

      {/* Expanded sidebar view */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: '232px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '16px 14px',
          boxSizing: 'border-box',
          opacity: collapsed ? 0 : 1,
          pointerEvents: collapsed ? 'none' : 'auto',
          transition: 'opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <div
            onClick={onNew}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
              padding: '9px 12px', borderRadius: '9px', background: 'var(--teal)', color: 'white',
              fontWeight: 700, fontSize: '13px', cursor: 'pointer', flex: 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span> New chat
            </div>
          </div>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Minimize sidebar"
              aria-label="Minimize sidebar"
              style={{
                background: 'transparent', border: 'none', padding: '4px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                color: 'var(--text-muted)', borderRadius: '4px',
                transition: 'color 0.15s, background 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-secondary)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 6 9 12 15 18" />
              </svg>
            </button>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginBottom: '16px' }}>
          <div
            onClick={() => setNav('chats')}
            style={{
              display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px', borderRadius: '7px',
              fontSize: '13px', fontWeight: nav === 'chats' ? 700 : 600,
              color: nav === 'chats' ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: nav === 'chats' ? 'var(--bg-secondary)' : 'transparent', cursor: 'pointer',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ flexShrink: 0 }}>
              <path d="M4 5.5h16v10.5H9.5L5 20v-4H4z" strokeLinejoin="round" />
            </svg>
            Chats
          </div>
          <div
            onClick={() => setNav('files')}
            style={{
              display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px', borderRadius: '7px',
              fontSize: '13px', fontWeight: nav === 'files' ? 700 : 600,
              color: nav === 'files' ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: nav === 'files' ? 'var(--bg-secondary)' : 'transparent', cursor: 'pointer',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ flexShrink: 0 }}>
              <path d="M4 6.5h6l1.6 2H20V18H4z" strokeLinejoin="round" />
            </svg>
            Files
          </div>
          <div
            onClick={() => setNav('connectors')}
            style={{
              display: 'flex', alignItems: 'center', gap: '9px', padding: '8px 10px', borderRadius: '7px',
              fontSize: '13px', fontWeight: nav === 'connectors' ? 700 : 600,
              color: nav === 'connectors' ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: nav === 'connectors' ? 'var(--bg-secondary)' : 'transparent', cursor: 'pointer',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" style={{ flexShrink: 0 }}>
              <path d="M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" />
              <path d="M6 12H3m18 0h-3M12 6V3m0 18v-3" strokeLinecap="round" />
            </svg>
            Connectors
          </div>
        </div>

        {nav === 'chats' && (
          <>
            <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 10px 8px' }}>
              Recent analyses
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {sessions.length === 0 && (
                <div style={{ padding: '12px 10px', color: 'var(--text-hint, var(--text-muted))', fontSize: '12px', fontStyle: 'italic' }}>
                  No sessions yet
                </div>
              )}
              {sessions.map((session, i) => {
                const id = getSessionId(session)
                const isActive = id === threadId
                const title = getSessionTitle(session, i)
                return (
                  <div
                    key={id}
                    className="session-row"
                    onClick={() => onSwitch(id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                      padding: '9px 10px', borderRadius: '8px', cursor: 'pointer',
                      background: isActive ? 'var(--teal-light)' : 'transparent',
                      borderLeft: `2px solid ${isActive ? 'var(--teal)' : 'transparent'}`,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-secondary)' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                        background: isActive ? 'var(--teal)' : 'var(--border-hover)',
                      }} />
                      <span style={{
                        fontSize: '12.5px', fontWeight: isActive ? 700 : 500,
                        color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {title}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                      {!isActive && <TurnStatusDot status={turnStatus[id]} />}
                      <button
                        onClick={e => handleDelete(e, id)}
                        className="session-delete-btn"
                        title="Delete session"
                        style={{
                          background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                          fontSize: '13px', padding: '2px 4px', borderRadius: '4px', flexShrink: 0, lineHeight: 1,
                          opacity: 0, transition: 'opacity 0.15s, color 0.15s',
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )
              })}
              {hasMoreSessions && (
                <button
                  type="button"
                  onClick={onLoadMoreSessions}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left',
                    padding: '9px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                    color: 'var(--text-muted)',
                  }}
                >
                  Load older analyses
                </button>
              )}
            </div>
          </>
        )}

        {nav === 'files' && (
          <>
            <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 10px 8px' }}>
              Exported files
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {artifacts.length === 0 && (
                <div style={{ padding: '12px 10px', color: 'var(--text-muted)', fontSize: '12px', fontStyle: 'italic' }}>
                  No outputs yet
                </div>
              )}
              {artifacts.map((artifact, i) => (
                <FileRow
                  key={artifact.id || i}
                  artifact={artifact}
                  tag={TYPE_TAG[artifact.type] || 'OUT'}
                  title={artifact.title || 'Untitled output'}
                  subtitle={artifact.type}
                  focusedOutput={focusedOutput}
                  onFocusOutput={onFocusOutput}
                  compareMode={compareMode}
                  compareSelection={compareSelection}
                  onToggleCompareSlot={onToggleCompareSlot}
                  onDownload={() => downloadArtifact(artifact)}
                />
              ))}
            </div>
          </>
        )}

        {nav === 'connectors' && (
          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 10px 8px' }}>
              Connected services
            </div>
            <ConnectorsPanel />
          </div>
        )}

        <div style={{ marginTop: 'auto' }}>
          <AccountMenu
            user={user}
            onLogout={onLogout}
            onManageConnectors={() => setNav('connectors')}
            collapsed={false}
          />
        </div>
      </div>

      <style>{`
        .session-row:hover .session-delete-btn,
        .session-delete-btn:focus { opacity: 1 !important; }
        @keyframes tta-turn-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }
        @keyframes tta-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

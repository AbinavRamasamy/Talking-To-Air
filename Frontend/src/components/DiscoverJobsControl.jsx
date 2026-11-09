export default function DiscoverJobsControl({ tab, onSelectTab, hasRunningJobs, style: customStyle = {} }) {
  const isMinimized = tab === null

  return (
    <div style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      borderRadius: '9px',
      padding: '3px',
      boxSizing: 'border-box',
      ...customStyle,
    }}>
      {isMinimized ? (
        <>
          <button
            type="button"
            onClick={() => onSelectTab('discover')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 700,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: '6px',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-card)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
          >
            Discover
          </button>
          <span style={{ color: 'var(--text-hint)', fontSize: '12px', userSelect: 'none', flexShrink: 0, margin: '0 1px' }}>|</span>
          <button
            type="button"
            onClick={() => onSelectTab('jobs')}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'transparent',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 700,
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '6px 8px',
              borderRadius: '6px',
              gap: '5px',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-card)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
          >
            Jobs
            {hasRunningJobs && (
              <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--warning)' }} />
            )}
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('discover')}
            title="Expand jobs and discover"
            aria-label="Expand jobs and discover"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '4px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              borderRadius: '6px',
              flexShrink: 0,
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </>
      ) : (
        <>
          <div
            role="tablist"
            style={{
              flex: 1,
              position: 'relative',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              height: '100%',
              alignItems: 'center',
            }}
          >
            {/* Sliding pill indicator */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 0,
                width: '50%',
                background: 'var(--bg-card)',
                borderRadius: '7px',
                boxShadow: 'var(--shadow-sm)',
                transform: tab === 'jobs' ? 'translateX(100%)' : 'translateX(0%)',
                transition: 'transform 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
                pointerEvents: 'none',
                zIndex: 1,
              }}
            />

            <button
              type="button"
              role="tab"
              aria-selected={tab === 'discover'}
              onClick={() => onSelectTab(tab === 'discover' ? null : 'discover')}
              style={{
                position: 'relative',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                fontSize: '12.5px',
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: '7px',
                cursor: 'pointer',
                color: tab === 'discover' ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'color 0.18s ease',
              }}
            >
              Discover
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={tab === 'jobs'}
              onClick={() => onSelectTab(tab === 'jobs' ? null : 'jobs')}
              style={{
                position: 'relative',
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'transparent',
                fontSize: '12.5px',
                fontWeight: 700,
                padding: '6px 12px',
                borderRadius: '7px',
                cursor: 'pointer',
                color: tab === 'jobs' ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'color 0.18s ease',
                gap: '5px',
              }}
            >
              Jobs
              {hasRunningJobs && (
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--warning)' }} />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => onSelectTab(null)}
            title="Collapse jobs and discover"
            aria-label="Collapse jobs and discover"
            style={{
              background: 'transparent',
              border: 'none',
              padding: '4px 6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
              borderRadius: '6px',
              flexShrink: 0,
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'var(--bg-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
        </>
      )}
    </div>
  )
}

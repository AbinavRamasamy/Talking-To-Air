// T19: pure state machine driving the chat's workflow strip. Takes the same
// SSE vocabulary useChat.js already switches on (status/job_progress/text/
// error/done) — no new event names — and folds each event into the small
// bit of state the strip renders: current stage, its human label, an
// optional detail (granule count / percent), whether the strip is active,
// and the stage a failure happened at (frozen once set, until the next
// turn's 'done'/new message resets it).

export const INITIAL_WORKFLOW_STATE = {
  stage: null,
  label: '',
  detail: null,
  failedStage: null,
  active: false,
}

export function cleanStatusMessage(msg) {
  if (!msg || typeof msg !== 'string') return ''
  return msg
    .replace(/\s*[([]?\s*[-—–]?\s*\d+\s*(?:seconds?|secs?|s)\s*elapsed\s*[)\]]?(?:\.\.\.)?\s*/gi, '')
    .trim()
}

export function applyWorkflowEvent(state, event, data) {
  switch (event) {
    case 'status': {
      const message = cleanStatusMessage(data?.message ?? state.label)
      const stage = data?.stage ?? state.stage
      const isNewStage = data?.stage != null && data.stage !== state.stage
      const rawDetail = data && 'detail' in data ? data.detail : null
      const detail = stage === 'working'
        ? null
        : (rawDetail != null ? rawDetail : (isNewStage ? null : state.detail))
      return { ...state, stage, label: message, detail, active: true }
    }
    case 'job_progress': {
      if (data && typeof data.progress === 'number') {
        return { ...state, detail: data.progress, active: true }
      }
      return state
    }
    case 'text':
      // Collapses cleanly the moment the first answer token arrives — the
      // last stage/label are preserved (not cleared) so a strip that
      // re-expands later (e.g. a second tool call) has context, but
      // `active: false` is what the strip actually reads to hide itself.
      return { ...state, active: false }
    case 'error':
      return { ...state, failedStage: state.stage, active: false }
    case 'done':
      return { ...INITIAL_WORKFLOW_STATE }
    default:
      return state
  }
}

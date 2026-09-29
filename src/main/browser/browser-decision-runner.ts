import { BrowserError } from './browser-error'

export type BrowserDecisionObservation = {
  workspaceId: string
  browserPageId: string
  origin: string
  generation: string
  candidateIds: readonly string[]
  outcomeObserved: boolean
}

export type BrowserDecisionPorts = {
  observe: (signal: AbortSignal) => Promise<BrowserDecisionObservation>
  choose: (observation: BrowserDecisionObservation, signal: AbortSignal) => Promise<unknown>
  // The adapter must revalidate identity inside the owning page's action queue, without ref recovery.
  actIfCurrent: (
    observation: BrowserDecisionObservation,
    candidateId: string,
    signal: AbortSignal
  ) => Promise<'applied' | 'stale_target' | 'uncertain'>
}

export type BrowserDecisionResult = {
  status: 'completed' | 'abstained' | 'stale_target' | 'uncertain' | 'cancelled' | 'budget-exceeded'
  actions: number
  decisions: number
}

type BrowserDecisionRequest = {
  workspaceId: string
  browserPageId: string
  allowedOrigins: readonly string[]
  signal: AbortSignal
  maxActions?: number
  maxDecisions?: number
  timeoutMs?: number
}

function boundedLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new BrowserError('browser_decision_invalid_budget', `Budget must be within 1–${maximum}.`)
  }
  return value
}

function readCandidate(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('candidateId' in value)) {
    throw new BrowserError('browser_decision_invalid_choice', 'Decision has no candidate ID.')
  }
  if (value.candidateId === null || typeof value.candidateId === 'string') {
    return value.candidateId
  }
  throw new BrowserError('browser_decision_invalid_choice', 'Decision candidate ID is invalid.')
}

/** Internal runner; providers and the checked CDP adapter must be validated before public exposure. */
export async function runBrowserDecision(
  request: BrowserDecisionRequest,
  ports: BrowserDecisionPorts
): Promise<BrowserDecisionResult> {
  const maxActions = boundedLimit(request.maxActions ?? 8, 20)
  const maxDecisions = boundedLimit(request.maxDecisions ?? 12, 24)
  const timeoutMs = boundedLimit(request.timeoutMs ?? 60_000, 120_000)
  const controller = new AbortController()
  const cancel = () => controller.abort()
  request.signal.addEventListener('abort', cancel, { once: true })
  if (request.signal.aborted) {
    cancel()
  }
  const timer = setTimeout(cancel, timeoutMs)
  let actions = 0
  let decisions = 0
  const result = (status: BrowserDecisionResult['status']): BrowserDecisionResult => ({
    status,
    actions,
    decisions
  })
  const abortReason = new Error('Browser decision stopped')

  async function step<T>(run: () => Promise<T>): Promise<T> {
    if (controller.signal.aborted) {
      throw abortReason
    }
    let rejectAbort: () => void = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(abortReason)
    })
    controller.signal.addEventListener('abort', rejectAbort, { once: true })
    try {
      const value = await Promise.race([run(), aborted])
      if (controller.signal.aborted) {
        throw abortReason
      }
      return value
    } finally {
      controller.signal.removeEventListener('abort', rejectAbort)
    }
  }

  try {
    for (;;) {
      const observed = await step(() => ports.observe(controller.signal))
      const observation = Object.freeze({
        ...observed,
        candidateIds: Object.freeze([...observed.candidateIds])
      })
      if (
        observation.workspaceId !== request.workspaceId ||
        observation.browserPageId !== request.browserPageId ||
        !request.allowedOrigins.includes(observation.origin)
      ) {
        throw new BrowserError(
          'browser_decision_scope_changed',
          'Observed page left the allowed scope.'
        )
      }
      if (observation.outcomeObserved) {
        return result('completed')
      }
      if (actions >= maxActions || decisions >= maxDecisions) {
        return result('budget-exceeded')
      }
      decisions++
      const candidateId = readCandidate(
        await step(() => ports.choose(observation, controller.signal))
      )
      if (candidateId === null) {
        return result('abstained')
      }
      if (observation.candidateIds.filter((id) => id === candidateId).length !== 1) {
        throw new BrowserError(
          'browser_decision_invalid_choice',
          'Decision must name one current candidate.'
        )
      }
      const outcome = await step(() => {
        actions++
        return ports.actIfCurrent(observation, candidateId, controller.signal)
      })
      if (outcome === 'stale_target') {
        actions--
        return result('stale_target')
      }
      if (outcome === 'uncertain') {
        return result('uncertain')
      }
    }
  } catch (error) {
    if (error === abortReason) {
      return result(request.signal.aborted ? 'cancelled' : 'budget-exceeded')
    }
    throw error
  } finally {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', cancel)
    controller.abort()
  }
}

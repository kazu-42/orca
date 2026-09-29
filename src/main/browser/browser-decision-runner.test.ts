import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runBrowserDecision,
  type BrowserDecisionObservation,
  type BrowserDecisionPorts
} from './browser-decision-runner'

function fixture() {
  const controller = new AbortController()
  const observation: BrowserDecisionObservation = {
    workspaceId: 'folder:development',
    browserPageId: 'page-1',
    origin: 'https://development.test',
    generation: 'document-1:snapshot-1',
    candidateIds: ['record-a-open', 'record-b-open'],
    outcomeObserved: false
  }
  const request = {
    workspaceId: observation.workspaceId,
    browserPageId: observation.browserPageId,
    allowedOrigins: [observation.origin],
    signal: controller.signal
  }
  const observe = vi.fn(async () => ({ ...observation }))
  const choose = vi.fn<BrowserDecisionPorts['choose']>(async () => ({
    candidateId: 'record-a-open'
  }))
  const actIfCurrent = vi.fn<BrowserDecisionPorts['actIfCurrent']>(async () => 'applied')
  return { controller, observation, request, ports: { observe, choose, actIfCurrent } }
}

afterEach(() => vi.useRealTimers())

describe('bounded browser decision runner', () => {
  it('completes only after observing the expected outcome, including after the final allowed action', async () => {
    const f = fixture()
    f.ports.observe
      .mockResolvedValueOnce(f.observation)
      .mockResolvedValue({ ...f.observation, outcomeObserved: true })
    expect(await runBrowserDecision({ ...f.request, maxActions: 1 }, f.ports)).toEqual({
      status: 'completed',
      actions: 1,
      decisions: 1
    })
    expect(f.ports.observe).toHaveBeenCalledTimes(2)
  })

  it('does not take an action for an already satisfied outcome', async () => {
    const f = fixture()
    f.observation.outcomeObserved = true
    expect((await runBrowserDecision(f.request, f.ports)).status).toBe('completed')
    expect(f.ports.choose).not.toHaveBeenCalled()
  })

  it('rejects model-only completion and an unknown or ambiguous candidate', async () => {
    for (const choice of [{ completed: true }, { candidateId: 'missing' }, { candidateId: 1 }]) {
      const f = fixture()
      f.ports.choose.mockResolvedValue(choice)
      await expect(runBrowserDecision(f.request, f.ports)).rejects.toMatchObject({
        code: 'browser_decision_invalid_choice'
      })
      expect(f.ports.actIfCurrent).not.toHaveBeenCalled()
    }
    const f = fixture()
    f.observation.candidateIds = ['record-a-open', 'record-a-open']
    await expect(runBrowserDecision(f.request, f.ports)).rejects.toMatchObject({
      code: 'browser_decision_invalid_choice'
    })
  })

  it('returns control on abstention', async () => {
    const f = fixture()
    f.ports.choose.mockResolvedValue({ candidateId: null })
    expect((await runBrowserDecision(f.request, f.ports)).status).toBe('abstained')
    expect(f.ports.actIfCurrent).not.toHaveBeenCalled()
  })

  it('does not retry or recover a stale target reported by the checked adapter', async () => {
    const f = fixture()
    f.ports.actIfCurrent.mockResolvedValue('stale_target')
    expect(await runBrowserDecision(f.request, f.ports)).toEqual({
      status: 'stale_target',
      actions: 0,
      decisions: 1
    })
    expect(f.ports.actIfCurrent).toHaveBeenCalledExactlyOnceWith(
      f.observation,
      'record-a-open',
      expect.any(AbortSignal)
    )
    expect(f.ports.choose).toHaveBeenCalledTimes(1)
  })

  it('never replays an action whose result is uncertain', async () => {
    const f = fixture()
    f.ports.actIfCurrent.mockResolvedValue('uncertain')
    expect(await runBrowserDecision(f.request, f.ports)).toEqual({
      status: 'uncertain',
      actions: 1,
      decisions: 1
    })
    expect(f.ports.actIfCurrent).toHaveBeenCalledTimes(1)
  })

  it.each(['workspaceId', 'browserPageId', 'origin'] as const)(
    'rejects a changed %s even if it reports success',
    async (field) => {
      const f = fixture()
      f.observation[field] = 'different'
      f.observation.outcomeObserved = true
      await expect(runBrowserDecision(f.request, f.ports)).rejects.toMatchObject({
        code: 'browser_decision_scope_changed'
      })
      expect(f.ports.actIfCurrent).not.toHaveBeenCalled()
    }
  )

  it.each([{ maxActions: 2 }, { maxDecisions: 2 }])(
    'stops a no-op page at its budget: %j',
    async (budget) => {
      const f = fixture()
      expect(await runBrowserDecision({ ...f.request, ...budget }, f.ports)).toEqual({
        status: 'budget-exceeded',
        actions: 2,
        decisions: 2
      })
    }
  )

  it('does not dispatch when the caller cancels during a decision', async () => {
    const f = fixture()
    f.ports.choose.mockImplementation(async () => {
      f.controller.abort()
      return { candidateId: 'record-a-open' }
    })
    expect((await runBrowserDecision(f.request, f.ports)).status).toBe('cancelled')
    expect(f.ports.actIfCurrent).not.toHaveBeenCalled()
  })

  it('does not observe when cancellation preceded the call', async () => {
    const f = fixture()
    f.controller.abort()
    expect((await runBrowserDecision(f.request, f.ports)).status).toBe('cancelled')
    expect(f.ports.observe).not.toHaveBeenCalled()
  })

  it('counts an in-flight action as possibly applied when cancellation arrives', async () => {
    const f = fixture()
    f.ports.actIfCurrent.mockImplementation(async () => {
      f.controller.abort()
      return 'applied'
    })
    expect(await runBrowserDecision(f.request, f.ports)).toEqual({
      status: 'cancelled',
      actions: 1,
      decisions: 1
    })
    expect(f.ports.actIfCurrent).toHaveBeenCalledTimes(1)
  })

  it('holds an immutable observation across the asynchronous decision', async () => {
    const f = fixture()
    f.ports.choose.mockImplementation(async (observed) => {
      expect(Object.isFrozen(observed)).toBe(true)
      expect(Object.isFrozen(observed.candidateIds)).toBe(true)
      f.observation.generation = 'replacement'
      return { candidateId: 'record-a-open' }
    })
    f.ports.actIfCurrent.mockResolvedValue('stale_target')
    await runBrowserDecision(f.request, f.ports)
    expect(f.ports.actIfCurrent.mock.calls[0][0].generation).toBe('document-1:snapshot-1')
  })

  it('bounds a provider that ignores cancellation and cannot dispatch its late answer', async () => {
    vi.useFakeTimers()
    const f = fixture()
    let resolveChoice: (value: unknown) => void = () => {}
    f.ports.choose.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChoice = resolve
        })
    )
    const run = runBrowserDecision({ ...f.request, timeoutMs: 100 }, f.ports)
    await vi.advanceTimersByTimeAsync(100)
    expect((await run).status).toBe('budget-exceeded')
    resolveChoice({ candidateId: 'record-a-open' })
    await Promise.resolve()
    expect(f.ports.actIfCurrent).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves infrastructure errors without a success or low-confidence fallback', async () => {
    const f = fixture()
    const failure = new Error('provider unavailable')
    f.ports.choose.mockRejectedValue(failure)
    await expect(runBrowserDecision(f.request, f.ports)).rejects.toBe(failure)
    expect(f.ports.actIfCurrent).not.toHaveBeenCalled()
  })

  it.each([0, -1, Number.NaN, Infinity, 1.5, 21])(
    'rejects invalid action budget %s before observation',
    async (maxActions) => {
      const f = fixture()
      await expect(runBrowserDecision({ ...f.request, maxActions }, f.ports)).rejects.toMatchObject(
        { code: 'browser_decision_invalid_budget' }
      )
      expect(f.ports.observe).not.toHaveBeenCalled()
    }
  )
})

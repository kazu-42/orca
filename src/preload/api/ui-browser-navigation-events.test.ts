import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipc = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn() }))
vi.mock('electron', () => ({ ipcRenderer: ipc }))
vi.mock('../preload-runtime-support', () => ({ browserFindSubscriptions: { subscribe: vi.fn() } }))
import { uiTabAndBrowserCommandsApi as api } from './ui-bridge-tab-and-browser-commands'

beforeEach(() => vi.clearAllMocks())

describe('browser navigation preload targets', () => {
  const cases = [
    { channel: 'ui:reloadBrowserPage', subscribe: api.onReloadBrowserPage, args: [] },
    { channel: 'ui:hardReloadBrowserPage', subscribe: api.onHardReloadBrowserPage, args: [] },
    {
      channel: 'ui:browserHistoryNavigate',
      subscribe: api.onBrowserHistoryNavigate,
      args: ['back']
    },
    {
      channel: 'ui:browserHistoryNavigate',
      subscribe: api.onBrowserHistoryNavigate,
      args: ['forward']
    }
  ]
  it.each(cases)(
    'preserves targets and legacy arguments for $channel $args',
    ({ channel, subscribe, args }) => {
      const callback = vi.fn()
      const unsubscribe = subscribe(callback)
      const [registeredChannel, listener] = ipc.on.mock.calls[0]!
      expect(registeredChannel).toBe(channel)
      const target = { browserPageId: 'page-a', browserWorkspaceId: 'workspace-a' }
      listener({}, ...args, target)
      expect(callback).toHaveBeenLastCalledWith(...args, target)
      listener({}, ...args, { browserPageId: 'page-a' })
      expect(callback).toHaveBeenLastCalledWith(...args, { browserPageId: 'page-a' })
      listener({}, ...args)
      expect(callback).toHaveBeenLastCalledWith(...args, undefined)
      unsubscribe()
      expect(ipc.removeListener).toHaveBeenCalledWith(channel, listener)
    }
  )
  it.each(cases)('drops malformed explicit targets for $channel $args', ({ subscribe, args }) => {
    const callback = vi.fn()
    subscribe(callback)
    const listener = ipc.on.mock.calls[0]![1]
    for (const target of [
      null,
      {},
      '',
      [],
      { browserPageId: '' },
      { browserPageId: 'page-a', browserWorkspaceId: 2 }
    ]) {
      listener({}, ...args, target)
    }
    expect(callback).not.toHaveBeenCalled()
  })
})

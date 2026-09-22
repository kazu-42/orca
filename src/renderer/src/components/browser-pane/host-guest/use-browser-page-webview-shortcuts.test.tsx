// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserFindTarget } from '../../../../../shared/browser-find-source'
import { installClientHostedPaneApi, paneChannel } from '../client-hosted-browser-pane-test-rig'
import { useBrowserPageWebviewShortcuts } from './use-browser-page-webview-shortcuts'

vi.mock('@/store', () => ({ useAppStore: () => ({}) }))

const history = paneChannel<{ direction: 'back' | 'forward'; target?: BrowserFindTarget }>()
const reload = paneChannel<BrowserFindTarget | undefined>()
const hardReload = paneChannel<BrowserFindTarget | undefined>()

beforeEach(() => {
  installClientHostedPaneApi({
    ui: {
      onBrowserHistoryNavigate: (
        callback: (direction: 'back' | 'forward', target?: BrowserFindTarget) => void
      ) => history.subscribe(({ direction, target }) => callback(direction, target)),
      onReloadBrowserPage: reload.subscribe,
      onHardReloadBrowserPage: hardReload.subscribe
    }
  })
})
afterEach(cleanup)

function mountPane(browserTabId: string, workspaceId = 'workspace-a', isActive = true) {
  const webview = Object.assign(document.createElement('webview'), {
    goBack: vi.fn(),
    goForward: vi.fn()
  })
  const reloadGuest = vi.fn()
  renderHook(() =>
    useBrowserPageWebviewShortcuts({
      browserTabId,
      workspaceId,
      isActive,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The hook only calls the mocked navigation methods in these tests.
      webviewRef: { current: webview as unknown as Electron.WebviewTag },
      isActiveRef: { current: isActive },
      paneZoomLevelRef: { current: 0 },
      setBrowserDefaultZoomLevel: vi.fn(),
      showBrowserZoomFeedback: vi.fn(),
      reloadWebviewOrRecoverGuest: reloadGuest
    })
  )
  return { back: webview.goBack, forward: webview.goForward, reloadGuest }
}

const actions = ['back', 'forward', 'reload', 'hardReload'] as const
function emit(action: (typeof actions)[number], target?: BrowserFindTarget) {
  if (action === 'back' || action === 'forward') {
    history.emit({ direction: action, target })
  } else if (action === 'reload') {
    reload.emit(target)
  } else {
    hardReload.emit(target)
  }
}
function expectCalls(
  pane: ReturnType<typeof mountPane>,
  action: (typeof actions)[number],
  count: number
) {
  expect(pane.back).toHaveBeenCalledTimes(action === 'back' ? count : 0)
  expect(pane.forward).toHaveBeenCalledTimes(action === 'forward' ? count : 0)
  expect(pane.reloadGuest).toHaveBeenCalledTimes(
    action === 'reload' || action === 'hardReload' ? count : 0
  )
  if (count && (action === 'reload' || action === 'hardReload')) {
    expect(pane.reloadGuest).toHaveBeenCalledWith(action === 'hardReload')
  }
}

describe('forwarded browser navigation in split panes', () => {
  it.each(actions)('%s reaches only the source page', (action) => {
    const first = mountPane('page-a')
    const second = mountPane('page-b')
    emit(action, { browserPageId: 'page-b', browserWorkspaceId: 'workspace-a' })
    expectCalls(first, action, 0)
    expectCalls(second, action, 1)
  })
  it.each(actions)('%s rejects the wrong workspace', (action) => {
    const pane = mountPane('page-a')
    emit(action, { browserPageId: 'page-a', browserWorkspaceId: 'workspace-b' })
    expectCalls(pane, action, 0)
  })
  it.each(actions)('%s accepts a page-only client-hosted target', (action) => {
    const first = mountPane('page-a')
    const second = mountPane('page-b')
    emit(action, { browserPageId: 'page-b' })
    expectCalls(first, action, 0)
    expectCalls(second, action, 1)
  })
  it.each(actions)('%s preserves legacy delivery to an active pane', (action) => {
    const pane = mountPane('page-a')
    const inactive = mountPane('page-b', 'workspace-a', false)
    emit(action)
    expectCalls(pane, action, 1)
    expectCalls(inactive, action, 0)
  })
  it.each(actions)('%s ignores an inactive target', (action) => {
    const active = mountPane('page-a')
    const inactive = mountPane('page-b', 'workspace-a', false)
    emit(action, { browserPageId: 'page-b' })
    expectCalls(active, action, 0)
    expectCalls(inactive, action, 0)
  })
  it('removes all navigation subscriptions on unmount', () => {
    mountPane('page-a')
    cleanup()
    expect(history.listenerCount()).toBe(0)
    expect(reload.listenerCount()).toBe(0)
    expect(hardReload.listenerCount()).toBe(0)
  })
})

describe.each(['Macintosh', 'Windows', 'Linux'])('browser chrome on %s', (platform) => {
  it.each(actions)('preserves the %s shortcut', (action) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform)
    const pane = mountPane('page-a')
    const isMac = platform === 'Macintosh'
    const isHistory = action === 'back' || action === 'forward'
    const key = isHistory
      ? action === 'back'
        ? isMac
          ? '['
          : 'ArrowLeft'
        : isMac
          ? ']'
          : 'ArrowRight'
      : 'r'
    const event = new KeyboardEvent('keydown', {
      key,
      metaKey: isMac,
      ctrlKey: !isMac && !isHistory,
      altKey: !isMac && isHistory,
      shiftKey: action === 'hardReload',
      cancelable: true
    })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expectCalls(pane, action, 1)
    vi.restoreAllMocks()
  })
})

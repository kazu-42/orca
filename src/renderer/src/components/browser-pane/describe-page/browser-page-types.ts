import type { BrowserGrabPayload } from '../../../../../shared/browser-grab-types'
import type { BrowserPage as BrowserPageState } from '../../../../../shared/browser-workspace-types'
import type { RuntimeBrowserClientPlacement } from '../../../../../shared/runtime-browser-placement'

export type BrowserTabPageState = Partial<
  Pick<
    BrowserPageState,
    'title' | 'loading' | 'faviconUrl' | 'canGoBack' | 'canGoForward' | 'loadError'
  >
>

export type BrowserPageUrlSetter = (
  tabId: string,
  url: string,
  options?: { preserveLoadError?: boolean }
) => void

export type BrowserChromeShortcutScope = 'focused' | 'inactive' | 'owned-target'

export type ClientHostedBrowserPagePaneProps = {
  browserTab: BrowserPageState
  workspaceId: string
  runtimeEnvironmentId: string
  worktreeId: string
  /** Null until the host mints the optimistic tab placement. */
  placement: RuntimeBrowserClientPlacement | null
  isActive: boolean
  chromeShortcutScope: BrowserChromeShortcutScope
  onUpdatePageState: (tabId: string, updates: BrowserTabPageState) => void
  onSetUrl: BrowserPageUrlSetter
}

export type GrabIntent = 'copy' | 'annotate'

export type BrowserPageContextMenuState = {
  x: number
  y: number
  linkUrl: string | null
  pageUrl: string
  selectionText: string
}

export type BrowserPageGrabToastState = {
  message: string
  type: 'success' | 'error'
  x: number
  y: number
  below: boolean
  payload: BrowserGrabPayload | null
}

export type BrowserPageRecoveryNavigationValidation = {
  committed: boolean
  started: boolean
  targetUrl: string
}

export type BrowserPageNavigateEvent = {
  url?: string
  isMainFrame?: boolean
}

export type BrowserPageFailLoadEvent = {
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
  isMainFrame?: boolean
}

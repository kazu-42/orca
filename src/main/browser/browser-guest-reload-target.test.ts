import { describe, expect, it, vi } from 'vitest'
import { forwardGuestShortcutInput } from './browser-guest-shortcut-dispatch'

describe.each([undefined, 'workspace-a'])('guest reload target workspace %s', (workspaceId) => {
  it.each([false, true])('targets the source page for hard reload = %s', (hardReload) => {
    const send = vi.fn()
    const preventDefault = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The dispatcher only calls preventDefault on this event.
    const event = { preventDefault } as Electron.Event
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Reload dispatch only uses the renderer send method.
    const renderer = { send, reloadIgnoringCache: vi.fn() } as unknown as Electron.WebContents
    const forwarded = forwardGuestShortcutInput(
      {
        browserTabId: 'page-a',
        resolveRenderer: () => renderer,
        resolveWorkspaceId: () => workspaceId ?? null,
        forwardBrowserPageZoom: vi.fn()
      },
      event,
      {
        type: 'keyDown',
        key: 'r',
        code: 'KeyR',
        shift: hardReload,
        meta: process.platform === 'darwin',
        control: process.platform !== 'darwin',
        alt: false
      }
    )
    expect(forwarded).toBe(true)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledExactlyOnceWith(
      hardReload ? 'ui:hardReloadBrowserPage' : 'ui:reloadBrowserPage',
      { browserPageId: 'page-a', browserWorkspaceId: workspaceId }
    )
  })
})

import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getResponsiveLayoutMetrics } from './responsive-layout-metrics'

const state = vi.hoisted(() => ({
  width: 390,
  height: 844,
  mounts: vi.fn(),
  unmounts: vi.fn(),
  saveWidth: vi.fn(async () => {})
}))

vi.mock('react-native', () => ({
  View: 'div',
  StyleSheet: { create: <T,>(styles: T) => styles },
  PanResponder: { create: () => ({ panHandlers: {} }) }
}))
vi.mock('./responsive-layout', () => ({
  useResponsiveLayout: () => getResponsiveLayoutMetrics(state.width, state.height)
}))
vi.mock('../storage/preferences', () => ({
  HOST_SIDEBAR_DEFAULT_WIDTH: 300,
  HOST_SIDEBAR_MIN_WIDTH: 200,
  HOST_SIDEBAR_MAX_WIDTH: 480,
  loadHostSidebarWidth: async () => 300,
  saveHostSidebarWidth: state.saveWidth
}))
vi.mock('../components/HostProtocolGate', () => ({
  HostProtocolGate: ({ children }: { children?: ReactNode }) => children
}))
vi.mock('../host-screen/HostScreen', () => ({
  HostScreen: ({ onHideSidebar }: { onHideSidebar?: () => void }) =>
    createElement('button', { onClick: onHideSidebar }, 'Hide sidebar')
}))
vi.mock('expo-router', async () => {
  const { createElement, useEffect, useState } = await import('react')
  function Stack() {
    const [draft, setDraft] = useState('')
    useEffect(() => {
      state.mounts()
      return () => {
        state.unmounts()
      }
    }, [])
    return createElement('input', { value: draft, onChangeText: setDraft })
  }
  Stack.Screen = () => null
  return {
    Stack,
    useGlobalSearchParams: () => ({ hostId: 'ssh-host' }),
    usePathname: () => '/h/ssh-host/session/folder-workspace'
  }
})

import HostGroupLayout from '../../app/h/_layout'

let renderer: ReactTestRenderer | undefined

beforeEach(() => {
  vi.clearAllMocks()
  state.width = 390
  state.height = 844
})

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

async function resize(width: number, height: number): Promise<void> {
  state.width = width
  state.height = height
  await act(async () => {
    const element = createElement(HostGroupLayout)
    if (renderer) {
      renderer.update(element)
    } else {
      renderer = create(element)
    }
  })
}

describe('host navigator continuity across available-window changes', () => {
  it('keeps navigator-owned state across compact, wide, split and rotated windows', async () => {
    await resize(390, 844)
    await act(async () => renderer?.root.findByType('input').props.onChangeText('送信前の下書き'))
    // Synthetic window sizes exercise layout boundaries, not claimed Duo hardware dimensions.
    for (const [width, height] of [
      [900, 800],
      [450, 800],
      [800, 900],
      [844, 390],
      [390, 844]
    ]) {
      await resize(width, height)
      expect(renderer?.root.findByType('input').props.value).toBe('送信前の下書き')
      expect(state.mounts).toHaveBeenCalledTimes(1)
      expect(state.unmounts).not.toHaveBeenCalled()
    }
    expect(state.saveWidth).not.toHaveBeenCalled()
  })

  it('preserves the navigator while collapsing the sidebar and crossing its threshold repeatedly', async () => {
    await resize(900, 800)
    await act(async () => {
      renderer?.root.findByType('input').props.onChangeText('pending input')
      renderer?.root.findByType('button').props.onClick()
    })
    for (const width of [699, 700, 699, 701, 450, 900]) {
      await resize(width, 800)
      expect(renderer?.root.findByType('input').props.value).toBe('pending input')
      expect(state.mounts).toHaveBeenCalledTimes(1)
      expect(state.unmounts).not.toHaveBeenCalled()
    }
    expect(state.saveWidth).not.toHaveBeenCalled()
  })
})

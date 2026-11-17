import { useEffect, useState, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'vlm-benchmark-theme'

function readStored(): Theme {
  if (typeof window === 'undefined') return 'system'
  const v = localStorage.getItem(STORAGE_KEY)
  return (v === 'light' || v === 'dark' || v === 'system') ? v : 'dark'
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.classList.toggle('light', resolved === 'light')
  root.style.colorScheme = resolved
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStored)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readStored()))

  useEffect(() => {
    const r = resolveTheme(theme)
    setResolved(r)
    applyTheme(r)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = () => {
      const r = resolveTheme('system')
      setResolved(r)
      applyTheme(r)
    }
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t)
    setThemeState(t)
  }, [])

  const cycle = useCallback(() => {
    const order: Theme[] = ['light', 'dark', 'system']
    const next = order[(order.indexOf(theme) + 1) % order.length]
    setTheme(next)
  }, [theme, setTheme])

  return { theme, resolved, setTheme, cycle }
}

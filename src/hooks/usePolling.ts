import { useEffect, useRef, useState } from 'react'

export interface PollState<T> {
  data: T | null
  error: unknown
  /** Time of the last successful response (ms since epoch). */
  lastSuccessAt: number | null
}

/**
 * Calls `fetcher` now and then every `intervalMs` after each call finishes
 * (never overlapping). Keeps the last good data when a call fails, so the UI
 * can show "last updated …" instead of going blank.
 */
export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  enabled = true,
  key: unknown = null, // change this to restart polling (e.g. a new request id)
): PollState<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, lastSuccessAt: null })
  const fetcherRef = useRef(fetcher)
  useEffect(() => {
    fetcherRef.current = fetcher
  })

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const data = await fetcherRef.current(controller.signal)
        if (!controller.signal.aborted) setState({ data, error: null, lastSuccessAt: Date.now() })
      } catch (error) {
        if (!controller.signal.aborted) setState((prev) => ({ ...prev, error }))
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, intervalMs)
    }
    tick()

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [intervalMs, enabled, key])

  return state
}

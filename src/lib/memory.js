import { useEffect, useRef, useState } from 'react'

export function getJSON(key, fallback) {
  try {
    const s = localStorage.getItem(key)
    if (s == null) return fallback
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

export function setJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
      //
  }
}

export function useLocalStorageJSON(key, initialValue) {
  const isFirst = useRef(true)
  const [state, setState] = useState(() => getJSON(key, initialValue))

  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    setJSON(key, state)
  }, [key, state])

  return [state, setState]
}

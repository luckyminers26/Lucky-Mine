import { useEffect, useRef, useState } from 'react'

export function useTurnstile(siteKey) {
  const containerRef = useRef(null)
  const widgetId     = useRef(null)
  const [token, setToken]     = useState(null)
  const [ready, setReady]     = useState(false)

  useEffect(() => {
    // Carrega o script da Cloudflare se ainda não estiver
    if (!document.getElementById('cf-turnstile-script')) {
      const script = document.createElement('script')
      script.id    = 'cf-turnstile-script'
      script.src   = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.onload = () => setReady(true)
      document.head.appendChild(script)
    } else if (window.turnstile) {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    if (!ready || !containerRef.current || !siteKey) return

    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey:  siteKey,
      theme:    'dark',
      callback: (t) => setToken(t),
      'expired-callback': () => setToken(null),
      'error-callback':   () => setToken(null),
    })

    return () => {
      if (widgetId.current !== null) {
        window.turnstile.remove(widgetId.current)
      }
    }
  }, [ready, siteKey])

  function reset() {
    setToken(null)
    if (widgetId.current !== null && window.turnstile) {
      window.turnstile.reset(widgetId.current)
    }
  }

  return { containerRef, token, reset }
}
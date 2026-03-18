import { useState, useEffect } from 'react'
import FingerprintJS from '@fingerprintjs/fingerprintjs'

let cachedVisitorId = null 

export function useFingerprint() {
  const [visitorId, setVisitorId] = useState(cachedVisitorId)
  const [loading, setLoading]     = useState(!cachedVisitorId)

  useEffect(() => {
    if (cachedVisitorId) return

    FingerprintJS.load()
      .then(fp => fp.get())
      .then(result => {
        cachedVisitorId = result.visitorId
        setVisitorId(result.visitorId)
        setLoading(false)
      })
      .catch(err => {
        console.error('Fingerprint error:', err)
        setLoading(false)
      })
  }, [])

  return { visitorId, loading }
}
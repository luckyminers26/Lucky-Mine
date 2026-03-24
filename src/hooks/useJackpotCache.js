import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabaseClient2'

const CACHE_KEY    = 'jackpot_cache'
const CACHE_TTL_MS = 15 * 60 * 1000  // 15 minutos

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.ts) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(jackpotInfo, wagerRanking) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      ts: Date.now(),
      jackpotInfo,
      wagerRanking,
    }))
  } catch {
    // localStorage cheio ou indisponível — ignora
  }
}

export function useJackpotCache() {
  const cached = readCache()
  const isStale = !cached || (Date.now() - cached.ts) > CACHE_TTL_MS

  const [jackpotInfo, setJackpotInfo]     = useState(cached?.jackpotInfo   ?? null)
  const [wagerRanking, setWagerRanking]   = useState(cached?.wagerRanking  ?? null)
  const [loading, setLoading]             = useState(isStale)

  useEffect(() => {
    if (!isStale) return  // cache válido, não busca

    let cancelled = false

    async function fetch() {
      setLoading(true)
      const [j, w] = await Promise.all([
        supabase.rpc('get_jackpot_info'),
        supabase.rpc('get_wager_ranking'),
      ])

      if (cancelled) return

      const ji = j.data ?? null
      const wr = w.data ?? null

      setJackpotInfo(ji)
      setWagerRanking(wr)
      writeCache(ji, wr)
      setLoading(false)
    }

    fetch()
    return () => { cancelled = true }
  }, [])  // só roda uma vez por montagem — isStale é calculado no momento do mount

  // Permite forçar refresh (ex: após jackpot hit)
  function invalidate() {
    try { localStorage.removeItem(CACHE_KEY) } catch {}
  }

  return { jackpotInfo, wagerRanking, loading, invalidate }
}
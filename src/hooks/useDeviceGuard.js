import { supabase } from '../lib/supabaseClient2'

export function useDeviceGuard() {
  async function check(visitorId) {
    if (!visitorId) return { ok: true } // sem fingerprint = deixa passar

    const { data, error } = await supabase.rpc('check_device_farm', {
      p_visitor_id: visitorId,
    })

    if (error) {
      console.error('device guard error:', error.message)
      return { ok: true } // em caso de erro técnico, não bloqueia
    }

    return data
  }

  return { check }
}
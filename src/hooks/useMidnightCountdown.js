import { useEffect, useState } from "react"

export default function useMidnightCountdown() {

  const getMsUntilMidnightBRT = () => {
    const now = new Date()

    const utcMidnightBRT = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      3, 0, 0, 0
    ))

    if (now >= utcMidnightBRT)
      utcMidnightBRT.setUTCDate(utcMidnightBRT.getUTCDate() + 1)

    return utcMidnightBRT - now
  }

  const [remaining, setRemaining] = useState(getMsUntilMidnightBRT)

  useEffect(() => {
    const tick = () => setRemaining(getMsUntilMidnightBRT())
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const h = Math.floor(remaining / 3600000)
  const m = Math.floor((remaining % 3600000) / 60000)
  const s = Math.floor((remaining % 60000) / 1000)

  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}
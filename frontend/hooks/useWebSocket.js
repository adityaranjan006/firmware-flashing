import { useEffect, useCallback } from 'react'
import { useStore } from '../store'

const AGENT_WS_URL = 'ws://localhost:8765'

let wsInstance = null
let reconnectTimer = null
const listeners = {}  // shared across all hook instances

export function useWebSocket() {
  const { setAgentConnected, addTerminalLine } = useStore()

  const connect = useCallback(() => {
    if (wsInstance?.readyState === WebSocket.OPEN || wsInstance?.readyState === WebSocket.CONNECTING) return

    wsInstance = new WebSocket(AGENT_WS_URL)

    wsInstance.onopen = () => {
      setAgentConnected(true)
      addTerminalLine('\x1b[32m● Agent connected\x1b[0m')
      clearTimeout(reconnectTimer)
    }

    wsInstance.onclose = () => {
      setAgentConnected(false)
      addTerminalLine('\x1b[31m● Agent disconnected — retrying...\x1b[0m')
      reconnectTimer = setTimeout(connect, 3000)
    }

    wsInstance.onerror = () => {
      addTerminalLine('\x1b[31m● Agent connection error\x1b[0m')
    }

    wsInstance.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type && listeners[msg.type]) {
          listeners[msg.type](msg)
        }
        if (msg.type === 'terminal') {
          addTerminalLine(msg.data)
        }
      } catch {
        addTerminalLine(event.data)
      }
    }
  }, [setAgentConnected, addTerminalLine])

  useEffect(() => {
    connect()
    return () => clearTimeout(reconnectTimer)
  }, [connect])

  const send = useCallback((type, payload = {}) => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      wsInstance.send(JSON.stringify({ type, ...payload }))
    }
  }, [])

  const on = useCallback((type, handler) => {
    listeners[type] = handler
    return () => { delete listeners[type] }
  }, [])

  return { send, on }
}

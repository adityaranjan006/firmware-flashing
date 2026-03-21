import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../store'

const AGENT_WS_URL = 'ws://localhost:8765'

let wsInstance = null
let reconnectTimer = null

export function useWebSocket() {
  const { setAgentConnected, addTerminalLine } = useStore()
  const listenersRef = useRef({})

  const connect = useCallback(() => {
    if (wsInstance?.readyState === WebSocket.OPEN) return

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
        // Route to specific listener
        if (msg.type && listenersRef.current[msg.type]) {
          listenersRef.current[msg.type](msg)
        }
        // Terminal output always goes to terminal
        if (msg.type === 'terminal') {
          addTerminalLine(msg.data)
        }
      } catch {
        // Raw string → terminal
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
    listenersRef.current[type] = handler
    return () => { delete listenersRef.current[type] }
  }, [])

  return { send, on }
}

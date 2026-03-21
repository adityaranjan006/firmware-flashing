import { useRef, useCallback } from 'react'
import { useStore } from '../store'

export function useSerial() {
  const portRef = useRef(null)
  const readerRef = useRef(null)
  const { addTerminalLine } = useStore()

  const connect = useCallback(async (baudRate = 115200) => {
    try {
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate })
      portRef.current = port
      addTerminalLine(`\x1b[32m● Serial port opened @ ${baudRate} baud\x1b[0m`)
      return port
    } catch (err) {
      addTerminalLine(`\x1b[31m● Serial error: ${err.message}\x1b[0m`)
      throw err
    }
  }, [addTerminalLine])

  const readLine = useCallback(async () => {
    if (!portRef.current) throw new Error('Port not open')
    const reader = portRef.current.readable.getReader()
    readerRef.current = reader
    let buffer = ''
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += new TextDecoder().decode(value)
        if (buffer.includes('\n')) {
          const line = buffer.split('\n')[0].trim()
          reader.releaseLock()
          readerRef.current = null
          return line
        }
      }
    } catch (err) {
      reader.releaseLock()
      throw err
    }
  }, [])

  const write = useCallback(async (data) => {
    if (!portRef.current) throw new Error('Port not open')
    const writer = portRef.current.writable.getWriter()
    await writer.write(new TextEncoder().encode(data))
    writer.releaseLock()
  }, [])

  const disconnect = useCallback(async () => {
    try {
      readerRef.current?.releaseLock()
      await portRef.current?.close()
      portRef.current = null
      addTerminalLine('\x1b[33m● Serial port closed\x1b[0m')
    } catch (err) {
      addTerminalLine(`\x1b[31m● Error closing port: ${err.message}\x1b[0m`)
    }
  }, [addTerminalLine])

  return { connect, readLine, write, disconnect, port: portRef }
}

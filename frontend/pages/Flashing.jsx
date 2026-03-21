import { useState } from 'react'
import { useStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'

const TARGETS = [
  { id: 'esp',  label: 'ESP32',  sub: 'Main controller' },
  { id: 'stm1', label: 'STM #1', sub: 'Primary MCU' },
  { id: 'stm2', label: 'STM #2', sub: 'Secondary MCU' },
]

export default function Flashing() {
  const { flashStatus, setFlashStatus, setStep, addTerminalLine } = useStore()
  const { send, on } = useWebSocket()
  const [running, setRunning] = useState(false)
  const [allDone, setAllDone] = useState(false)

  const flashAll = async () => {
    setRunning(true)
    try {
      for (const target of TARGETS) {
        setFlashStatus(target.id, 'running')
        addTerminalLine(`\x1b[33m$ Flashing ${target.label}...\x1b[0m`)

        await new Promise((resolve, reject) => {
          const cleanup = on(`flash_${target.id}_done`, (msg) => {
            cleanup()
            if (msg.success) {
              setFlashStatus(target.id, 'done')
              addTerminalLine(`\x1b[32m✓ ${target.label} flashed successfully\x1b[0m`)
              resolve()
            } else {
              setFlashStatus(target.id, 'error')
              addTerminalLine(`\x1b[31m✗ ${target.label} flash failed: ${msg.error}\x1b[0m`)
              reject(new Error(msg.error))
            }
          })
          send(`flash_${target.id}`, {})
          // 3 min timeout per target
          setTimeout(() => { cleanup(); reject(new Error('Flash timeout')) }, 180000)
        })
      }
      setAllDone(true)
      addTerminalLine('\x1b[32m✓ All targets flashed successfully\x1b[0m')
    } catch (err) {
      addTerminalLine(`\x1b[31m✗ Flash sequence failed: ${err.message}\x1b[0m`)
    } finally {
      setRunning(false)
    }
  }

  const getIcon = (status) => {
    if (status === 'idle') return null
    if (status === 'running') return '⚡'
    if (status === 'done') return '✓'
    if (status === 'error') return '✗'
  }

  const getBorderColor = (status) => {
    if (status === 'idle') return 'border-border'
    if (status === 'running') return 'border-accent-amber/50'
    if (status === 'done') return 'border-accent-green/50'
    if (status === 'error') return 'border-accent-red/50'
  }

  const getGlow = (status) => {
    if (status === 'running') return 'shadow-[0_0_20px_rgba(255,184,48,0.1)]'
    if (status === 'done') return 'shadow-[0_0_20px_rgba(0,255,136,0.1)]'
    return ''
  }

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      <div className="mb-6">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 04</div>
        <div className="font-display text-3xl text-white tracking-wider">FLASH FIRMWARE</div>
        <p className="text-sm text-surface-3 mt-1 font-body">Flash firmware to ESP32 and both STM microcontrollers.</p>
      </div>

      {/* Target cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {TARGETS.map(target => {
          const status = flashStatus[target.id]
          return (
            <div
              key={target.id}
              className={`
                bg-surface-2 border rounded-xl p-5 transition-all duration-300
                ${getBorderColor(status)} ${getGlow(status)}
              `}
            >
              {/* Icon */}
              <div className={`
                w-10 h-10 rounded-lg flex items-center justify-center font-mono text-lg mb-3
                ${status === 'idle' ? 'bg-surface-3 text-surface-3' : ''}
                ${status === 'running' ? 'bg-accent-amber/20 text-accent-amber' : ''}
                ${status === 'done' ? 'bg-accent-green/20 text-accent-green' : ''}
                ${status === 'error' ? 'bg-accent-red/20 text-accent-red' : ''}
              `}>
                {status === 'idle' ? '□' : getIcon(status)}
              </div>

              <div className="font-body font-semibold text-white text-sm">{target.label}</div>
              <div className="font-mono text-xs text-surface-3 mt-0.5">{target.sub}</div>

              {/* Status bar */}
              <div className="mt-3 h-0.5 bg-surface-3 rounded-full overflow-hidden">
                <div className={`
                  h-full rounded-full transition-all duration-1000
                  ${status === 'running' ? 'bg-accent-amber w-3/4 animate-pulse' : ''}
                  ${status === 'done' ? 'bg-accent-green w-full' : ''}
                  ${status === 'error' ? 'bg-accent-red w-full' : ''}
                  ${status === 'idle' ? 'w-0' : ''}
                `} />
              </div>

              <div className={`
                font-mono text-xs mt-2 tracking-widest uppercase
                ${status === 'idle' ? 'text-surface-3' : ''}
                ${status === 'running' ? 'text-accent-amber' : ''}
                ${status === 'done' ? 'text-accent-green' : ''}
                ${status === 'error' ? 'text-accent-red' : ''}
              `}>
                {status}
              </div>
            </div>
          )
        })}
      </div>

      {!allDone ? (
        <button
          onClick={flashAll}
          disabled={running}
          className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {running
            ? <span className="font-mono text-sm animate-pulse">Flashing in progress...</span>
            : 'Start Flashing →'}
        </button>
      ) : (
        <button
          onClick={() => setStep('testing')}
          className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all animate-slide-up"
        >
          Continue to Sensor Testing →
        </button>
      )}
    </div>
  )
}

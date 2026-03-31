import { useState } from 'react'
import { useStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'

const PORT_CHECK_TIMEOUT = 12000 // ms — STM32_Programmer_CLI -l can be slow

const MILESTONES = [
  {
    id: 'esp',
    label: 'ESP32 Flash',
    sub: 'Main application firmware',
    icon: 'ESP',
  },
  {
    id: 'stm1',
    label: 'STM-1 Flash',
    sub: 'Sensor controller — primary',
    icon: 'ST1',
  },
  {
    id: 'stm2',
    label: 'STM-2 Flash',
    sub: 'Sensor controller — secondary',
    icon: 'ST2',
  },
]

const STATUS_STYLE = {
  idle:    { border: 'border-border',           bg: 'bg-surface-2',      icon: 'bg-surface-3 text-surface-3',          badge: null },
  running: { border: 'border-accent-amber/50',  bg: 'bg-accent-amber/5', icon: 'bg-accent-amber/20 text-accent-amber', badge: { text: 'Flashing...', cls: 'bg-accent-amber/10 text-accent-amber border-accent-amber/30 animate-pulse' } },
  done:    { border: 'border-accent-green/40',  bg: 'bg-accent-green/5', icon: 'bg-accent-green/20 text-accent-green', badge: { text: 'Complete',    cls: 'bg-accent-green/10 text-accent-green border-accent-green/30' } },
  error:   { border: 'border-accent-red/40',    bg: 'bg-accent-red/5',   icon: 'bg-accent-red/20 text-accent-red',     badge: { text: 'Error',       cls: 'bg-accent-red/10 text-accent-red border-accent-red/30' } },
}

export default function FirmwareFlash() {
  const { setStep, flashStatus, setFlashStatus, addTerminalLine, setTerminalOpen, portMapping } = useStore()
  const { send, on } = useWebSocket()
  const [flashing, setFlashing] = useState(null) // which target is currently flashing
  const [checkingPorts, setCheckingPorts] = useState(false)
  const [portsOk, setPortsOk] = useState(false)

  const status = {
    esp:  flashStatus?.esp  ?? 'idle',
    stm1: flashStatus?.stm1 ?? 'idle',
    stm2: flashStatus?.stm2 ?? 'idle',
  }

  const allDone = MILESTONES.every(m => status[m.id] === 'done')
  const anyRunning = flashing !== null
  const anyError = MILESTONES.some(m => status[m.id] === 'error')

  const checkPorts = () => {
    setPortsOk(false)
    setCheckingPorts(true)
    const timer = setTimeout(() => {
      setCheckingPorts(false)
      addTerminalLine('\x1b[31m✗ Port check timed out — redirecting to Programmer Setup\x1b[0m')
      setStep('programmer_setup')
    }, PORT_CHECK_TIMEOUT)

    const cleanup = on('ports_list', (msg) => {
      clearTimeout(timer)
      cleanup()
      setCheckingPorts(false)
      const ports = msg.ports || []
      const probes = msg.stlink_probes || []
      const espFound = ports.some(p => p.device === portMapping.esp)
      const stlinkOk = probes.length >= 2
      if (!espFound || !stlinkOk) {
        const missing = []
        if (!espFound) missing.push(`ESP port ${portMapping.esp} not found`)
        if (!stlinkOk) missing.push(`only ${probes.length}/2 ST-Links detected`)
        addTerminalLine(`\x1b[31m✗ Port check failed: ${missing.join(', ')} — returning to Programmer Setup\x1b[0m`)
        setStep('programmer_setup')
      } else {
        addTerminalLine('\x1b[32m✓ All ports detected — ESP + 2 ST-Links OK\x1b[0m')
        setPortsOk(true)
        setTimeout(() => setPortsOk(false), 3000)
      }
    })
    send('list_ports', {})
  }

  const flashTarget = (id, label) => {
    setPortsOk(false)
    setTerminalOpen(true)   // ensure terminal is visible before logs arrive
    setFlashing(id)
    setFlashStatus(id, 'running')
    addTerminalLine(`\x1b[33m$ Initiating ${label}...\x1b[0m`)

    const cleanup = on(`flash_${id}_done`, (msg) => {
      cleanup()
      setFlashing(null)
      if (msg.success) {
        setFlashStatus(id, 'done')
      } else {
        setFlashStatus(id, 'error')
        addTerminalLine(`\x1b[31m✗ ${label} failed: ${msg.error}\x1b[0m`)
      }
    })

    send(`flash_${id}`, {})

    // 3-minute safety timeout
    setTimeout(() => {
      cleanup()
      if (flashing === id) {
        setFlashing(null)
        setFlashStatus(id, 'error')
        addTerminalLine(`\x1b[31m✗ ${label} timed out\x1b[0m`)
      }
    }, 180_000)
  }

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 03</div>
        <div className="font-display text-3xl text-white tracking-wider">FLASH FIRMWARE</div>
        <p className="text-sm text-surface-3 mt-1 font-body">
          Flash each target individually. Click Flash on each one to proceed.
        </p>
      </div>

      {/* Milestone cards */}
      <div className="space-y-4 mb-8">
        {MILESTONES.map((m) => {
          const s = status[m.id]
          const style = STATUS_STYLE[s]
          const isRunning = flashing === m.id
          const isDone = s === 'done'
          const isError = s === 'error'
          const canFlash = !anyRunning && !isDone

          return (
            <div
              key={m.id}
              className={`flex items-center gap-4 px-5 py-4 rounded-xl border transition-all duration-300 ${style.bg} ${style.border}`}
            >
              {/* Icon */}
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono text-xs font-bold shrink-0 ${style.icon}`}>
                {isDone ? '✓' : isError ? '✗' : m.icon}
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-white font-semibold">{m.label}</span>
                  {style.badge && (
                    <span className={`font-mono text-[10px] px-2 py-0.5 rounded border uppercase tracking-widest ${style.badge.cls}`}>
                      {style.badge.text}
                    </span>
                  )}
                </div>
                <div className="font-body text-xs text-surface-3 mt-0.5">{m.sub}</div>
              </div>

              {/* Right side — spinner when running, flash button otherwise */}
              <div className="shrink-0">
                {isRunning ? (
                  <div className="w-5 h-5 border-2 border-accent-amber border-t-transparent rounded-full animate-spin" />
                ) : isDone ? (
                  <span className="font-mono text-accent-green text-lg">✓</span>
                ) : (
                  <button
                    onClick={() => flashTarget(m.id, m.label)}
                    disabled={!canFlash}
                    className="px-4 py-1.5 bg-accent-green text-surface font-mono text-xs font-semibold rounded-lg hover:bg-accent-green/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {isError ? 'Retry' : 'Flash'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Bottom navigation */}
      <div className="flex gap-3 mt-auto">
        <button
          onClick={() => setStep('programmer_setup')}
          disabled={anyRunning}
          className="px-6 bg-surface-2 border border-border text-surface-3 font-semibold py-3 rounded-xl hover:border-accent-green/30 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ← Back
        </button>
        {portsOk ? (
          <button
            disabled
            className="px-5 bg-accent-green/10 border border-accent-green/50 text-accent-green font-mono text-xs font-semibold py-3 rounded-xl cursor-not-allowed"
          >
            ✓ All Ports Detected
          </button>
        ) : (
          <button
            onClick={checkPorts}
            disabled={anyRunning || checkingPorts || !anyError}
            className="px-5 bg-surface-2 border border-border text-surface-3 font-mono text-xs font-semibold py-3 rounded-xl hover:border-accent-amber/30 hover:text-white transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {checkingPorts ? <span className="animate-pulse">Checking...</span> : '⟳ Check Ports'}
          </button>
        )}
        <button
          onClick={() => setStep('sensors')}
          disabled={!allDone || anyRunning}
          className="flex-1 bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {allDone ? 'Continue to Sensor Config →' : 'Flash all targets to continue'}
        </button>
      </div>
    </div>
  )
}

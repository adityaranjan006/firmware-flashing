import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'

const SENSORS = ['RL', 'RR', 'PL', 'PR', 'HS']

const SENSOR_LABELS = {
  RL: 'Reservoir Left',
  RR: 'Reservoir Right',
  PL: 'Peltier Left',
  PR: 'Peltier Right',
  HS: 'Heat Sink',
}

const SENSOR_PORT_INSTRUCTIONS = {
  RL: 'Connect the Reservoir Left sensor to the RESVLT port on the board and confirm',
  RR: 'Connect the Reservoir Right sensor to the RESVRT port on the board and confirm',
  PL: 'Connect the Peltier Left sensor to the PELTLT port on the board and confirm',
  PR: 'Connect the Peltier Right sensor to the PELTRT port on the board and confirm',
  HS: 'Connect the Heat Sink sensor to the HEATSK port on the board and confirm',
}

// Per-sensor scan state
const initialScanState = () =>
  Object.fromEntries(SENSORS.map(s => [s, { status: 'idle', error: null }]))

export default function SensorConfig() {
  const {
    sensorAddresses, setSensorAddress,
    sensorConfigPhase, setSensorConfigPhase,
    setStep, addTerminalLine,
    portMapping,
  } = useStore()

  const savedPort = portMapping?.esp ?? null
  const [detectedPort, setDetectedPort] = useState(savedPort)

  useEffect(() => {
    send('start_port_scan', {})
    const cleanup = on('ports_list', (msg) => {
      const ports = msg.ports || []
      const found = savedPort && ports.some(p => p.device === savedPort)
      setDetectedPort(found ? savedPort : null)
    })
    return () => {
      send('stop_port_scan', {})
      cleanup()
    }
  }, [])

  const { send, on } = useWebSocket()

  // Which sensor index is currently active (unlocked), 0-based
  const [activeIndex, setActiveIndex] = useState(0)
  // Checkbox state per sensor
  const [confirmed, setConfirmed] = useState({})
  // Scan status per sensor: { status: 'idle'|'scanning'|'done'|'failed', error }
  const [scanState, setScanState] = useState(initialScanState)
  const [saving, setSaving] = useState(false)
  const [doneError, setDoneError] = useState(null)

  // Restore active index to first incomplete sensor if addresses already partially filled
  useEffect(() => {
    if (sensorConfigPhase === 'ready') {
      const firstIncomplete = SENSORS.findIndex(s => !sensorAddresses[s])
      setActiveIndex(firstIncomplete === -1 ? SENSORS.length : firstIncomplete)
    }
  }, [sensorConfigPhase])

  // ── Handshake ─────────────────────────────────────────────────────────────
  const initiateHandshake = () => {
    if (!detectedPort) {
      addTerminalLine('\x1b[31m● No ESP device detected on USB\x1b[0m')
      return
    }
    setSensorConfigPhase('handshaking')
    addTerminalLine('\x1b[33m$ Initiating sensor config handshake...\x1b[0m')

    const cleanup = on('sensor_handshake_result', (msg) => {
      cleanup()
      if (msg.success) {
        setSensorConfigPhase('ready')
        setActiveIndex(0)
      } else {
        setSensorConfigPhase('failed')
        addTerminalLine(`\x1b[31m✗ Handshake failed: ${msg.error}\x1b[0m`)
      }
    })

    send('sensor_handshake')
  }

  // ── Scan single sensor ────────────────────────────────────────────────────
  const scanSensor = (sensorName) => {
    setScanState(prev => ({ ...prev, [sensorName]: { status: 'scanning', error: null } }))
    addTerminalLine(`\x1b[33m$ Requesting address for sensor ${sensorName}...\x1b[0m`)

    const cleanup = on('scan_sensor_result', (msg) => {
      if (msg.sensor_name !== sensorName) return
      cleanup()
      if (msg.address) {
        setSensorAddress(sensorName, msg.address)
        setScanState(prev => ({ ...prev, [sensorName]: { status: 'done', error: null } }))
        // Advance to next sensor
        const idx = SENSORS.indexOf(sensorName)
        if (idx < SENSORS.length - 1) {
          setActiveIndex(idx + 1)
        }
      } else {
        setScanState(prev => ({ ...prev, [sensorName]: { status: 'failed', error: msg.error || 'No response' } }))
      }
    })

    send('scan_sensor', { sensor_name: sensorName })
  }

  // ── Save & continue ───────────────────────────────────────────────────────
  const allDone = SENSORS.every(s => sensorAddresses[s])

  const saveToCsv = () => {
    setSaving(true)
    setDoneError(null)
    addTerminalLine('\x1b[33m$ Finalising sensor config with ESP...\x1b[0m')

    const cleanup = on('sensor_done_result', (msg) => {
      cleanup()
      if (msg.success) {
        addTerminalLine('\x1b[33m$ Writing sensor addresses to config.csv...\x1b[0m')
        send('write_sensor_addresses', { addresses: sensorAddresses })
        addTerminalLine('\x1b[32m✓ Sensor addresses saved\x1b[0m')
        setSaving(false)
        setStep('certconfig')
      } else {
        setDoneError(msg.error || 'No acknowledgment from ESP')
        setSaving(false)
      }
    })

    send('sensor_done')
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderPhaseGate = () => {
    if (sensorConfigPhase === 'idle' || sensorConfigPhase === 'failed') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="text-center">
            <div className="font-mono text-xs text-surface-3 tracking-widest mb-2">STEP 1 OF 2</div>
            <div className="font-display text-xl text-white mb-2">Connect ESP to USB</div>
            <p className="text-sm text-surface-3 max-w-xs">
              Make sure the ESP programmer is plugged in, then initiate the sensor config session.
            </p>
          </div>

          {/* Port indicator */}
          <div className={`rounded-xl p-4 w-full flex items-center justify-between border ${
            detectedPort
              ? 'bg-accent-green/10 border-accent-green/30'
              : 'bg-accent-amber/10 border-accent-amber/30'
          }`}>
            <div>
              <div className={`font-mono text-xs tracking-widest mb-0.5 ${detectedPort ? 'text-accent-green' : 'text-accent-amber'}`}>
                {detectedPort ? 'ESP DETECTED' : 'WAITING FOR DEVICE'}
              </div>
              <div className="text-sm text-surface-3">{detectedPort || 'Plug in the ESP via USB'}</div>
            </div>
            <div className={`w-2.5 h-2.5 rounded-full ${detectedPort ? 'bg-accent-green animate-pulse' : 'bg-accent-amber opacity-50'}`} />
          </div>

          {sensorConfigPhase === 'failed' && (
            <div className="w-full rounded-xl p-3 bg-red-500/10 border border-red-500/30 font-mono text-xs text-red-400">
              Handshake failed. Check the ESP is running the test firmware and retry.
            </div>
          )}

          <button
            onClick={initiateHandshake}
            disabled={!detectedPort}
            className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {sensorConfigPhase === 'failed' ? 'Retry Handshake' : 'Initiate Sensor Config'}
          </button>
        </div>
      )
    }

    if (sensorConfigPhase === 'handshaking') {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-accent-green border-t-transparent animate-spin" />
          <div className="font-mono text-sm text-accent-green">Handshaking with ESP...</div>
          <div className="text-xs text-surface-3">Waiting for acknowledgment from test firmware</div>
        </div>
      )
    }

    return null
  }

  const renderSensorCards = () => (
    <>
      <div className="grid grid-cols-1 gap-3 mb-6">
        {SENSORS.map((name, idx) => {
          const address = sensorAddresses[name]
          const scan = scanState[name]
          const isUnlocked = idx <= activeIndex
          const isActive = idx === activeIndex
          const isDone = !!address || scan.status === 'done'
          const isChecked = !!confirmed[name]
          const canScan = isActive && isChecked && scan.status !== 'scanning'

          return (
            <div
              key={name}
              className={`
                rounded-xl border transition-all duration-300 overflow-hidden
                ${!isUnlocked ? 'opacity-30 pointer-events-none' : ''}
                ${isDone ? 'bg-accent-green/5 border-accent-green/30' : isActive ? 'bg-surface-2 border-accent-amber/40' : 'bg-surface-2 border-border'}
              `}
            >
              {/* Card header */}
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className={`
                    w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm
                    ${isDone ? 'bg-accent-green/20 text-accent-green' : isActive ? 'bg-accent-amber/20 text-accent-amber' : 'bg-surface-3 text-surface-3'}
                  `}>
                    {isDone ? '✓' : name}
                  </div>
                  <div>
                    <div className="font-body font-medium text-white text-sm">{SENSOR_LABELS[name]}</div>
                    <div className="font-mono text-xs mt-0.5">
                      {address
                        ? <span className="text-accent-green">{address}</span>
                        : scan.status === 'failed'
                          ? <span className="text-red-400">{scan.error}</span>
                          : <span className="text-surface-3">No address yet</span>
                      }
                    </div>
                  </div>
                </div>

                {/* Status badge */}
                {isDone && (
                  <span className="font-mono text-xs text-accent-green bg-accent-green/10 px-2 py-1 rounded-lg">DONE</span>
                )}
                {scan.status === 'scanning' && (
                  <span className="font-mono text-xs text-accent-amber animate-pulse">SCANNING...</span>
                )}
              </div>

              {/* Expandable body — only show for active, unlocked, not done */}
              {isUnlocked && !isDone && (
                <div className="px-4 pb-4 space-y-3 border-t border-border/50 pt-3">
                  {/* Checkbox confirmation */}
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={!!confirmed[name]}
                      onChange={e => setConfirmed(prev => ({ ...prev, [name]: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 accent-accent-green cursor-pointer"
                    />
                    <span className="text-sm text-surface-3 group-hover:text-white transition-colors leading-snug">
                      {SENSOR_PORT_INSTRUCTIONS[name]}
                    </span>
                  </label>

                  {/* Get Address button */}
                  <button
                    onClick={() => scanSensor(name)}
                    disabled={!canScan}
                    className={`
                      w-full py-2 rounded-lg font-mono text-xs font-medium transition-all duration-200
                      ${canScan
                        ? 'bg-accent-green text-surface hover:bg-accent-green/90'
                        : 'bg-surface-3 text-surface-3 cursor-not-allowed'
                      }
                    `}
                  >
                    {scan.status === 'scanning' ? 'READING ADDRESS...' : scan.status === 'failed' ? 'RETRY GET ADDRESS' : 'GET ADDRESS'}
                  </button>

                  {scan.status === 'failed' && (
                    <p className="text-xs text-red-400 font-mono">
                      {scan.error} — check connection and retry
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="flex justify-between font-mono text-xs text-surface-3 mb-1.5">
          <span>Sensors configured</span>
          <span>{SENSORS.filter(s => sensorAddresses[s]).length}/{SENSORS.length}</span>
        </div>
        <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-green rounded-full transition-all duration-500"
            style={{ width: `${(SENSORS.filter(s => sensorAddresses[s]).length / SENSORS.length) * 100}%` }}
          />
        </div>
      </div>

      {doneError && (
        <div className="mb-3 rounded-xl p-3 bg-red-500/10 border border-red-500/30 font-mono text-xs text-red-400">
          ✗ {doneError} — check ESP connection and retry
        </div>
      )}
      <button
        onClick={saveToCsv}
        disabled={!allDone || saving}
        className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {saving ? 'Waiting for ESP acknowledgment...' : doneError ? 'Retry Save & Continue →' : 'Save & Continue →'}
      </button>
    </>
  )

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 02</div>
        <div className="font-display text-3xl text-white tracking-wider">SENSOR CONFIG</div>
        <p className="text-sm text-surface-3 mt-1 font-body">
          Establish handshake with the test firmware, then configure each sensor port one by one.
        </p>
      </div>

      {sensorConfigPhase !== 'ready' ? renderPhaseGate() : renderSensorCards()}
    </div>
  )
}

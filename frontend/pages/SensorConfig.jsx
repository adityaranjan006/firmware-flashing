import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'

const SENSORS = ['RL', 'RR', 'PL', 'PR', 'HS']

const SENSOR_LABELS = {
  RL: 'Rear Left',
  RR: 'Rear Right',
  PL: 'Pipe Left',
  PR: 'Pipe Right',
  HS: 'Heat Sink',
}

export default function SensorConfig() {
  const { sensorAddresses, setSensorAddress, setStep, addTerminalLine } = useStore()
  const { send, on } = useWebSocket()
  const [activeSensor, setActiveSensor] = useState(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detectedPort, setDetectedPort] = useState(null)

  useEffect(() => {
    const cleanup = on('port_status', (msg) => {
      setDetectedPort(msg.connected ? msg.port : null)
    })
    return cleanup
  }, [on])

  const testSensor = async (sensorName) => {
    if (!detectedPort) {
      addTerminalLine('\x1b[31m● No ESP device detected\x1b[0m')
      return
    }
    setActiveSensor(sensorName)
    setTesting(true)
    addTerminalLine(`\x1b[33m$ Scanning for sensor ${sensorName}...\x1b[0m`)

    const cleanup = on('scan_sensor_result', (msg) => {
      if (msg.sensor_name !== sensorName) return
      cleanup()
      if (msg.address) {
        setSensorAddress(sensorName, msg.address)
        addTerminalLine(`\x1b[32m● ${sensorName}: ${msg.address}\x1b[0m`)
      } else {
        addTerminalLine(`\x1b[31m● No sensor detected on ${sensorName}: ${msg.error || 'no response'}\x1b[0m`)
      }
      setTesting(false)
      setActiveSensor(null)
    })

    send('scan_sensor', { sensor_name: sensorName })
  }

  const allDone = SENSORS.every(s => sensorAddresses[s])

  const saveToCsv = async () => {
    setSaving(true)
    addTerminalLine('\x1b[33m$ Writing sensor addresses to config.csv...\x1b[0m')
    send('write_sensor_addresses', { addresses: sensorAddresses })
    // Give agent time to write
    setTimeout(() => {
      setSaving(false)
      addTerminalLine('\x1b[32m✓ Sensor addresses saved to config.csv\x1b[0m')
      setStep('certconfig')
    }, 1500)
  }

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 02</div>
        <div className="font-display text-3xl text-white tracking-wider">SENSOR CONFIG</div>
        <p className="text-sm text-surface-3 mt-1 font-body">Connect each sensor one at a time and press Test to read its address.</p>
      </div>

      {/* Port status */}
      <div className={`mb-6 rounded-xl p-4 flex items-center justify-between border ${
        detectedPort
          ? 'bg-accent-green/10 border-accent-green/30'
          : 'bg-accent-amber/10 border-accent-amber/30'
      }`}>
        <div>
          <div className={`font-mono text-xs tracking-widest mb-0.5 ${detectedPort ? 'text-accent-green' : 'text-accent-amber'}`}>
            {detectedPort ? 'ESP DEVICE DETECTED' : 'WAITING FOR DEVICE'}
          </div>
          <div className="text-sm text-surface-3">
            {detectedPort ? detectedPort : 'Plug in the ESP via USB'}
          </div>
        </div>
        <div className={`w-2.5 h-2.5 rounded-full ${detectedPort ? 'bg-accent-green animate-pulse' : 'bg-accent-amber opacity-50'}`} />
      </div>

      {/* Sensor grid */}
      <div className="grid grid-cols-1 gap-3 mb-6">
        {SENSORS.map((name) => {
          const address = sensorAddresses[name]
          const isActive = activeSensor === name && testing
          return (
            <div
              key={name}
              className={`
                flex items-center justify-between p-4 rounded-xl border transition-all duration-200
                ${address ? 'bg-accent-green/5 border-accent-green/30' : 'bg-surface-2 border-border'}
                ${isActive ? 'border-accent-amber/50 bg-accent-amber/5' : ''}
              `}
            >
              {/* Sensor info */}
              <div className="flex items-center gap-4">
                <div className={`
                  w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm
                  ${address ? 'bg-accent-green/20 text-accent-green' : 'bg-surface-3 text-surface-3'}
                  ${isActive ? 'bg-accent-amber/20 text-accent-amber' : ''}
                `}>
                  {name}
                </div>
                <div>
                  <div className="font-body font-medium text-white text-sm">{SENSOR_LABELS[name]}</div>
                  <div className="font-mono text-xs mt-0.5">
                    {address
                      ? <span className="text-accent-green">{address}</span>
                      : <span className="text-surface-3">No address detected</span>
                    }
                  </div>
                </div>
              </div>

              {/* Test button */}
              <button
                onClick={() => testSensor(name)}
                disabled={testing || !detectedPort}
                className={`
                  px-4 py-2 rounded-lg font-mono text-xs font-medium transition-all duration-200
                  ${address
                    ? 'bg-surface-3 text-accent-green border border-accent-green/30 hover:bg-accent-green/10'
                    : 'bg-accent-green text-surface hover:bg-accent-green/90'
                  }
                  disabled:opacity-40 disabled:cursor-not-allowed
                `}
              >
                {isActive ? (
                  <span className="animate-pulse">SCANNING...</span>
                ) : address ? 'RETEST' : 'TEST'}
              </button>
            </div>
          )
        })}
      </div>

      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between font-mono text-xs text-surface-3 mb-1.5">
          <span>Progress</span>
          <span>{SENSORS.filter(s => sensorAddresses[s]).length}/{SENSORS.length}</span>
        </div>
        <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-green rounded-full transition-all duration-500"
            style={{ width: `${(SENSORS.filter(s => sensorAddresses[s]).length / SENSORS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Done button */}
      <button
        onClick={saveToCsv}
        disabled={!allDone || saving}
        className="w-full bg-accent-green text-surface font-semibold py-3 rounded-xl hover:bg-accent-green/90 transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving to Config...' : 'Save & Continue →'}
      </button>
    </div>
  )
}

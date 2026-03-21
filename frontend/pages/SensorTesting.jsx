import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { useWebSocket } from '../hooks/useWebSocket'
import { useApi } from '../hooks/useApi'

// Define all sensors and their test type
const ALL_SENSORS = [
  { id: 'temp_RL',    label: 'Temp Sensor RL',     type: 'auto',   group: 'Temperature' },
  { id: 'temp_RR',    label: 'Temp Sensor RR',     type: 'auto',   group: 'Temperature' },
  { id: 'temp_PL',    label: 'Temp Sensor PL',     type: 'auto',   group: 'Temperature' },
  { id: 'temp_PR',    label: 'Temp Sensor PR',     type: 'auto',   group: 'Temperature' },
  { id: 'temp_HS',    label: 'Temp Sensor HS',     type: 'auto',   group: 'Temperature' },
  { id: 'pressure',   label: 'Pressure Sensor',    type: 'manual', group: 'Sensors' },
  { id: 'flow',       label: 'Flow Sensor',        type: 'manual', group: 'Sensors' },
  { id: 'relay1',     label: 'Relay #1',           type: 'manual', group: 'Actuators' },
  { id: 'relay2',     label: 'Relay #2',           type: 'manual', group: 'Actuators' },
  { id: 'fan',        label: 'Cooling Fan',        type: 'manual', group: 'Actuators' },
]

export default function SensorTesting() {
  const { sensorResults, setSensorResult, setStep, deviceId, addTerminalLine } = useStore()
  const { send, on } = useWebSocket()
  const { saveTestResults } = useApi()
  const [running, setRunning] = useState(false)
  const [started, setStarted] = useState(false)
  const [retesting, setRetesting] = useState(null)
  const [saving, setSaving] = useState(false)

  const allTested = ALL_SENSORS.every(s => sensorResults[s.id] === 'pass' || sensorResults[s.id] === 'fail')
  const allPassed = ALL_SENSORS.every(s => sensorResults[s.id] === 'pass')

  // Start automated tests
  const startTests = () => {
    setStarted(true)
    setRunning(true)
    addTerminalLine('\x1b[33m$ Starting automated sensor tests...\x1b[0m')
    send('start_sensor_tests', {})
  }

  useEffect(() => {
    if (!started) return
    // Listen for auto test results
    const cleanup = on('sensor_result', (msg) => {
      const { sensor_id, result, value } = msg
      setSensorResult(sensor_id, result)
      const color = result === 'pass' ? '32' : '31'
      addTerminalLine(`\x1b[\${color}m● ${sensor_id}: ${result.toUpperCase()} ${value ? `(${value})` : ''}\x1b[0m`)
    })
    const cleanupDone = on('auto_tests_done', () => {
      setRunning(false)
      addTerminalLine('\x1b[32m✓ Automated tests complete. Manual tests pending.\x1b[0m')
    })
    return () => { cleanup(); cleanupDone() }
  }, [started])

  const testManual = (sensorId) => {
    addTerminalLine(`\x1b[33m$ Testing ${sensorId} — observe and confirm...\x1b[0m`)
    send('test_sensor', { sensor_id: sensorId })
    setRetesting(sensorId)
  }

  const markResult = (sensorId, result) => {
    setSensorResult(sensorId, result)
    setRetesting(null)
    addTerminalLine(`\x1b[${result === 'pass' ? '32' : '31'}m● ${sensorId}: ${result.toUpperCase()}\x1b[0m`)
  }

  const retest = (sensorId) => {
    setSensorResult(sensorId, undefined)
    testManual(sensorId)
  }

  const finish = async () => {
    setSaving(true)
    try {
      await saveTestResults(deviceId, sensorResults)
      addTerminalLine('\x1b[32m✓ Test results saved to backend\x1b[0m')
      setStep('done')
    } catch (err) {
      addTerminalLine(`\x1b[31m✗ Failed to save results: ${err.message}\x1b[0m`)
    } finally {
      setSaving(false)
    }
  }

  const statusColor = (result) => {
    if (result === 'pass') return 'border-accent-green/40 bg-accent-green/5'
    if (result === 'fail') return 'border-accent-red/40 bg-accent-red/5'
    return 'border-border bg-surface-2'
  }

  const groups = [...new Set(ALL_SENSORS.map(s => s.group))]

  return (
    <div className="flex-1 flex flex-col p-8 overflow-y-auto animate-fade-in">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="font-mono text-xs text-accent-green tracking-widest mb-1">STEP 05</div>
          <div className="font-display text-3xl text-white tracking-wider">SENSOR TESTING</div>
          <p className="text-sm text-surface-3 mt-1 font-body">Automated tests run first, then manual tests require your confirmation.</p>
        </div>
        {!started && (
          <button
            onClick={startTests}
            className="bg-accent-green text-surface font-semibold px-6 py-2.5 rounded-lg hover:bg-accent-green/90 transition-all"
          >
            Start Tests
          </button>
        )}
        {running && (
          <div className="flex items-center gap-2 px-4 py-2 bg-accent-amber/10 border border-accent-amber/30 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-accent-amber animate-pulse" />
            <span className="font-mono text-xs text-accent-amber">Running...</span>
          </div>
        )}
      </div>

      {/* Sensor groups */}
      {groups.map(group => (
        <div key={group} className="mb-5">
          <div className="font-mono text-xs text-surface-3 tracking-widest uppercase mb-2">{group}</div>
          <div className="space-y-2">
            {ALL_SENSORS.filter(s => s.group === group).map(sensor => {
              const result = sensorResults[sensor.id]
              const isRetesting = retesting === sensor.id
              return (
                <div
                  key={sensor.id}
                  className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${statusColor(result)}`}
                >
                  <div className="flex items-center gap-3">
                    {/* Result indicator */}
                    <div className={`
                      w-7 h-7 rounded-md flex items-center justify-center font-mono text-xs font-bold
                      ${result === 'pass' ? 'bg-accent-green/20 text-accent-green' : ''}
                      ${result === 'fail' ? 'bg-accent-red/20 text-accent-red' : ''}
                      ${!result ? 'bg-surface-3 text-surface-3' : ''}
                    `}>
                      {result === 'pass' ? '✓' : result === 'fail' ? '✗' : '○'}
                    </div>
                    <div>
                      <div className="font-body text-sm font-medium text-white">{sensor.label}</div>
                      <div className="font-mono text-[10px] text-surface-3 uppercase tracking-widest">
                        {sensor.type === 'auto' ? 'AUTO' : 'MANUAL'}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {sensor.type === 'manual' && !result && started && !running && (
                      <>
                        {!isRetesting ? (
                          <button
                            onClick={() => testManual(sensor.id)}
                            className="px-3 py-1.5 bg-accent-blue/20 border border-accent-blue/30 text-accent-blue font-mono text-xs rounded-lg hover:bg-accent-blue/30 transition-colors"
                          >
                            TEST
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => markResult(sensor.id, 'pass')}
                              className="px-3 py-1.5 bg-accent-green/20 border border-accent-green/40 text-accent-green font-mono text-xs rounded-lg hover:bg-accent-green/30 transition-colors"
                            >
                              OK
                            </button>
                            <button
                              onClick={() => markResult(sensor.id, 'fail')}
                              className="px-3 py-1.5 bg-accent-red/20 border border-accent-red/40 text-accent-red font-mono text-xs rounded-lg hover:bg-accent-red/30 transition-colors"
                            >
                              FAIL
                            </button>
                          </>
                        )}
                      </>
                    )}
                    {result === 'fail' && (
                      <button
                        onClick={() => retest(sensor.id)}
                        className="px-3 py-1.5 bg-accent-amber/20 border border-accent-amber/30 text-accent-amber font-mono text-xs rounded-lg hover:bg-accent-amber/30 transition-colors"
                      >
                        RETEST
                      </button>
                    )}
                    {result === 'pass' && (
                      <span className="font-mono text-xs text-accent-green">PASSED</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Finish */}
      {allTested && (
        <button
          onClick={finish}
          disabled={saving || !allPassed}
          className={`
            w-full font-semibold py-3 rounded-xl transition-all animate-slide-up mt-2
            ${allPassed
              ? 'bg-accent-green text-surface hover:bg-accent-green/90'
              : 'bg-accent-red/20 border border-accent-red/30 text-accent-red cursor-not-allowed'
            }
            disabled:opacity-50
          `}
        >
          {saving ? 'Saving results...' : allPassed ? 'Complete Configuration →' : 'Some sensors failed — Retest required'}
        </button>
      )}
    </div>
  )
}

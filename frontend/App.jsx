import './index.css'
import { useEffect } from 'react'
import { useStore } from './store'
import { useWebSocket } from './hooks/useWebSocket'
import StepSidebar from './components/StepSidebar'
import Terminal from './components/Terminal'
import Login from './pages/Login'
import DeviceSelect from './pages/DeviceSelect'
import ProgrammerSetup from './pages/ProgrammerSetup'
import SensorConfig from './pages/SensorConfig'
import CertConfig from './pages/CertConfig'
import FirmwareFlash from './pages/FirmwareFlash'
import Flashing from './pages/Flashing'
import Done from './pages/Done'

function PageRouter() {
  const { currentStep } = useStore()
  switch (currentStep) {
    case 'login':          return <Login />
    case 'device_select':    return <DeviceSelect />
    case 'programmer_setup': return <ProgrammerSetup />
    case 'firmware_flash':   return <FirmwareFlash />
    case 'sensors':          return <SensorConfig />
    case 'certconfig':     return <CertConfig />
    case 'flashing':       return <Flashing />
    case 'done':           return <Done />
    default:               return <Login />
  }
}

const PREV_STEP = {
  device_select:    null,
  programmer_setup: 'device_select',
  firmware_flash:   'programmer_setup',
  sensors:          'firmware_flash',
  certconfig:       'sensors',
  flashing:         'certconfig',
  done:             'flashing',
}

export default function App() {
  const { currentStep, setStep, setConnectedPort } = useStore()
  const { on } = useWebSocket()

  // Global port_status listener — works regardless of which step is active
  useEffect(() => {
    const cleanup = on('port_status', (msg) => {
      setConnectedPort(msg.connected ? msg.port : null)
    })
    return cleanup
  }, [])

  // Push a history entry whenever the step changes so the browser has
  // something to pop when the user presses the back button
  useEffect(() => {
    window.history.pushState({ step: currentStep }, '')
  }, [currentStep])

  // Intercept the browser back button — navigate to the logical previous step
  // instead of leaving the app
  useEffect(() => {
    const handlePop = () => {
      const prev = PREV_STEP[currentStep]
      if (prev) {
        setStep(prev)
      }
      // Always push a new entry so there's always something to pop
      window.history.pushState({ step: prev ?? currentStep }, '')
    }
    window.addEventListener('popstate', handlePop)
    return () => window.removeEventListener('popstate', handlePop)
  }, [currentStep, setStep])

  const showSidebar = currentStep !== 'login'
  const showTerminal = ['device_select', 'programmer_setup', 'firmware_flash', 'sensors', 'certconfig', 'flashing'].includes(currentStep)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface text-white">
      {/* Sidebar */}
      {showSidebar && <StepSidebar />}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar for login */}
        {currentStep === 'login' && (
          <div className="flex items-center justify-between px-8 py-5 border-b border-border shrink-0">
            <div className="font-display text-xl text-accent-green tracking-wider">DEVCONFIG</div>
            <div className="font-mono text-xs text-surface-3 tracking-widest">DEVICE CONFIGURATION TOOL</div>
          </div>
        )}

        {/* Page content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <PageRouter />
        </div>

        {/* Terminal panel */}
        {showTerminal && <Terminal defaultOpen={true} />}
        {!showTerminal && currentStep !== 'login' && <Terminal defaultOpen={false} />}
      </div>
    </div>
  )
}

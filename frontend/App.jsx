import './index.css'
import { useEffect } from 'react'
import { useStore } from './store'
import { useWebSocket } from './hooks/useWebSocket'
import StepSidebar from './components/StepSidebar'
import Terminal from './components/Terminal'
import Login from './pages/Login'
import SensorConfig from './pages/SensorConfig'
import CertConfig from './pages/CertConfig'
import Flashing from './pages/Flashing'
import SensorTesting from './pages/SensorTesting'
import Done from './pages/Done'

function PageRouter() {
  const { currentStep } = useStore()
  switch (currentStep) {
    case 'login':      return <Login />
    case 'sensors':    return <SensorConfig />
    case 'certconfig': return <CertConfig />
    case 'flashing':   return <Flashing />
    case 'testing':    return <SensorTesting />
    case 'done':       return <Done />
    default:           return <Login />
  }
}

export default function App() {
  const { currentStep } = useStore()
  // Init WebSocket connection at app root
  useWebSocket()

  const showSidebar = currentStep !== 'login'
  const showTerminal = ['certconfig', 'flashing', 'testing'].includes(currentStep)

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

import { create } from 'zustand'

export const useStore = create((set, get) => ({
  // Auth
  user: null,
  token: null,
  setAuth: (user, token) => set({ user, token }),
  logout: () => set({ user: null, token: null }),

  // Agent connection
  agentConnected: false,
  setAgentConnected: (v) => set({ agentConnected: v }),

  // Current step: login | sensors | certconfig | flashing | testing | done
  currentStep: 'login',
  setStep: (step) => set({ currentStep: step }),

  // Sensor addresses collected in step 2
  sensorAddresses: { RL: null, RR: null, PL: null, PR: null, HS: null },
  setSensorAddress: (name, address) =>
    set(state => ({ sensorAddresses: { ...state.sensorAddresses, [name]: address } })),

  // Device info from backend
  deviceId: null,
  certPath: null,
  setDeviceInfo: (deviceId, certPath) => set({ deviceId, certPath }),

  // Flash status
  flashStatus: { esp: 'idle', stm1: 'idle', stm2: 'idle' },
  setFlashStatus: (key, status) =>
    set(state => ({ flashStatus: { ...state.flashStatus, [key]: status } })),

  // Terminal lines
  terminalLines: [],
  addTerminalLine: (line) =>
    set(state => ({ terminalLines: [...state.terminalLines.slice(-500), line] })),
  clearTerminal: () => set({ terminalLines: [] }),

  // Sensor test results
  sensorResults: {},
  setSensorResult: (name, result) =>
    set(state => ({ sensorResults: { ...state.sensorResults, [name]: result } })),
}))

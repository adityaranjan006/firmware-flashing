import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'

export default function Terminal({ defaultOpen = true }) {
  const containerRef = useRef(null)
  const termRef = useRef(null)
  const fitAddonRef = useRef(null)
  const writtenCountRef = useRef(0)
  const { terminalLines, terminalOpen, setTerminalOpen } = useStore()

  // Sync local open state with store; honour defaultOpen on first mount
  const [_initDone, setInitDone] = useState(false)
  useEffect(() => {
    if (!_initDone) {
      setTerminalOpen(defaultOpen)
      setInitDone(true)
    }
  }, [])
  const open = terminalOpen
  const setOpen = setTerminalOpen
  const [xtermReady, setXtermReady] = useState(false)

  useEffect(() => {
    if (!open || !containerRef.current || xtermReady) return

    // Guard against React StrictMode's double-invocation: if cleanup runs before
    // the async import resolves, the first Promise must not clobber the second's refs.
    let cancelled = false

    Promise.all([
      import('xterm'),
      import('xterm-addon-fit'),
      import('xterm/css/xterm.css'),
    ]).then(([{ Terminal }, { FitAddon }]) => {
      if (cancelled) return

      const term = new Terminal({
        theme: {
          background: '#0a0c10',
          foreground: '#c8d0e0',
          green: '#00ff88',
          red: '#ff3d5a',
          yellow: '#ffb830',
          blue: '#4d9fff',
          cursor: '#00ff88',
          selectionBackground: '#2a2f3e',
        },
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 12,
        lineHeight: 1.5,
        cursorBlink: true,
        scrollback: 2000,
        convertEol: true,
      })

      const fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.open(containerRef.current)
      fitAddon.fit()

      termRef.current = term
      fitAddonRef.current = fitAddon

      term.writeln('\x1b[32m╔══════════════════════════════════════╗\x1b[0m')
      term.writeln('\x1b[32m║   Device Configuration Tool v1.0     ║\x1b[0m')
      term.writeln('\x1b[32m╚══════════════════════════════════════╝\x1b[0m')
      term.writeln('')

      // Replay any lines that arrived before xterm was ready
      const lines = useStore.getState().terminalLines
      lines.forEach(line => term.writeln(line))
      writtenCountRef.current = lines.length

      setXtermReady(true)
    })

    return () => {
      cancelled = true
      termRef.current?.dispose()
      termRef.current = null
      writtenCountRef.current = 0
      setXtermReady(false)
    }
  }, [open])

  // Stream only newly added lines
  useEffect(() => {
    if (!termRef.current || !xtermReady) return
    const newLines = terminalLines.slice(writtenCountRef.current)
    newLines.forEach(line => termRef.current.writeln(line))
    writtenCountRef.current = terminalLines.length
  }, [terminalLines, xtermReady])

  // Resize observer
  useEffect(() => {
    if (!open) return
    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit()
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [open])

  return (
    <div className="border-t border-border bg-surface-1 flex flex-col" style={{ height: open ? '400px' : '38px', transition: 'height 0.3s ease' }}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 cursor-pointer select-none shrink-0"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-accent-green status-dot-active" />
          <span className="font-mono text-xs text-accent-green tracking-widest uppercase">Terminal</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="font-mono text-xs text-surface-3 hover:text-accent-amber transition-colors"
            onClick={(e) => { e.stopPropagation(); useStore.getState().clearTerminal() }}
          >
            clear
          </button>
          <span className="font-mono text-xs text-surface-3">{open ? '▼' : '▲'}</span>
        </div>
      </div>

      {/* Terminal content */}
      {open && (
        <div className="flex-1 relative overflow-hidden terminal-scanline">
          <div ref={containerRef} className="w-full h-full" />
        </div>
      )}
    </div>
  )
}

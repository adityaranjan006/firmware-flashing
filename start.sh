#!/bin/bash
# ============================================================
#  DevConfig Tool — Setup & Run Script
#  Run this in Cowork terminal to get everything started
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
step()    { echo -e "${BLUE}[→]${NC} $1"; }
warning() { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   DevConfig Tool — Setup & Run       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Detect project root (wherever this script lives) ──────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
AGENT_DIR="$SCRIPT_DIR/local_agent"

info "Project root: $SCRIPT_DIR"

# ── Check required tools ───────────────────────────────────────────────────────
step "Checking required tools..."

command -v node   >/dev/null 2>&1 || error "Node.js not found. Install from https://nodejs.org"
command -v npm    >/dev/null 2>&1 || error "npm not found. Install Node.js from https://nodejs.org"
command -v python3.12 >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || error "Python3 not found. Install from https://python.org"

# Prefer python3.12 for compatibility with esptool and other deps
PYTHON=$(command -v python3.12 || command -v python3)

NODE_VER=$(node -v)
NPM_VER=$(npm -v)
PY_VER=$($PYTHON --version)

info "Node.js $NODE_VER"
info "npm v$NPM_VER"
info "$PY_VER"

# ── Frontend: install npm dependencies ────────────────────────────────────────
echo ""
step "Installing frontend dependencies..."

if [ ! -d "$FRONTEND_DIR" ]; then
  error "frontend/ directory not found at $FRONTEND_DIR"
fi

cd "$FRONTEND_DIR"

if [ ! -d "node_modules" ]; then
  npm install
  info "Frontend dependencies installed"
else
  info "node_modules already present — skipping install"
fi

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
  cat > .env << 'EOF'
# Replace with your actual Golang backend URL
VITE_API_URL=http://localhost:8080
EOF
  warning ".env created — update VITE_API_URL to point to your Golang backend"
fi

# ── Local Agent: create Python venv + install deps ────────────────────────────
echo ""
step "Setting up Python local agent..."

if [ ! -d "$AGENT_DIR" ]; then
  error "local-agent/ directory not found at $AGENT_DIR"
fi

cd "$AGENT_DIR"

if [ ! -d "venv" ]; then
  $PYTHON -m venv venv
  info "Python venv created"
else
  info "venv already present — skipping creation"
fi

# Install/upgrade dependencies
./venv/bin/pip install --quiet --upgrade pip
./venv/bin/pip install --quiet -r requirements.txt
info "Python dependencies installed"

# ── Start both services ────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Starting Services                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# Start local agent in background
step "Starting Local Agent on ws://localhost:8765..."
cd "$AGENT_DIR"
./venv/bin/python main.py > /tmp/devconfig-agent.log 2>&1 &
AGENT_PID=$!
echo $AGENT_PID > /tmp/devconfig-agent.pid
info "Local Agent started (PID: $AGENT_PID)"
info "Agent logs: tail -f /tmp/devconfig-agent.log"

# Wait a moment for agent to bind port
sleep 2

# Check agent actually started
if ! kill -0 $AGENT_PID 2>/dev/null; then
  error "Local Agent failed to start. Check logs: cat /tmp/devconfig-agent.log"
fi

# Start frontend dev server
step "Starting React frontend on http://localhost:3000..."
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!
echo $FRONTEND_PID > /tmp/devconfig-frontend.pid
info "Frontend started (PID: $FRONTEND_PID)"

# Wait for Vite to be ready
sleep 3

echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Everything is Running!             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  🌐 Open in Chrome:   ${BLUE}http://localhost:3000${NC}"
echo -e "  🔌 Local Agent WS:   ${BLUE}ws://localhost:8765${NC}"
echo ""
echo -e "  📋 Agent logs:       tail -f /tmp/devconfig-agent.log"
echo -e "  📋 Stop everything:  bash stop.sh"
echo ""
warning "Make sure to use Chrome or Edge — Web Serial API is not supported in Firefox/Safari"
echo ""

# ── Keep script alive and handle Ctrl+C cleanly ────────────────────────────────
cleanup() {
  echo ""
  step "Shutting down..."
  kill $AGENT_PID 2>/dev/null && info "Local Agent stopped"
  kill $FRONTEND_PID 2>/dev/null && info "Frontend stopped"
  rm -f /tmp/devconfig-agent.pid /tmp/devconfig-frontend.pid
  echo ""
  info "All services stopped. Bye!"
  exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for both processes
wait $AGENT_PID $FRONTEND_PID

#!/bin/bash
# Stop all DevConfig services

GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${GREEN}[→]${NC} Stopping DevConfig services..."

if [ -f /tmp/devconfig-agent.pid ]; then
  kill $(cat /tmp/devconfig-agent.pid) 2>/dev/null
  rm /tmp/devconfig-agent.pid
  echo -e "${GREEN}[✓]${NC} Local Agent stopped"
fi

if [ -f /tmp/devconfig-frontend.pid ]; then
  kill $(cat /tmp/devconfig-frontend.pid) 2>/dev/null
  rm /tmp/devconfig-frontend.pid
  echo -e "${GREEN}[✓]${NC} Frontend stopped"
fi

# Kill by port as fallback
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:8765 | xargs kill -9 2>/dev/null || true

echo -e "${GREEN}[✓]${NC} All services stopped"

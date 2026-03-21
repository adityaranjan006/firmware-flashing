#!/bin/bash
# DevConfig Local Agent — Installer
# Run as root: sudo bash install.sh

set -e

INSTALL_DIR="/opt/devconfig"
AGENT_DIR="$INSTALL_DIR/agent"
VENV_DIR="$INSTALL_DIR/venv"
IDF_PATH="/opt/esp-idf"
SERVICE_NAME="devconfig-agent"
AGENT_USER="devconfig"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC} $1"; }
warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ── Root check ─────────────────────────────────────────────────────────────────
[ "$EUID" -ne 0 ] && error "Please run as root: sudo bash install.sh"

info "=== DevConfig Agent Installer ==="

# ── Create system user ─────────────────────────────────────────────────────────
if ! id "$AGENT_USER" &>/dev/null; then
  useradd -r -s /bin/bash -d "$INSTALL_DIR" "$AGENT_USER"
  info "Created user: $AGENT_USER"
fi

# Add to dialout for serial port access
usermod -aG dialout "$AGENT_USER"
info "Added $AGENT_USER to dialout group"

# ── Create directories ─────────────────────────────────────────────────────────
mkdir -p "$AGENT_DIR" "$INSTALL_DIR/config" "$INSTALL_DIR/firmware/esp32" \
         "$INSTALL_DIR/firmware/stm1" "$INSTALL_DIR/firmware/stm2"
info "Created directories under $INSTALL_DIR"

# ── Copy agent files ───────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR"/*.py "$AGENT_DIR/"
cp "$SCRIPT_DIR/requirements.txt" "$AGENT_DIR/"
info "Agent files copied to $AGENT_DIR"

# ── Python venv + deps ─────────────────────────────────────────────────────────
info "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "$AGENT_DIR/requirements.txt"
info "Python dependencies installed"

# ── Check ESP-IDF ──────────────────────────────────────────────────────────────
if [ ! -f "$IDF_PATH/export.sh" ]; then
  warning "ESP-IDF not found at $IDF_PATH"
  warning "Install ESP-IDF first: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/get-started/"
  warning "Then set IDF_PATH in $AGENT_DIR/main.py"
else
  info "ESP-IDF found at $IDF_PATH"
fi

# ── Set ownership ──────────────────────────────────────────────────────────────
chown -R "$AGENT_USER:$AGENT_USER" "$INSTALL_DIR"

# ── Install systemd service ────────────────────────────────────────────────────
cp "$SCRIPT_DIR/devconfig-agent.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

info "=== Installation Complete ==="
echo ""
echo "  Service status:  systemctl status $SERVICE_NAME"
echo "  Live logs:       journalctl -u $SERVICE_NAME -f"
echo "  WebSocket:       ws://localhost:8765"
echo ""
systemctl status "$SERVICE_NAME" --no-pager

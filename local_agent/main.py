import asyncio
import glob as glob_module
import json
import logging
from pathlib import Path
import websockets
from idf_shell import IDFShell
from flasher import Flasher
from config import ConfigManager
from serial_handler import SerialHandler

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/tmp/devconfig-agent.log'),
    ]
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
_BASE           = Path(__file__).parent
IDF_PATH        = str(_BASE / 'esp-idf')
CONFIG_CSV_PATH = str(_BASE / 'data' / 'config.csv')
FIRMWARE_DIR    = str(_BASE / 'firmware')
HOST            = 'localhost'
PORT            = 8765

# ── Globals ───────────────────────────────────────────────────────────────────
idf_shell      = None
flasher        = None
config_manager = None
serial_handler = None
connected_clients: set = set()

# ── Broadcast terminal output to all clients ──────────────────────────────────
async def broadcast_terminal(line: str):
    if connected_clients:
        msg = json.dumps({'type': 'terminal', 'data': line})
        await asyncio.gather(*[ws.send(msg) for ws in connected_clients], return_exceptions=True)

async def send_event(ws, event_type: str, **kwargs):
    await ws.send(json.dumps({'type': event_type, **kwargs}))

# ── Message router ─────────────────────────────────────────────────────────────
async def handle_message(ws, raw: str):
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        log.warning(f'Non-JSON message: {raw}')
        return

    t = msg.get('type')
    log.info(f'← {t}')

    # ── Sensor addresses → config CSV ──────────────────────────────────────────
    if t == 'write_sensor_addresses':
        try:
            config_manager.write_sensor_addresses(msg['addresses'])
            await broadcast_terminal('\x1b[32m✓ Sensor addresses written to config.csv\x1b[0m')
        except Exception as e:
            await broadcast_terminal(f'\x1b[31m✗ {e}\x1b[0m')

    # ── Write full config (cert + defaults + sensors) ──────────────────────────
    elif t == 'write_config':
        try:
            config_manager.write_full_config(
                device_id=msg['device_id'],
                cert_path=msg['cert_path'],
                cert_data=msg.get('cert_data'),
                defaults=msg['defaults'],
                sensor_addresses=msg['sensor_addresses'],
            )
            await broadcast_terminal('\x1b[32m✓ config.csv written\x1b[0m')
            await send_event(ws, 'config_written', success=True)
        except Exception as e:
            await broadcast_terminal(f'\x1b[31m✗ Config write failed: {e}\x1b[0m')
            await send_event(ws, 'config_written', success=False, error=str(e))

    # ── Flash config file to ESP ───────────────────────────────────────────────
    elif t == 'flash_config':
        async def _flash():
            try:
                await idf_shell.run_command(
                    f'idf.py -p $(ls /dev/ttyUSB* | head -1) flash-nvs {CONFIG_CSV_PATH}',
                    on_line=broadcast_terminal
                )
                await send_event(ws, 'config_flashed', success=True)
            except Exception as e:
                await send_event(ws, 'config_flashed', success=False, error=str(e))
        asyncio.create_task(_flash())

    # ── Flash ESP firmware ─────────────────────────────────────────────────────
    elif t == 'flash_esp':
        async def _flash_esp():
            try:
                await flasher.flash_esp(on_line=broadcast_terminal)
                await send_event(ws, 'flash_esp_done', success=True)
            except Exception as e:
                await broadcast_terminal(f'\x1b[31m✗ ESP flash failed: {e}\x1b[0m')
                await send_event(ws, 'flash_esp_done', success=False, error=str(e))
        asyncio.create_task(_flash_esp())

    # ── Flash STM1 ─────────────────────────────────────────────────────────────
    elif t == 'flash_stm1':
        async def _flash_stm1():
            try:
                await flasher.flash_stm(1, on_line=broadcast_terminal)
                await send_event(ws, 'flash_stm1_done', success=True)
            except Exception as e:
                await broadcast_terminal(f'\x1b[31m✗ STM1 flash failed: {e}\x1b[0m')
                await send_event(ws, 'flash_stm1_done', success=False, error=str(e))
        asyncio.create_task(_flash_stm1())

    # ── Flash STM2 ─────────────────────────────────────────────────────────────
    elif t == 'flash_stm2':
        async def _flash_stm2():
            try:
                await flasher.flash_stm(2, on_line=broadcast_terminal)
                await send_event(ws, 'flash_stm2_done', success=True)
            except Exception as e:
                await broadcast_terminal(f'\x1b[31m✗ STM2 flash failed: {e}\x1b[0m')
                await send_event(ws, 'flash_stm2_done', success=False, error=str(e))
        asyncio.create_task(_flash_stm2())

    # ── Start automated sensor tests ───────────────────────────────────────────
    elif t == 'start_sensor_tests':
        asyncio.create_task(run_sensor_tests(ws))

    # ── Test single manual sensor ──────────────────────────────────────────────
    elif t == 'test_sensor':
        sensor_id = msg['sensor_id']
        await broadcast_terminal(f'\x1b[33m$ Actuating {sensor_id}...\x1b[0m')
        await serial_handler.send_command(f'TEST:{sensor_id}')

    # ── Scan single sensor address via UART ───────────────────────────────────
    elif t == 'scan_sensor':
        sensor_name = msg['sensor_name']
        async def _scan():
            try:
                address = await serial_handler.read_sensor_address(sensor_name)
                await send_event(ws, 'scan_sensor_result', sensor_name=sensor_name, address=address)
            except Exception as e:
                await send_event(ws, 'scan_sensor_result', sensor_name=sensor_name, address=None, error=str(e))
        asyncio.create_task(_scan())

    else:
        log.warning(f'Unknown message type: {t}')


# ── Automated sensor test sequence ────────────────────────────────────────────
AUTO_SENSORS = ['temp_RL', 'temp_RR', 'temp_PL', 'temp_PR', 'temp_HS']

async def run_sensor_tests(ws):
    await broadcast_terminal('\x1b[33m$ Running automated sensor tests via UART...\x1b[0m')
    for sensor_id in AUTO_SENSORS:
        await broadcast_terminal(f'\x1b[33m  → Testing {sensor_id}...\x1b[0m')
        try:
            response = await serial_handler.send_command_and_read(f'TEST:{sensor_id}')
            # Expected response format: "OK:28.5" or "FAIL:no_response"
            if response.startswith('OK:'):
                value = response[3:]
                await ws.send(json.dumps({
                    'type': 'sensor_result',
                    'sensor_id': sensor_id,
                    'result': 'pass',
                    'value': value,
                }))
            else:
                await ws.send(json.dumps({
                    'type': 'sensor_result',
                    'sensor_id': sensor_id,
                    'result': 'fail',
                    'value': response,
                }))
        except Exception as e:
            await ws.send(json.dumps({
                'type': 'sensor_result',
                'sensor_id': sensor_id,
                'result': 'fail',
                'value': str(e),
            }))
        await asyncio.sleep(0.5)

    await ws.send(json.dumps({'type': 'auto_tests_done'}))
    await broadcast_terminal('\x1b[32m✓ Automated tests complete\x1b[0m')


# ── USB port watcher ──────────────────────────────────────────────────────────
_last_port: str | None = None

async def port_watcher():
    global _last_port
    while True:
        ports = glob_module.glob('/dev/ttyUSB*') + glob_module.glob('/dev/ttyACM*')
        port = ports[0] if ports else None
        if port != _last_port:
            _last_port = port
            msg = json.dumps({'type': 'port_status', 'connected': port is not None, 'port': port})
            await asyncio.gather(*[ws.send(msg) for ws in connected_clients], return_exceptions=True)
            log.info(f'Port status changed: {port}')
        await asyncio.sleep(2)


# ── WebSocket connection handler ───────────────────────────────────────────────
async def handler(ws):
    connected_clients.add(ws)
    log.info(f'Client connected. Total: {len(connected_clients)}')
    try:
        await ws.send(json.dumps({'type': 'terminal', 'data': '\x1b[32m● Local agent connected\x1b[0m'}))
        # Send current port state immediately on connect
        await ws.send(json.dumps({'type': 'port_status', 'connected': _last_port is not None, 'port': _last_port}))
        async for message in ws:
            await handle_message(ws, message)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(ws)
        log.info(f'Client disconnected. Total: {len(connected_clients)}')


# ── Startup ────────────────────────────────────────────────────────────────────
async def startup():
    global idf_shell, flasher, config_manager, serial_handler

    log.info('Starting DevConfig Local Agent...')

    config_manager = ConfigManager(CONFIG_CSV_PATH)

    serial_handler = SerialHandler()

    log.info('Initializing IDF shell...')
    idf_shell = IDFShell(IDF_PATH, on_line=lambda line: asyncio.create_task(broadcast_terminal(line)))
    await idf_shell.init()
    log.info('IDF shell ready')

    flasher = Flasher(idf_shell, FIRMWARE_DIR)

    log.info(f'WebSocket server listening on ws://{HOST}:{PORT}')


async def main():
    await startup()
    async with websockets.serve(handler, HOST, PORT):
        log.info('Agent ready — waiting for connections...')
        asyncio.create_task(port_watcher())
        await asyncio.Future()  # run forever


if __name__ == '__main__':
    asyncio.run(main())

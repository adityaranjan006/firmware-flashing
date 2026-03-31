import asyncio
import glob as glob_module
import io
import json
import logging
import os
import re
import shutil
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
import websockets
from serial.tools import list_ports as serial_list_ports
from idf_shell import IDFShell
from flasher import Flasher, _STM1_SN, _STM2_SN
from config import ConfigManager
from serial_handler import SerialHandler

# Known VID (hex, uppercase) → suggested role
_ESP_VIDS  = {'10C4', '0403', '1A86', '2341'}          # Silicon Labs, FTDI, WCH, Arduino
_STM_VID   = '0483'
_STM_PIDS  = {'3748', '374B', '374F', '374E', '3752', '3753'}  # ST-Link V2/V3

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
_BASE              = Path(__file__).parent
IDF_PATH           = str(Path.home() / 'esp-idf')
CONFIG_CSV_PATH    = str(_BASE / 'data' / 'config.csv')
MASTER_CONF_PATH   = _BASE / 'data' / 'flash_binaries' / 'cert_gen' / 'master_conf.csv'
FIRMWARE_DIR       = str(_BASE / 'firmware')
DEVICE_CERTS_DIR   = _BASE / 'data' / 'device_certificates'
BACKEND_URL        = os.environ.get('FACTORY_BACKEND_URL', 'http://localhost:9090')
STM32_CLI          = os.environ.get('STM32_PROGRAMMER_CLI',
                         '/home/dreamspan/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI')
HOST               = 'localhost'
PORT               = 8765

# ── Globals ───────────────────────────────────────────────────────────────────
idf_shell      = None
flasher        = None
config_manager = None
serial_handler = None
connected_clients: set = set()
_port_mapping  = {'esp': None, 'stm': None}   # set by set_port_mapping message

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

    # ── Generate master_conf.csv for NVS partition generation ─────────────────
    elif t == 'write_master_conf':
        try:
            config_manager.write_master_conf(
                device_id=msg['device_id'],
                serial_no=msg['serial_no'],
                hard_ver=msg['hard_ver'],
                sensor_addresses=msg['sensor_addresses'],
                cert_base_dir=DEVICE_CERTS_DIR,
                master_conf_path=MASTER_CONF_PATH,
            )
            await broadcast_terminal(f'\x1b[32m✓ master_conf.csv written for {msg["device_id"]}\x1b[0m')
            await send_event(ws, 'master_conf_written', success=True)
        except Exception as e:
            await broadcast_terminal(f'\x1b[31m✗ master_conf write failed: {e}\x1b[0m')
            await send_event(ws, 'master_conf_written', success=False, error=str(e))

    # ── Send DONE command after all sensors configured ────────────────────────
    elif t == 'sensor_done':
        async def _sensor_done():
            try:
                await broadcast_terminal('\x1b[33m$ Sending DONE to ESP test firmware...\x1b[0m')
                response = await serial_handler.send_tempcfg('DONE')
                if response == 'OK':
                    await broadcast_terminal('\x1b[32m✓ ESP acknowledged sensor config complete\x1b[0m')
                    await send_event(ws, 'sensor_done_result', success=True)
                else:
                    await broadcast_terminal(f'\x1b[31m✗ Unexpected response: {response}\x1b[0m')
                    await send_event(ws, 'sensor_done_result', success=False, error=f'Unexpected response: {response}')
            except Exception as e:
                await broadcast_terminal(f'\x1b[31m✗ DONE command failed: {e}\x1b[0m')
                await send_event(ws, 'sensor_done_result', success=False, error=str(e))
        asyncio.create_task(_sensor_done())

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

    # ── Generate NVS binary from master_conf.csv + nvs_conf.csv ──────────────
    elif t == 'flash_config':
        device_id = msg.get('device_id', '')
        cert_gen_dir = str(_BASE / 'data' / 'flash_binaries' / 'cert_gen')
        mfg_gen      = str(Path.home() / 'esp-idf' / 'tools' / 'mass_mfg' / 'mfg_gen.py')
        nvs_conf     = str(_BASE / 'data' / 'flash_binaries' / 'cert_gen' / 'nvs_conf.csv')
        master_conf  = str(_BASE / 'data' / 'flash_binaries' / 'cert_gen' / 'master_conf.csv')

        async def _gen_nvs():
            try:
                await broadcast_terminal(f'\x1b[33m$ Generating NVS binary for {device_id}...\x1b[0m')
                IDF_PYTHON = '/home/dreamspan/.espressif/python_env/idf5.5_py3.12_env/bin/python'
                cmd = (
                    f'cd {cert_gen_dir} && '
                    f'rm -rf {cert_gen_dir}/csv {cert_gen_dir}/bin && '
                    f'{IDF_PYTHON} {mfg_gen} generate --fileid id '
                    f'{nvs_conf} {master_conf} nvs 0x10000 && '
                    f'mv {cert_gen_dir}/bin/nvs-{device_id}.bin {cert_gen_dir}/bin/{device_id}.bin && '
                    f'rm -f {cert_gen_dir}/master_conf_tmp.csv {cert_gen_dir}/nvs_conf_tmp.csv'
                )
                log.info(f'[NVS GEN] running command: {cmd}')
                await broadcast_terminal(f'\x1b[36m$ {cmd}\x1b[0m')
                await idf_shell.run_command(cmd, on_line=broadcast_terminal)
                nvs_bin = f'{cert_gen_dir}/bin/{device_id}.bin'
                log.info(f'[NVS GEN] binary expected at: {nvs_bin}')
                await broadcast_terminal(f'\x1b[32m✓ NVS binary generated: {nvs_bin}\x1b[0m')
                await send_event(ws, 'config_flashed', success=True, nvs_bin=nvs_bin)
            except Exception as e:
                log.error(f'[NVS GEN] failed: {e}')
                await broadcast_terminal(f'\x1b[31m✗ NVS generation failed: {e}\x1b[0m')
                await send_event(ws, 'config_flashed', success=False, error=str(e))
        asyncio.create_task(_gen_nvs())

    # ── Flash NVS binary to ESP at 0x9000 ────────────────────────────────────
    elif t == 'flash_nvs':
        device_id    = msg.get('device_id', '')
        cert_gen_dir = str(_BASE / 'data' / 'flash_binaries' / 'cert_gen')
        nvs_bin      = f'{cert_gen_dir}/bin/{device_id}.bin'
        IDF_PYTHON   = '/home/dreamspan/.espressif/python_env/idf5.5_py3.12_env/bin/python'

        async def _flash_nvs():
            try:
                esp_port = _port_mapping.get('esp') or 'auto'
                flash_cmd = (
                    f'{IDF_PYTHON} -m esptool --chip esp32s3 --port {esp_port} '
                    f'--before default_reset --after hard_reset '
                    f'write_flash 0x9000 {nvs_bin}'
                )
                log.info(f'[NVS FLASH] running: {flash_cmd}')
                await broadcast_terminal(f'\x1b[33m$ Flashing NVS binary to ESP at 0x9000...\x1b[0m')
                await broadcast_terminal(f'\x1b[36m$ {flash_cmd}\x1b[0m')
                await idf_shell.run_command(flash_cmd, on_line=broadcast_terminal)
                await broadcast_terminal(f'\x1b[32m✓ NVS binary flashed to ESP at 0x9000\x1b[0m')
                await send_event(ws, 'flash_nvs_done', success=True)
            except Exception as e:
                log.error(f'[NVS FLASH] failed: {e}')
                await broadcast_terminal(f'\x1b[31m✗ NVS flash failed: {e}\x1b[0m')
                await send_event(ws, 'flash_nvs_done', success=False, error=str(e))
        asyncio.create_task(_flash_nvs())

    # ── Flash ESP firmware ─────────────────────────────────────────────────────
    elif t == 'flash_esp':
        esp_port = _port_mapping.get('esp') or 'auto-detect'
        await broadcast_terminal(f'\x1b[33m→ Flashing ESP32 on {esp_port}...\x1b[0m')
        async def _flash_esp():
            try:
                await flasher.flash_esp(on_line=broadcast_terminal, port=_port_mapping.get('esp'))
                await send_event(ws, 'flash_esp_done', success=True)
            except Exception as e:
                await broadcast_terminal(f'\x1b[31m✗ ESP flash failed: {e}\x1b[0m')
                await send_event(ws, 'flash_esp_done', success=False, error=str(e))
        asyncio.create_task(_flash_esp())

    # ── Flash STM1 ─────────────────────────────────────────────────────────────
    elif t == 'flash_stm1':
        await broadcast_terminal(f'\x1b[33m→ Flashing STM1 (SN={_STM1_SN})...\x1b[0m')
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
        await broadcast_terminal(f'\x1b[33m→ Flashing STM2 (SN={_STM2_SN})...\x1b[0m')
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

    # ── Handshake with test firmware before sensor config ─────────────────────
    elif t == 'sensor_handshake':
        async def _handshake():
            try:
                port_in_use = _port_mapping.get('esp') or 'auto-detect'
                await broadcast_terminal(f'\x1b[33m$ Sending handshake to ESP test firmware on {port_in_use}...\x1b[0m')
                response = await serial_handler.send_tempcfg('START')
                if response == 'OK':
                    await broadcast_terminal('\x1b[32m✓ Handshake acknowledged — ready for sensor config\x1b[0m')
                    await send_event(ws, 'sensor_handshake_result', success=True)
                else:
                    await broadcast_terminal(f'\x1b[31m✗ Unexpected handshake response: {response}\x1b[0m')
                    await send_event(ws, 'sensor_handshake_result', success=False, error=f'Unexpected response: {response}')
            except Exception as e:
                await broadcast_terminal(f'\x1b[31m✗ Handshake failed: {e}\x1b[0m')
                await send_event(ws, 'sensor_handshake_result', success=False, error=str(e))
        asyncio.create_task(_handshake())

    # ── Scan single sensor address via UART ───────────────────────────────────
    elif t == 'scan_sensor':
        sensor_name = msg['sensor_name']
        async def _scan():
            try:
                await broadcast_terminal(f'\x1b[33m$ Scanning sensor {sensor_name}...\x1b[0m')
                address = await serial_handler.read_sensor_address(sensor_name)
                await broadcast_terminal(f'\x1b[32m✓ {sensor_name}: {address}\x1b[0m')
                await send_event(ws, 'scan_sensor_result', sensor_name=sensor_name, address=address)
            except Exception as e:
                await broadcast_terminal(f'\x1b[31m✗ {sensor_name} scan failed: {e}\x1b[0m')
                await send_event(ws, 'scan_sensor_result', sensor_name=sensor_name, address=None, error=str(e))
        asyncio.create_task(_scan())

    # ── Port scan lifecycle (driven by ProgrammerSetup step) ──────────────────
    elif t == 'start_port_scan':
        global _port_scan_active
        _port_scan_active = True
        log.info('[port_scan] started')

    elif t == 'stop_port_scan':
        _port_scan_active = False
        log.info('[port_scan] stopped')

    # ── List connected USB serial ports (legacy one-shot) ─────────────────────
    elif t == 'list_ports':
        asyncio.create_task(_list_ports(ws))

    # ── Save programmer port mapping ───────────────────────────────────────────
    elif t == 'set_port_mapping':
        _port_mapping['esp'] = msg.get('esp_port')
        log.info(f'Port mapping updated: ESP={_port_mapping["esp"]}')
        if _port_mapping['esp']:
            serial_handler.set_port(_port_mapping['esp'])
        await broadcast_terminal(f'\x1b[32m✓ ESP programmer → {_port_mapping["esp"] or "auto-detect"}\x1b[0m')
        await send_event(ws, 'port_mapping_saved', success=True, esp_port=_port_mapping['esp'])

    # ── Download & extract certificate ZIP from backend ───────────────────────
    elif t == 'download_certificate':
        device_id = msg.get('device_id', '').strip()
        token = msg.get('token', '')
        if not device_id:
            await send_event(ws, 'certificate_downloaded', success=False, error='device_id is required')
        else:
            asyncio.create_task(_download_certificate(ws, device_id, token))

    # ── List available device certificates on disk ────────────────────────────
    elif t == 'list_certificates':
        asyncio.create_task(_list_certificates(ws))

    else:
        log.warning(f'Unknown message type: {t}')


# ── Port listing helper ────────────────────────────────────────────────────────

_ANSI_RE = re.compile(r'\x1b\[[0-9;]*[mGKHF]')

async def _detect_stlink_probes() -> list:
    """Run STM32_Programmer_CLI -l and parse connected ST-Link probes."""
    try:
        # Use shell=True so it inherits the user's full PATH
        proc = await asyncio.create_subprocess_shell(
            f'{STM32_CLI} -l',
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
        raw = stdout.decode('utf-8', errors='replace')
        output = _ANSI_RE.sub('', raw)

        log.info(f'[stlink] output ({len(output)} chars):\n{output}')

        probes = []
        for m in re.finditer(
            r'ST-Link Probe\s+(\d+)\s*:.*?ST-LINK SN\s*:\s*(\S+).*?ST-LINK FW\s*:\s*(\S+)',
            output, re.DOTALL
        ):
            sn = m.group(2)
            role = 'STM1' if sn == _STM1_SN else 'STM2' if sn == _STM2_SN else None
            probes.append({
                'index':    int(m.group(1)),
                'serial':   sn,
                'firmware': m.group(3),
                'role':     role,
            })

        log.info(f'[stlink] probes found: {len(probes)} — regex matches: {[p["serial"] for p in probes]}')
        if not probes:
            # Log a snippet to help diagnose regex mismatch
            stlink_section = output[output.find('STLink Interface'):output.find('STLink Interface') + 400] if 'STLink Interface' in output else output[:400]
            log.warning(f'[stlink] no probes parsed. STLink section:\n{stlink_section}')

        return probes
    except asyncio.TimeoutError:
        log.error('[stlink] STM32_Programmer_CLI -l timed out after 10s')
        return []
    except Exception as e:
        log.error(f'[stlink] unexpected error: {e}')
        return []


async def _list_ports(ws):
    # Serial ports (for ESP programmer assignment)
    serial_ports = []
    for p in serial_list_ports.comports():
        vid = f'{p.vid:04X}' if p.vid is not None else None
        pid = f'{p.pid:04X}' if p.pid is not None else None
        suggested = 'esp' if vid in _ESP_VIDS else None
        serial_ports.append({
            'device':         p.device,
            'description':    p.description or 'Unknown device',
            'manufacturer':   p.manufacturer or '',
            'vid':            vid,
            'pid':            pid,
            'suggested_role': suggested,
        })

    # ST-Link probes via STM32_Programmer_CLI
    stlink_probes = await _detect_stlink_probes()

    log.info(f'Serial ports: {[p["device"] for p in serial_ports]}  ST-Link probes: {len(stlink_probes)}')
    await send_event(ws, 'ports_list', ports=serial_ports, stlink_probes=stlink_probes)


# ── Certificate download helpers ──────────────────────────────────────────────

def _find_cert_file(cert_dir: Path, files: list) -> str | None:
    """Return the path to the primary certificate file in the extracted ZIP."""
    for f in files:
        if f.endswith('certificate.pem.crt') or f.endswith('.crt'):
            return str(cert_dir / f)
    for f in files:
        name = f.lower()
        if f.endswith('.pem') and 'private' not in name and 'key' not in name:
            return str(cert_dir / f)
    return str(cert_dir / files[0]) if files else None


def _do_http_download(url: str, token: str) -> tuple[bytes, str]:
    """Returns (data, zip_stem) where zip_stem is the filename without .zip extension."""
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            content_type = resp.headers.get('Content-Type', 'unknown')
            data = resp.read()
            # Derive filename from Content-Disposition header, fallback to URL path
            disposition = resp.headers.get('Content-Disposition', '')
            filename = None
            if 'filename=' in disposition:
                filename = disposition.split('filename=')[-1].strip().strip('"\'')
            if not filename:
                filename = url.rstrip('/').split('/')[-1]
            zip_stem = filename.removesuffix('.zip')
            log.info(f'[download] status={status} content-type={content_type} bytes={len(data)} filename={filename}')
            return data, zip_stem
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        log.error(f'[download] HTTP {e.code} {e.reason} — body: {body}')
        raise Exception(f'HTTP {e.code}: {e.reason} — {body}')


async def _download_certificate(ws, device_id: str, token: str):
    await broadcast_terminal(f'\x1b[33m$ Downloading certificate for {device_id} from backend...\x1b[0m')
    try:
        url = f'{BACKEND_URL}/certificates/{device_id}'
        zip_data, zip_stem = await asyncio.to_thread(_do_http_download, url, token)

        # Wipe the entire certs directory — no pre-existing certificates
        if DEVICE_CERTS_DIR.exists():
            shutil.rmtree(DEVICE_CERTS_DIR)
            await broadcast_terminal('\x1b[33m$ Cleared existing device_certificates\x1b[0m')

        # Extract into a folder named after the ZIP file (without .zip)
        cert_dir = DEVICE_CERTS_DIR / zip_stem
        cert_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(io.BytesIO(zip_data)) as zf:
            # Extract all files flat into cert_dir (strip any top-level folder in ZIP)
            for member in zf.infolist():
                member_path = Path(member.filename)
                # Use only the filename, discarding any directory structure inside the ZIP
                target = cert_dir / member_path.name
                if member.is_dir():
                    continue
                target.write_bytes(zf.read(member.filename))
            files = [f.name for f in cert_dir.iterdir() if f.is_file()]

        cert_path = _find_cert_file(cert_dir, files)
        await broadcast_terminal(f'\x1b[32m✓ Extracted {len(files)} file(s) → {cert_dir} ({zip_stem})\x1b[0m')
        for f in files:
            await broadcast_terminal(f'\x1b[32m  ↳ {f}\x1b[0m')

        await send_event(ws, 'certificate_downloaded',
            success=True,
            device_id=device_id,
            cert_dir=str(cert_dir),
            cert_path=cert_path,
            files=files,
        )
        log.info(f'Certificate for {device_id} extracted to {cert_dir}')
    except Exception as e:
        await broadcast_terminal(f'\x1b[31m✗ Certificate download failed: {e}\x1b[0m')
        await send_event(ws, 'certificate_downloaded', success=False, device_id=device_id, error=str(e))


async def _list_certificates(ws):
    result = []
    if DEVICE_CERTS_DIR.exists():
        for device_dir in sorted(DEVICE_CERTS_DIR.iterdir()):
            if device_dir.is_dir():
                files = sorted(f.name for f in device_dir.iterdir() if f.is_file())
                result.append({
                    'device_id': device_dir.name,
                    'path': str(device_dir),
                    'files': files,
                })
    await send_event(ws, 'certificates_list', certificates=result)


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
_port_scan_active: bool = False
_stlink_busy: bool = False
_cached_stlink_probes: list = []

def _build_serial_ports() -> list:
    ports = []
    for p in serial_list_ports.comports():
        vid = f'{p.vid:04X}' if p.vid is not None else None
        pid = f'{p.pid:04X}' if p.pid is not None else None
        ports.append({
            'device':         p.device,
            'description':    p.description or 'Unknown device',
            'manufacturer':   p.manufacturer or '',
            'vid':            vid,
            'pid':            pid,
            'suggested_role': 'esp' if vid in _ESP_VIDS else None,
        })
    return ports

async def port_watcher():
    global _stlink_busy, _cached_stlink_probes
    while True:
        if _port_scan_active and connected_clients:
            serial_ports = _build_serial_ports()

            # ST-Link: skip tick if previous CLI call is still running
            if not _stlink_busy:
                _stlink_busy = True
                try:
                    _cached_stlink_probes = await _detect_stlink_probes()
                finally:
                    _stlink_busy = False

            msg = json.dumps({'type': 'ports_list', 'ports': serial_ports, 'stlink_probes': _cached_stlink_probes})
            await asyncio.gather(*[ws.send(msg) for ws in connected_clients], return_exceptions=True)

        await asyncio.sleep(1)


# ── WebSocket connection handler ───────────────────────────────────────────────
async def handler(ws):
    connected_clients.add(ws)
    log.info(f'Client connected. Total: {len(connected_clients)}')
    try:
        await ws.send(json.dumps({'type': 'terminal', 'data': '\x1b[32m● Local agent connected\x1b[0m'}))
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

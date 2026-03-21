import asyncio
import logging
import os
import glob

log = logging.getLogger(__name__)


def find_serial_port(pattern='/dev/ttyUSB*') -> str:
    """Auto-detect first available USB serial port."""
    ports = glob.glob(pattern)
    if not ports:
        raise RuntimeError(f'No serial port found matching {pattern}. Is device connected?')
    log.info(f'Using serial port: {ports[0]}')
    return ports[0]


class Flasher:
    def __init__(self, idf_shell, firmware_dir: str):
        self.idf_shell = idf_shell
        self.firmware_dir = firmware_dir

    # ── ESP32 via idf.py ───────────────────────────────────────────────────────
    async def flash_esp(self, on_line=None):
        port = find_serial_port('/dev/ttyUSB*')
        project_dir = os.path.join(self.firmware_dir, 'esp32')

        log.info(f'Flashing ESP32 on {port}')
        if on_line:
            await on_line(f'\x1b[33m$ idf.py -p {port} flash (project: {project_dir})\x1b[0m')

        # idf.py must run from within the project directory
        command = f'cd {project_dir} && idf.py -p {port} --baud 921600 flash'
        await self.idf_shell.run_command(command, on_line=on_line)

        if on_line:
            await on_line('\x1b[32m✓ ESP32 flash complete\x1b[0m')

    # ── STM32 via STM32_Programmer_CLI ─────────────────────────────────────────
    async def flash_stm(self, stm_num: int, on_line=None):
        """
        Flash STM using STM32CubeProgrammer CLI.
        Assumes ST-Link connected. Adjust -c port=SWD uid=... if multiple ST-Links.
        """
        bin_path = os.path.join(self.firmware_dir, f'stm{stm_num}', 'firmware.bin')
        if not os.path.exists(bin_path):
            raise RuntimeError(f'Firmware not found: {bin_path}')

        log.info(f'Flashing STM{stm_num}: {bin_path}')
        if on_line:
            await on_line(f'\x1b[33m$ STM32_Programmer_CLI -c port=SWD -w {bin_path} 0x08000000 -rst\x1b[0m')

        command = (
            f'STM32_Programmer_CLI '
            f'-c port=SWD index={stm_num - 1} '   # index 0 = first ST-Link, 1 = second
            f'-w {bin_path} 0x08000000 '
            f'-rst'
        )

        # STM programmer doesn't need IDF env but run through same shell for output streaming
        await self.idf_shell.run_command(command, on_line=on_line)

        if on_line:
            await on_line(f'\x1b[32m✓ STM{stm_num} flash complete\x1b[0m')

    # ── Download firmware from S3 URLs before flashing ────────────────────────
    async def download_firmware(self, urls: dict, on_line=None):
        """
        urls = { 'esp': 'https://...', 'stm1': 'https://...', 'stm2': 'https://...' }
        Downloads to FIRMWARE_DIR before flashing.
        """
        import httpx

        targets = {
            'esp':  (urls.get('esp_url'),  os.path.join(self.firmware_dir, 'esp32', 'build', 'firmware.bin')),
            'stm1': (urls.get('stm1_url'), os.path.join(self.firmware_dir, 'stm1', 'firmware.bin')),
            'stm2': (urls.get('stm2_url'), os.path.join(self.firmware_dir, 'stm2', 'firmware.bin')),
        }

        async with httpx.AsyncClient() as client:
            for name, (url, dest) in targets.items():
                if not url:
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                if on_line:
                    await on_line(f'\x1b[33m$ Downloading {name} firmware...\x1b[0m')
                r = await client.get(url)
                r.raise_for_status()
                with open(dest, 'wb') as f:
                    f.write(r.content)
                if on_line:
                    await on_line(f'\x1b[32m✓ {name} firmware downloaded ({len(r.content)//1024} KB)\x1b[0m')

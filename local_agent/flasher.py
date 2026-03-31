import asyncio
import logging
import os
import glob

STM32_CLI = os.environ.get('STM32_PROGRAMMER_CLI',
                '/home/dreamspan/STMicroelectronics/STM32Cube/STM32CubeProgrammer/bin/STM32_Programmer_CLI')

_BASE              = os.path.dirname(os.path.abspath(__file__))
FLASH_BINARIES_DIR = os.path.join(_BASE, 'data', 'flash_binaries')

# Serial numbers from data/flash_binaries/stm*/README.txt
_STM1_SN = '37FF71064E57343605661343'
_STM2_SN = '37FF71064E57343624EB1243'

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

    # ── ESP32 via esptool ─────────────────────────────────────────────────────
    async def flash_esp(self, on_line=None, port: str = None):
        if not port:
            port = find_serial_port('/dev/ttyUSB*')

        esp_dir = os.path.join(FLASH_BINARIES_DIR, 'esp')
        for fname in ('bootloader.bin', 'partition-table.bin', 'ota_data_initial.bin', 'Esp_STM_Uart_Communication.bin'):
            path = os.path.join(esp_dir, fname)
            if not os.path.exists(path):
                raise RuntimeError(f'Binary not found: {path}')

        log.info(f'Flashing ESP32 on {port} using binaries from {esp_dir}')

        IDF_PYTHON = '/home/dreamspan/.espressif/python_env/idf5.5_py3.12_env/bin/python'

        erase_cmd = (
            f'{IDF_PYTHON} -u -m esptool --chip esp32s3 -p {port} '
            f'--before default_reset erase_flash'
        )
        if on_line:
            await on_line(f'\x1b[33m$ Erasing ESP32 flash...\x1b[0m')
            await on_line(f'\x1b[36m$ {erase_cmd}\x1b[0m')
        await self.idf_shell.run_command(erase_cmd, on_line=on_line)
        if on_line:
            await on_line('\x1b[32m✓ Flash erased\x1b[0m')

        command = (
            f'{IDF_PYTHON} -u -m esptool --chip esp32s3 -p {port} -b 460800 '
            f'--before default_reset --after hard_reset write_flash '
            f'--flash_mode dio --flash_size 8MB --flash_freq 80m '
            f'0x0 {esp_dir}/bootloader.bin '
            f'0x8000 {esp_dir}/partition-table.bin '
            f'0x19000 {esp_dir}/ota_data_initial.bin '
            f'0x20000 {esp_dir}/Esp_STM_Uart_Communication.bin'
        )
        if on_line:
            await on_line(f'\x1b[36m$ {command}\x1b[0m')
        await self.idf_shell.run_command(command, on_line=on_line)

        if on_line:
            await on_line('\x1b[32m✓ ESP32 flash complete\x1b[0m')

    # ── STM32 via STM32_Programmer_CLI ─────────────────────────────────────────
    async def _run_stm_cmd(self, cmd: str, label: str, on_line=None):
        """Run one STM32_Programmer_CLI command and verify output contains
        'Download verified successfully'. Raises RuntimeError if not found."""
        verified = False

        async def _capture(line: str):
            nonlocal verified
            if 'Download verified successfully' in line:
                verified = True
            if on_line:
                await on_line(line)

        await self.idf_shell.run_command(cmd, on_line=_capture)

        if not verified:
            raise RuntimeError(
                f'{label} — board not responding or not connected to ST-Link. '
                '"Download verified successfully" not found in output.'
            )

    async def flash_stm(self, stm_num: int, on_line=None):
        stm_dir = os.path.join(FLASH_BINARIES_DIR, f'stm{stm_num}')

        if stm_num == 1:
            hex_file = os.path.join(stm_dir, 'smartmatteressnew.hex')
            if not os.path.exists(hex_file):
                raise RuntimeError(f'Firmware not found: {hex_file}')
            log.info(f'Flashing STM1 (SN={_STM1_SN}): {hex_file}')
            cmd = f'stdbuf -oL {STM32_CLI} -c port=SWD sn={_STM1_SN} -w {hex_file} -v -rst'
            if on_line:
                await on_line(f'\x1b[36m$ {cmd}\x1b[0m')
            await self._run_stm_cmd(cmd, 'STM1 flash', on_line=on_line)

        elif stm_num == 2:
            bl_file  = os.path.join(stm_dir, 'BL_SSB.hex')
            app_file = os.path.join(stm_dir, 'SensorBoard_A_1_0_0.hex')
            for f in (bl_file, app_file):
                if not os.path.exists(f):
                    raise RuntimeError(f'Firmware not found: {f}')

            log.info(f'Flashing STM2 bootloader (SN={_STM2_SN}): {bl_file}')
            if on_line:
                await on_line(f'\x1b[33m$ STM2 bootloader → {bl_file}\x1b[0m')
            await self._run_stm_cmd(
                f'stdbuf -oL {STM32_CLI} -c port=SWD sn={_STM2_SN} -w {bl_file} -v -rst',
                'STM2 bootloader flash', on_line=on_line,
            )

            log.info(f'Flashing STM2 application (SN={_STM2_SN}): {app_file}')
            if on_line:
                await on_line(f'\x1b[33m$ STM2 application → {app_file}\x1b[0m')
            await self._run_stm_cmd(
                f'stdbuf -oL {STM32_CLI} -c port=SWD sn={_STM2_SN} -w {app_file} -v -rst',
                'STM2 application flash', on_line=on_line,
            )

        else:
            raise ValueError(f'Unknown STM number: {stm_num}')

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

import asyncio
import logging
import glob
import serial
import serial.tools.list_ports

log = logging.getLogger(__name__)

BAUD_RATE    = 115200
READ_TIMEOUT = 5.0   # seconds to wait for a response


class SerialHandler:
    def __init__(self):
        self._serial = None
        self._lock = asyncio.Lock()

    def auto_detect_port(self) -> str:
        """Find first USB serial port available."""
        ports = glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*')
        if not ports:
            raise RuntimeError('No serial port found. Is the ESP connected?')
        return ports[0]

    def connect(self, port: str = None, baud: int = BAUD_RATE):
        if self._serial and self._serial.is_open:
            self._serial.close()
        port = port or self.auto_detect_port()
        self._serial = serial.Serial(port, baud, timeout=READ_TIMEOUT)
        log.info(f'Serial opened: {port} @ {baud}')

    def disconnect(self):
        if self._serial and self._serial.is_open:
            self._serial.close()
            log.info('Serial closed')

    async def send_command(self, command: str):
        """Send a command without waiting for a response."""
        async with self._lock:
            if not self._serial or not self._serial.is_open:
                self.connect()
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self._serial.write((command + '\n').encode())
            )
            log.debug(f'→ {command}')

    async def send_command_and_read(self, command: str, timeout: float = READ_TIMEOUT) -> str:
        """Send a command and read the response line."""
        async with self._lock:
            if not self._serial or not self._serial.is_open:
                self.connect()

            loop = asyncio.get_event_loop()

            # Flush input buffer
            await loop.run_in_executor(None, self._serial.reset_input_buffer)

            # Send
            await loop.run_in_executor(
                None,
                lambda: self._serial.write((command + '\n').encode())
            )
            log.debug(f'→ {command}')

            # Read response with timeout
            try:
                raw = await asyncio.wait_for(
                    loop.run_in_executor(None, self._serial.readline),
                    timeout=timeout
                )
                response = raw.decode().strip()
                log.debug(f'← {response}')
                return response
            except asyncio.TimeoutError:
                raise RuntimeError(f'No response from device within {timeout}s for command: {command}')

    async def read_sensor_address(self, sensor_name: str) -> str:
        """
        Send SCAN command and parse address from response.
        Expected response format: ADDR:28:FF:AA:BB:CC:DD:EE:01
        """
        response = await self.send_command_and_read(f'SCAN_SENSOR:{sensor_name}')
        if response.startswith('ADDR:'):
            return response[5:].strip()
        raise RuntimeError(f'Unexpected response: {response}')

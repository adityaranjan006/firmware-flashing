import asyncio
import logging
import glob
import serial
import serial.tools.list_ports

log = logging.getLogger(__name__)

BAUD_RATE    = 115200
READ_TIMEOUT = 30.0   # seconds to wait for a response


class SerialHandler:
    def __init__(self):
        self._serial = None
        self._lock = asyncio.Lock()
        self._port = None   # explicitly assigned port; None = auto-detect

    def set_port(self, port: str):
        """Set the port to use. Closes any existing connection so next command reconnects."""
        self._port = port
        log.info(f'[SERIAL] port set to: {port}')
        if self._serial and self._serial.is_open:
            self._serial.close()
            self._serial = None

    def auto_detect_port(self) -> str:
        """Find first USB serial port available."""
        ports = glob.glob('/dev/ttyUSB*') + glob.glob('/dev/ttyACM*')
        if not ports:
            raise RuntimeError('No serial port found. Is the ESP connected?')
        log.info(f'[SERIAL] auto-detected port: {ports[0]}')
        return ports[0]

    def connect(self, port: str = None, baud: int = BAUD_RATE):
        if self._serial and self._serial.is_open:
            self._serial.close()
        port = port or self._port or self.auto_detect_port()
        self._serial = serial.Serial(port, baud, timeout=READ_TIMEOUT)
        log.info(f'[SERIAL] opened: {port} @ {baud}')

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

    async def send_command_and_read(self, command: str) -> str:
        """Send a command and read until '#' (TEMPCFG frame terminator)."""
        async with self._lock:
            if not self._serial or not self._serial.is_open:
                self.connect()

            loop = asyncio.get_event_loop()

            # Flush input buffer
            await loop.run_in_executor(None, self._serial.reset_input_buffer)

            # Send — log exact bytes going out
            # Use \r\n as ESP32 UART parsers typically expect carriage return
            encoded = (command + '\r\n').encode()
            log.info(f'[SERIAL TX] raw bytes: {encoded!r}')
            await loop.run_in_executor(None, lambda: self._serial.write(encoded))

            # read_until('#') — pyserial blocks until '#' is received or serial
            # timeout fires. No asyncio.wait_for needed; timeout is set on the
            # Serial object itself, so the thread exits cleanly every time.
            raw = await loop.run_in_executor(
                None, lambda: self._serial.read_until(b'#')
            )
            log.info(f'[SERIAL RX] raw bytes: {raw!r}')
            response = raw.decode('utf-8', errors='replace').strip()
            log.info(f'[SERIAL RX] decoded+stripped: {response!r}')
            if not response:
                raise RuntimeError(f'Empty response — ESP sent nothing for command: {command}')
            return response

    # Maps sensor name (as used in store) → TEMPCFG command token
    _SENSOR_CMD = {
        'RL': 'RESVLT',
        'RR': 'RESVRT',
        'PL': 'PELTLT',
        'PR': 'PELTRT',
        'HS': 'HEATSK',
    }

    @staticmethod
    def _parse_tempcfg(raw: str) -> str:
        """Find $TEMPCFG,...# frame in response, ignoring preceding ESP debug output."""
        raw = raw.strip()
        idx = raw.rfind('$TEMPCFG,')
        if idx != -1:
            frame = raw[idx:]
            if frame.endswith('#'):
                return frame[len('$TEMPCFG,'):-1]
        raise RuntimeError(f'Malformed response: {raw!r}')

    async def send_tempcfg(self, token: str) -> str:
        """Send $TEMPCFG,<token># and return the inner value from the response."""
        command = f'$TEMPCFG,{token}#'
        raw = await self.send_command_and_read(command)
        return self._parse_tempcfg(raw)

    async def read_sensor_address(self, sensor_name: str) -> str:
        """
        Send $TEMPCFG,<CMD># for the given sensor and return the hex address.
        Raises RuntimeError with the error code if the ESP returns Exxx.
        """
        cmd_token = self._SENSOR_CMD.get(sensor_name)
        if not cmd_token:
            raise RuntimeError(f'Unknown sensor name: {sensor_name}')

        value = await self.send_tempcfg(cmd_token)

        if value.startswith('E'):
            raise RuntimeError(f'Sensor error {value}')
        # Validate it's a uint64 decimal value
        try:
            int(value)
            return value
        except ValueError:
            raise RuntimeError(f'Unexpected response value: {value!r}')

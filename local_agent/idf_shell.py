import asyncio
import logging
import os
import re as _re

log = logging.getLogger(__name__)

SENTINEL = '__CMD_DONE__'


class IDFShell:
    """
    Spawns a single persistent bash process, sources export.sh once,
    and keeps the IDF environment alive for the entire session.
    All commands run inside this shell so env vars are always present.
    """

    def __init__(self, idf_path: str, on_line=None):
        self.idf_path = idf_path
        self.on_line = on_line   # async callback(line: str)
        self._proc = None
        self._lock = asyncio.Lock()

    async def init(self):
        """Spawn bash and source export.sh once."""
        self._proc = await asyncio.create_subprocess_exec(
            '/bin/bash',
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env={**os.environ},
        )
        log.info('Bash process spawned')

        # Source IDF environment
        await self._write(f'source {self.idf_path}/export.sh 2>&1')
        await self._write(f'echo {SENTINEL}:init')

        # Drain output until sentinel
        async for line in self._drain_until(f'{SENTINEL}:init'):
            log.info(f'[IDF INIT] {line}')
            if self.on_line:
                await self.on_line(line)

        log.info('ESP-IDF environment loaded')

    async def run_command(self, command: str, on_line=None):
        """
        Run a command inside the persistent IDF shell.
        Streams output line by line via on_line callback.
        Raises RuntimeError if command exits with non-zero status.
        """
        async with self._lock:
            tag = f'{SENTINEL}:{id(command)}'
            # Append sentinel + exit code echo after command
            full_cmd = f'{command} 2>&1; echo {tag}:$?'
            await self._write(full_cmd)

            exit_code = None
            async for line in self._drain_until(tag, capture_exit=True):
                if line.startswith(tag):
                    exit_code = int(line.split(':')[-1])
                    break
                if on_line:
                    await on_line(line)
                elif self.on_line:
                    await self.on_line(line)

            if exit_code and exit_code != 0:
                raise RuntimeError(f'Command failed with exit code {exit_code}: {command}')

    async def _write(self, command: str):
        self._proc.stdin.write((command + '\n').encode())
        await self._proc.stdin.drain()

    async def _drain_until(self, sentinel: str, capture_exit: bool = False):
        """Async generator: yield lines until sentinel is found.
        Handles \\r, \\n, and \\r\\n so esptool progress output streams correctly."""
        buf = ''
        while True:
            chunk = await self._proc.stdout.read(256)
            if not chunk:
                break
            buf += chunk.decode('utf-8', errors='replace')
            # Split on \r\n, \r, or \n — keeps partial last segment in buf
            parts = _re.split(r'\r\n|\r|\n', buf)
            buf = parts.pop()          # last segment is incomplete, hold for next read
            for line in parts:
                line = line.rstrip('\r\n')
                if not line:
                    continue
                if sentinel in line:
                    if capture_exit:
                        yield line
                    return
                yield line

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.returncode is None

    async def restart(self):
        """Restart shell and re-source IDF if process died."""
        log.warning('IDF shell died — restarting...')
        try:
            self._proc.kill()
        except Exception:
            pass
        await self.init()

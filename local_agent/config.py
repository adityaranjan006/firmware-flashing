import csv
import os
import logging
from pathlib import Path

log = logging.getLogger(__name__)


class ConfigManager:
    def __init__(self, csv_path: str):
        self.csv_path = Path(csv_path)
        self.csv_path.parent.mkdir(parents=True, exist_ok=True)

    def _read(self) -> dict:
        """Read existing CSV into a flat key→value dict."""
        if not self.csv_path.exists():
            return {}
        config = {}
        with open(self.csv_path, newline='') as f:
            reader = csv.DictReader(f)
            for row in reader:
                config[row['key']] = row['value']
        return config

    def _write(self, config: dict):
        """Write key→value dict back to CSV."""
        with open(self.csv_path, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['key', 'value', 'encoding', 'type'])
            writer.writeheader()
            for key, value in config.items():
                writer.writerow({
                    'key': key,
                    'value': value,
                    'encoding': 'string',
                    'type': 'data',
                })
        log.info(f'Config written: {self.csv_path} ({len(config)} keys)')

    def write_sensor_addresses(self, addresses: dict):
        """
        addresses = { 'RL': '28:FF:AA:...', 'RR': '...', ... }
        Merges sensor addresses into existing config.
        """
        config = self._read()
        for sensor_name, address in addresses.items():
            if address:
                config[f'sensor_addr_{sensor_name}'] = address
                log.info(f'  {sensor_name} → {address}')
        self._write(config)

    def write_full_config(
        self,
        device_id: str,
        cert_path: str,
        cert_data: str,
        defaults: dict,
        sensor_addresses: dict,
    ):
        """
        Build complete config CSV:
          - device_id
          - cert_path
          - all default parameters from backend
          - all sensor addresses
        """
        config = {}

        # Device identity
        config['device_id'] = device_id

        # Certificate path (and optionally write cert file to disk)
        config['cert_path'] = cert_path
        if cert_data:
            cert_file = self.csv_path.parent / 'device_cert.pem'
            cert_file.write_text(cert_data)
            config['cert_path'] = str(cert_file)
            log.info(f'Certificate written to {cert_file}')

        # Default parameters from backend
        if isinstance(defaults, dict):
            for key, value in defaults.items():
                config[key] = str(value)

        # Sensor addresses
        for sensor_name, address in sensor_addresses.items():
            if address:
                config[f'sensor_addr_{sensor_name}'] = address

        self._write(config)
        log.info('Full config written successfully')

    def get_value(self, key: str):
        return self._read().get(key)

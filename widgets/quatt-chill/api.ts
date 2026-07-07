import Homey from 'homey/lib/Homey';

interface ApiRequest {
  homey: Homey;
  params: { deviceId?: string };
  body?: any;
}

interface ChillStatusResponse {
  name: string;
  roomTemp: number | null;
  targetTemp: number | null;
  mode: string | null;
  fanMode: string | null;
  status: string | null;
  isOn: boolean;
  waterTankStatus: string;
  tankFull: boolean;
  tankMissing: boolean;
  disconnected: boolean;
}

function normalizeFanMode(value: string): string {
  const fan = String(value || '').toLowerCase();
  if (fan === 'low' || fan === 'laag') return 'low';
  if (fan === 'high' || fan === 'hoog') return 'high';
  if (fan === 'medium' || fan === 'midden') return 'medium';
  return 'normal';
}

function fanModeCandidates(value: string): string[] {
  const fan = normalizeFanMode(value);
  if (fan === 'low') return ['low', 'laag'];
  if (fan === 'high') return ['high', 'hoog'];

  // Different Quatt/Homey app versions use either "normal" or "medium"
  // for the middle fan speed. Try both so the popup works across versions.
  return ['normal', 'medium', 'midden'];
}

function normalizeMode(value: string): string {
  const mode = String(value || '').toLowerCase();
  if (mode.includes('heat') || mode.includes('verwarm')) return 'heating';
  if (mode.includes('cool') || mode.includes('koel')) return 'cooling';
  return 'off';
}

async function setChillMode(device: any, modeValue: string): Promise<void> {
  const mode = normalizeMode(modeValue);

  if (mode === 'off') {
    await setCapability(device, 'onoff', false);
    return;
  }

  if (device.hasCapability?.('onoff')) {
    await setCapability(device, 'onoff', true);
  }

  const candidates = ['chill_mode', 'thermostat_mode'];
  const errors: string[] = [];

  for (const capabilityId of candidates) {
    if (!device.hasCapability?.(capabilityId)) continue;
    try {
      await setCapability(device, capabilityId, mode);
      return;
    } catch (error: any) {
      errors.push(`${capabilityId}: ${error.message}`);
    }
  }

  throw new Error(errors.length ? errors.join('; ') : 'No writable Chill mode capability found');
}

async function getChillDevice(homey: Homey, deviceId?: string): Promise<any> {
  const driver = homey.drivers.getDriver('quatt_chill');
  const devices = driver.getDevices();
  const requestedId = deviceId ? decodeURIComponent(deviceId) : undefined;

  const device = requestedId
    ? devices.find((d: any) => d.getId?.() === requestedId || d.getData?.().id === requestedId || d.getData?.().uuid === requestedId)
    : devices[0];

  if (!device) {
    throw new Error('No Quatt Chill device found');
  }

  return device;
}

async function setCapability(device: any, capabilityId: string, value: any): Promise<void> {
  if (!device.hasCapability(capabilityId)) {
    throw new Error(`Capability ${capabilityId} not available`);
  }

  // Prefer the registered capability listener, because that is where the device
  // usually forwards the command to the Quatt Remote API.
  if (typeof device.triggerCapabilityListener === 'function') {
    await device.triggerCapabilityListener(capabilityId, value, {});
    return;
  }

  await device.setCapabilityValue(capabilityId, value);
}

async function forceSetTargetTemperatureValue(device: any, value: number): Promise<void> {
  const capabilities = [
    'target_temperature',
    'target_temperature.chill_cooling',
    'target_temperature.chill_heating',
  ];

  for (const capabilityId of capabilities) {
    if (!device.hasCapability?.(capabilityId)) continue;
    try {
      await device.setCapabilityValue(capabilityId, value);
    } catch (_) {
      // Best-effort only. The API command above remains the source of truth.
    }
  }
}

async function setTargetTemperatureCapability(device: any, value: number): Promise<void> {
  const errors: string[] = [];
  const mode = String(device.hasCapability('chill_mode') ? device.getCapabilityValue('chill_mode') : '').toLowerCase();

  // First try the device helper methods. In the current Chill driver these send
  // the exact Quatt Remote API action. Calling the method directly avoids Homey
  // immediately reading the old cloud value back into the widget.
  const methodNames = [
    'setTargetTemperature',
    mode.includes('heat') ? 'setHeatingTargetTemperature' : 'setCoolingTargetTemperature',
    'setCoolingTargetTemperature',
    'setHeatingTargetTemperature',
    'setChillTargetTemperature',
  ];

  for (const methodName of [...new Set(methodNames)]) {
    if (typeof device[methodName] !== 'function') continue;

    try {
      await device[methodName](value);
      await forceSetTargetTemperatureValue(device, value);
      return;
    } catch (error: any) {
      errors.push(`${methodName}: ${error.message}`);
    }
  }

  const candidates = [
    'target_temperature',
    mode.includes('heat') ? 'target_temperature.chill_heating' : 'target_temperature.chill_cooling',
    'target_temperature.chill_cooling',
    'target_temperature.chill_heating',
  ];

  for (const capabilityId of [...new Set(candidates)]) {
    if (!device.hasCapability(capabilityId)) continue;

    try {
      await setCapability(device, capabilityId, value);
      await forceSetTargetTemperatureValue(device, value);
      return;
    } catch (error: any) {
      errors.push(`${capabilityId}: ${error.message}`);
    }
  }

  throw new Error(errors.length ? errors.join('; ') : 'No writable target temperature capability found');
}


async function setChillFanMode(device: any, fanValue: string): Promise<void> {
  const capabilityCandidates = [
    'chill_fan_mode',
    'fan_mode',
    'thermostat_fan_mode',
  ];

  const methodCandidates = [
    'setFanMode',
    'setChillFanMode',
    'setFanSpeed',
    'setVentilationMode',
    'setVentilatorSpeed',
  ];

  const valueCandidates = fanModeCandidates(fanValue);
  const errors: string[] = [];

  for (const methodName of methodCandidates) {
    if (typeof device[methodName] !== 'function') continue;

    for (const value of valueCandidates) {
      try {
        await device[methodName](value);
        if (device.hasCapability?.('chill_fan_mode')) {
          try { await device.setCapabilityValue('chill_fan_mode', value); } catch (_) {}
        }
        return;
      } catch (error: any) {
        errors.push(`${methodName}(${value}): ${error.message}`);
      }
    }
  }

  for (const capabilityId of capabilityCandidates) {
    if (!device.hasCapability?.(capabilityId)) continue;

    for (const value of valueCandidates) {
      try {
        await setCapability(device, capabilityId, value);
        return;
      } catch (error: any) {
        errors.push(`${capabilityId}(${value}): ${error.message}`);
      }
    }
  }

  throw new Error(errors.length ? errors.join('; ') : 'No writable Chill fan mode capability found');
}

module.exports = {
  async getStatus({ homey, params }: ApiRequest): Promise<ChillStatusResponse> {
    try {
      const device = await getChillDevice(homey, params.deviceId);

      return {
        name: device.getName(),
        roomTemp: device.hasCapability('measure_temperature') ? device.getCapabilityValue('measure_temperature') : null,
        targetTemp: device.hasCapability('target_temperature')
          ? device.getCapabilityValue('target_temperature')
          : device.hasCapability('target_temperature.chill_cooling')
            ? device.getCapabilityValue('target_temperature.chill_cooling')
            : device.hasCapability('target_temperature.chill_heating')
              ? device.getCapabilityValue('target_temperature.chill_heating')
              : null,
        mode: device.hasCapability('chill_mode') ? device.getCapabilityValue('chill_mode') : null,
        fanMode: device.hasCapability('chill_fan_mode') ? device.getCapabilityValue('chill_fan_mode') : null,
        status: device.hasCapability('measure_chill_status') ? device.getCapabilityValue('measure_chill_status') : null,
        isOn: device.hasCapability('onoff') ? !!device.getCapabilityValue('onoff') : false,
        waterTankStatus: device.hasCapability('chill_water_tank_status') ? String(device.getCapabilityValue('chill_water_tank_status') || 'OK') : 'OK',
        tankFull: device.hasCapability('chill_water_tank_status')
          ? String(device.getCapabilityValue('chill_water_tank_status') || '').toUpperCase() === 'FULL'
          : device.hasCapability('alarm_chill_tank_full') ? !!device.getCapabilityValue('alarm_chill_tank_full') : false,
        tankMissing: device.hasCapability('chill_water_tank_status')
          ? String(device.getCapabilityValue('chill_water_tank_status') || '').toUpperCase() === 'MISSING'
          : device.hasCapability('alarm_chill_tank_missing') ? !!device.getCapabilityValue('alarm_chill_tank_missing') : false,
        disconnected: device.hasCapability('alarm_chill_disconnected') ? !!device.getCapabilityValue('alarm_chill_disconnected') : false,
      };
    } catch (error: any) {
      throw new Error(`Chill widget API error: ${error.message}`);
    }
  },

  async setOnOff({ homey, params, body }: ApiRequest): Promise<{ ok: true }> {
    try {
      const device = await getChillDevice(homey, params.deviceId);
      await setCapability(device, 'onoff', !!body?.on);
      return { ok: true };
    } catch (error: any) {
      throw new Error(`Chill widget API error: ${error.message}`);
    }
  },

  async setTargetTemperature({ homey, params, body }: ApiRequest): Promise<{ ok: true }> {
    try {
      const value = Number(body?.targetTemperature ?? body?.value);
      if (!Number.isFinite(value)) {
        throw new Error('Invalid target temperature');
      }

      const device = await getChillDevice(homey, params.deviceId);
      await setTargetTemperatureCapability(device, value);
      return { ok: true };
    } catch (error: any) {
      throw new Error(`Chill widget API error: ${error.message}`);
    }
  },

  async setMode({ homey, params, body }: ApiRequest): Promise<{ ok: true }> {
    try {
      const device = await getChillDevice(homey, params.deviceId);
      await setChillMode(device, body?.mode);
      return { ok: true };
    } catch (error: any) {
      throw new Error(`Chill widget API error: ${error.message}`);
    }
  },

  async setFanMode({ homey, params, body }: ApiRequest): Promise<{ ok: true }> {
    try {
      const device = await getChillDevice(homey, params.deviceId);
      await setChillFanMode(device, body?.fanMode);
      return { ok: true };
    } catch (error: any) {
      throw new Error(`Chill widget API error: ${error.message}`);
    }
  },
};

import Homey from 'homey/lib/Homey';

interface ApiRequest {
  homey: Homey;
  params: {
    deviceId?: string;
  };
}

interface StatusResponse {
  roomTemp: number | null;
  setpoint: number | null;
  outsideTemp: number | null;
  power: number | null;
  cop: number | null;
  waterSupplyTemp: number | null;
  thermalPower: number | null;
  flowRate: number | null;
  heatingStatus: 'heating' | 'idle';
}

module.exports = {
  async getStatus({ homey, params }: ApiRequest): Promise<StatusResponse> {
    try {
      // Get all devices from the driver
      const driver = homey.drivers.getDriver('quatt_heatpump');
      const devices = driver.getDevices();

      if (devices.length === 0) {
        throw new Error('No Quatt devices found');
      }

      // Use first device (most users have only one Quatt)
      const device = devices[0];

      // Helper to get capability value with fallback for dual heatpump suffix
      const getCapability = (name: string): any => {
        // First try without suffix (single heatpump)
        if (device.hasCapability(name)) {
          return device.getCapabilityValue(name);
        }
        // Try with .heatpump1 suffix (dual heatpump setup)
        const suffixedName = `${name}.heatpump1`;
        if (device.hasCapability(suffixedName)) {
          return device.getCapabilityValue(suffixedName);
        }
        return null;
      };

      // Get capability values from the device
      const roomTemp = device.getCapabilityValue('measure_thermostat_room_temperature');
      const setpoint = device.getCapabilityValue('measure_thermostat_setpoint_room_temperature');
      const outsideTemp = getCapability('measure_heatpump_temperature_outside');
      const power = device.getCapabilityValue('measure_power');
      const cop = getCapability('measure_heatpump_cop');
      const waterSupplyTemp = device.getCapabilityValue('measure_flowmeter_water_supply_temperature');
      const thermalPower = getCapability('measure_heatpump_thermal_power');
      const flowRate = device.getCapabilityValue('measure_flowmeter_water_flow_speed');
      const heatingOn = device.getCapabilityValue('measure_thermostat_heating_on');

      return {
        roomTemp,
        setpoint,
        outsideTemp,
        power,
        cop,
        waterSupplyTemp,
        thermalPower,
        flowRate,
        heatingStatus: heatingOn ? 'heating' : 'idle',
      };
    } catch (error: any) {
      throw new Error(`Widget API error: ${error.message}`);
    }
  },
};

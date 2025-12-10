import Homey from 'homey/lib/Homey';

interface ApiRequest {
  homey: Homey;
  params: {
    deviceId?: string;
  };
}

interface HeatpumpData {
  cop: number | null;
  thermalPower: number | null;
  outsideTemp: number | null;
  temperatureIncoming: number | null;
  temperatureOutgoing: number | null;
  isActive: boolean;
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
  isDualHeatpump: boolean;
  heatpump1: HeatpumpData | null;
  heatpump2: HeatpumpData | null;
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

      // Check if device has dual heatpumps
      const isDualHeatpump = device.hasCapability('measure_heatpump_cop.heatpump2');

      // Helper to get single heatpump data
      const getHeatpumpData = (suffix: string): HeatpumpData | null => {
        const copCap = `measure_heatpump_cop.${suffix}`;
        if (!device.hasCapability(copCap)) {
          return null;
        }
        // Check if heatpump is active based on working mode
        // Working mode values: '0' = standby, '2' = heating
        const workingMode = device.getCapabilityValue(`measure_heatpump_working_mode.${suffix}`);
        const thermalPower = device.getCapabilityValue(`measure_heatpump_thermal_power.${suffix}`);
        // Active when working mode is '2' (heating) - not '0' (standby)
        const isActive = workingMode === '2' || workingMode === 2;

        return {
          cop: device.getCapabilityValue(copCap),
          thermalPower: thermalPower,
          outsideTemp: device.getCapabilityValue(`measure_heatpump_temperature_outside.${suffix}`),
          temperatureIncoming: device.getCapabilityValue(`measure_heatpump_temperature_incoming_water.${suffix}`),
          temperatureOutgoing: device.getCapabilityValue(`measure_heatpump_temperature_outgoing_water.${suffix}`),
          isActive: !!isActive,
        };
      };

      // Helper to get aggregated value from both heatpumps (sum or average)
      const getAggregatedCapability = (name: string, aggregation: 'sum' | 'avg' | 'first'): number | null => {
        // Single heatpump setup
        if (device.hasCapability(name)) {
          return device.getCapabilityValue(name);
        }

        // Dual heatpump setup
        const hp1Name = `${name}.heatpump1`;
        const hp2Name = `${name}.heatpump2`;

        const hp1Value = device.hasCapability(hp1Name) ? device.getCapabilityValue(hp1Name) : null;
        const hp2Value = device.hasCapability(hp2Name) ? device.getCapabilityValue(hp2Name) : null;

        if (hp1Value === null && hp2Value === null) {
          return null;
        }

        if (aggregation === 'first') {
          return hp1Value ?? hp2Value;
        }

        // For sum/avg, treat null as 0
        const val1 = hp1Value ?? 0;
        const val2 = hp2Value ?? 0;

        if (aggregation === 'sum') {
          return val1 + val2;
        }

        // Average - only count non-null values
        const count = (hp1Value !== null ? 1 : 0) + (hp2Value !== null ? 1 : 0);
        return count > 0 ? (val1 + val2) / count : null;
      };

      // Get capability values from the device
      const roomTemp = device.getCapabilityValue('measure_thermostat_room_temperature');
      const setpoint = device.getCapabilityValue('measure_thermostat_setpoint_room_temperature');
      const outsideTemp = getAggregatedCapability('measure_heatpump_temperature_outside', 'first'); // Same for both
      const power = device.getCapabilityValue('measure_power'); // Total power already aggregated
      const cop = getAggregatedCapability('measure_heatpump_cop', 'avg'); // Average COP of both heatpumps
      const waterSupplyTemp = device.getCapabilityValue('measure_flowmeter_water_supply_temperature');
      const thermalPower = getAggregatedCapability('measure_heatpump_thermal_power', 'sum'); // Sum thermal power from both
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
        isDualHeatpump,
        heatpump1: isDualHeatpump ? getHeatpumpData('heatpump1') : null,
        heatpump2: isDualHeatpump ? getHeatpumpData('heatpump2') : null,
      };
    } catch (error: any) {
      throw new Error(`Widget API error: ${error.message}`);
    }
  },
};

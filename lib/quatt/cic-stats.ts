// Could use https://github.com/typestack/class-validator to validate the data

export interface CicTime {
    ts: bigint;
    tsHuman: string;
}

export interface CicHeatpump {
    modbusSlaveId: number;
    getMainWorkingMode: string; // string on purpose, as this makes conditions easier
    temperatureOutside: number;
    temperatureWaterIn: number;
    temperatureWaterOut: number;
    silentModeStatus: boolean;
    limitedByCop: boolean;
    powerInput: number;
    power: number
}

export interface CicBoiler {
    otFbChModeActive: boolean;
    otFbDhwActive: boolean;
    otFbFlameOn: boolean;
    otFbSupplyInletTemperature: number;
    otFbSupplyOutletTemperature: number;
    otTbCH: boolean;
    oTtbTurnOnOffBoilerOn: boolean;
    otFbWaterPressure: number;
}

export interface CicFlowMeter {
    waterSupplyTemperature: number;
}

export interface CicThermostat {
    otFtChEnabled: boolean;
    otFtDhwEnabled: boolean;
    otFtCoolingEnabled: boolean;
    otFtControlSetpoint: number;
    otFtRoomSetpoint: number;
    otFtRoomTemperature: number;
}

export interface CicQualityControl {
    flowRateFiltered: number;
    supervisoryControlMode: string; // string on purpose, as this makes conditions easier
    stickyPumpProtectionEnabled: boolean;
}

export interface CicSystem {
    hostName: string;
}

export interface CicStats {
    time: CicTime;
    hp1: CicHeatpump;
    hp2?: CicHeatpump;
    boiler: CicBoiler;
    flowMeter: CicFlowMeter;
    thermostat: CicThermostat;
    qc: CicQualityControl;
    system: CicSystem;
}

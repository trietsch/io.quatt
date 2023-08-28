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

export interface CicTime {
    ts: bigint;
    tsHuman: string;
}

export interface CicHeatpump {
    modbusSlaveId: number;
    getMainWorkingMode: number;
    temperatureOutside: number;
    temperatureWaterIn: number;
    temperatureWaterOut: number;
    silentModeStatus: boolean;
    limitedByCop: boolean;
}

export interface CicBoiler {
    otFbChModeActive: boolean;
    otFbDhwActive: boolean;
    otFbFlameOn: boolean;
    otFbSupplyInletTemperature: number;
    otFbSupplyOutletTemperature: number;
    otTbCH: boolean;
    oTtbTurnOnOffBoilerOn: boolean;
}

export interface CicFlowMeter {
    waterSupplyTemperature: number;
    flowRate: number;
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
    supervisoryControlMode: number;
    stickyPumpProtectionEnabled: boolean;
}

export interface CicSystem {
    hostName: string;
}

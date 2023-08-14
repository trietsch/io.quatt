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

interface CicTime {
    ts: bigint;
    tsHuman: string;
}

interface CicHeatpump {
    modbusSlaveId: number;
    getMainWorkingMode: number;
    temperatureOutside: number;
    temperatureWaterIn: number;
    temperatureWaterOut: number;
    silentModeStatus: boolean;
    limitedByCop: boolean;
}

interface CicBoiler {
    otFbChModeActive: boolean;
    otFbDhwActive: boolean;
    otFbFlameOn: boolean;
    otFbSupplyInletTemperature: number;
    otFbSupplyOutletTemperature: number;
    otTbCH: boolean;
    oTtbTurnOnOffBoilerOn: boolean;
}

interface CicFlowMeter {
    waterSupplyTemperature: number;
    flowRate: number;
}

interface CicThermostat {
    otFtChEnabled: boolean;
    otFtDhwEnabled: boolean;
    otFtCoolingEnabled: boolean;
    otFtControlSetpoint: number;
    otFtRoomSetpoint: number;
    otFtRoomTemperature: number;
}

interface CicQualityControl {
    supervisoryControlMode: number;
    stickyPumpProtectionEnabled: boolean;
}

interface CicSystem {
    hostName: string;
}

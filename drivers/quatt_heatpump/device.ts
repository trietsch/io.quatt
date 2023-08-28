import Homey, {DiscoveryResultMAC} from 'homey';
import {QuattClient} from "../../lib/quatt";
import {CicHeatpump} from "../../lib/quatt/cic-stats";

class QuattHeatpump extends Homey.Device {
    private quattClient!: QuattClient;
    private onPollInterval!: NodeJS.Timer;

    /**
     * onInit is called when the device is initialized.
     */
    async onInit() {
        this.log('QuattHeatpump has been initialized');

        this.quattClient = new QuattClient(this.getStoreValue("address"));
        await this.setCapabilityValues();
        await this.setCapabilityValuesInterval(10);
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded() {
        this.log('QuattHeatpump has been added');
    }

    onDiscoveryAddressChanged(discoveryResult: DiscoveryResultMAC) {
        this.quattClient.setDeviceAddress(discoveryResult.address);
    }

    async setCapabilityValues() {
        this.homey.app.log(`[Device] ${this.getName()} - setCapabilityValues`);

        try {
            const settings = this.getSettings();
            const cicStats = await this.quattClient.getCicStats();

            await this.setCapabilityValue('measure_thermostat_room_temperature', cicStats.thermostat.otFtRoomTemperature);

            await this.setCapabilityValue('measure_boiler_central_heating_mode', cicStats.boiler.otFbChModeActive)
            await this.setCapabilityValue('measure_boiler_cic_central_heating_on', cicStats.boiler.otTbCH)
            await this.setCapabilityValue('measure_boiler_cic_central_heating_onoff_boiler', cicStats.boiler.oTtbTurnOnOffBoilerOn)
            await this.setCapabilityValue('measure_boiler_domestic_hot_water_on', cicStats.boiler.otFbDhwActive)
            await this.setCapabilityValue('measure_boiler_flame_on', cicStats.boiler.otFbFlameOn)
            await this.setCapabilityValue('measure_boiler_temperature_incoming_water', cicStats.boiler.otFbSupplyInletTemperature)
            await this.setCapabilityValue('measure_boiler_temperature_outgoing_water', cicStats.boiler.otFbSupplyOutletTemperature)
            await this.setCapabilityValue('measure_flowmeter_water_flow_speed', cicStats.flowMeter.flowRate)
            await this.setCapabilityValue('measure_flowmeter_water_supply_temperature', cicStats.flowMeter.waterSupplyTemperature)

            await this.setHeatPumpValues('heatpump1', cicStats.hp1)

            if (cicStats.hp2) {
                await this.setHeatPumpValues('heatpump2', cicStats.hp2)
            }

            await this.setCapabilityValue('measure_quality_control_supervisory_control_mode', cicStats.qc.supervisoryControlMode.toString());
            await this.setCapabilityValue('measure_thermostat_cooling_on', cicStats.thermostat.otFtCoolingEnabled)
            await this.setCapabilityValue('measure_thermostat_domestic_hot_water_on', cicStats.thermostat.otFtDhwEnabled)
            await this.setCapabilityValue('measure_thermostat_heating_on', cicStats.thermostat.otFtChEnabled)
            await this.setCapabilityValue('measure_thermostat_room_temperature', cicStats.thermostat.otFtRoomTemperature)
            await this.setCapabilityValue('measure_thermostat_setpoint_room_temperature', cicStats.thermostat.otFtRoomSetpoint)
            await this.setCapabilityValue('measure_thermostat_setpoint_water_supply_temperature', cicStats.thermostat.otFtControlSetpoint)
        } catch (error) {
            this.homey.app.error(error);
        }
    }

    // TODO dynamically add the capabilities to the device if heatpump 2 exists. Otherwise default to the standard names.
    async setHeatPumpValues(name: string, hp: CicHeatpump) {
        await this.setCapabilityValue(`measure_heatpump_limited_by_cop.${name}`, hp.limitedByCop)
        await this.setCapabilityValue(`measure_heatpump_silent_mode.${name}`, hp.silentModeStatus)
        await this.setCapabilityValue(`measure_heatpump_temperature_incoming_water.${name}`, hp.temperatureWaterIn)
        await this.setCapabilityValue(`measure_heatpump_temperature_outgoing_water.${name}`, hp.temperatureWaterOut)
        await this.setCapabilityValue(`measure_heatpump_temperature_outside.${name}`, hp.temperatureOutside)
        await this.setCapabilityValue(`measure_heatpump_working_mode.${name}`, hp.getMainWorkingMode.toString())
    }

    async setCapabilityValuesInterval(update_interval_seconds: number) {
        try {
            const refreshInterval = 1000 * update_interval_seconds;

            this.homey.app.log(`[Device] ${this.getName()} - onPollInterval =>`, refreshInterval);
            this.onPollInterval = setInterval(this.setCapabilityValues.bind(this), refreshInterval);
        } catch (error: unknown) {
            await this.setUnavailable(JSON.stringify(error));
            this.homey.app.log(error);
        }
    }

    async clearIntervals() {
        this.homey.app.log(`[Device] ${this.getName()} - clearIntervals`);
        await clearInterval(this.onPollInterval);
    }

    // async setValue(key: string, value: string, firstRun = false, delay = 10, roundNumber = false) {
    //     this.homey.app.log(`[Device] ${this.getName()} - setValue => ${key} => `, value);
    //
    //     if (this.hasCapability(key)) {
    //         const newKey = key.replace('.', '_');
    //         const oldVal = await this.getCapabilityValue(key);
    //         const newVal = roundNumber ? Math.round(value) : value;
    //
    //         this.homey.app.log(`[Device] ${this.getName()} - setValue - oldValue => ${key} => `, oldVal, newVal);
    //
    //         if (delay) {
    //             await sleep(delay);
    //         }
    //
    //         await this.setCapabilityValue(key, newVal);
    //
    //         if (typeof newVal === 'boolean' && oldVal !== newVal && !firstRun) {
    //             const triggers = this.homey.manifest.flow.triggers;
    //             const triggerExists = triggers.find((trigger) => trigger.id === `${newKey}_changed`);
    //
    //             if (triggerExists) {
    //                 await this.homey.flow
    //                     .getDeviceTriggerCard(`${newKey}_changed`)
    //                     .trigger(this)
    //                     .catch(this.error)
    //                     .then(this.homey.app.log(`[Device] ${this.getName()} - setValue ${newKey}_changed - Triggered: "${newKey} | ${newVal}"`));
    //             }
    //         } else if (oldVal !== newVal && !firstRun) {
    //             this.homey.app.log(`[Device] ${this.getName()} - setValue ${newKey}_changed - Triggered: "${newKey} | ${newVal}"`);
    //         }
    //     }
    // }

}

module.exports = QuattHeatpump;

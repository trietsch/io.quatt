import Homey, {FlowCardTrigger} from 'homey';
import {QuattClient} from "../../lib/quatt";
import {CicHeatpump} from "../../lib/quatt/cic-stats";




class QuattHeatpump extends Homey.Device {
    private quattClient!: QuattClient;
    private onPollInterval!: NodeJS.Timer;

    private capabilitiesAdded = false;
    private singleHeatpumpCapabilities = [
        "measure_heatpump_limited_by_cop",
        "measure_heatpump_thermal_power",
        "measure_heatpump_silent_mode",
        "measure_heatpump_temperature_incoming_water",
        "measure_heatpump_temperature_outgoing_water",
        "measure_heatpump_temperature_outside",
        "measure_heatpump_working_mode",
    ];
    private multipleHeatpumpCapabilities = ["heatpump1", "heatpump2"]
        .flatMap((suffix) =>
            this.singleHeatpumpCapabilities.map((capability) => {
                return `${capability}.${suffix}`
            }));

    private defaultBooleanTriggerMapping = new Map<string, string | boolean>([
        ['argument', 'state'],
        ['on', true],
        ['off', false]
    ]);
    private triggerMappings = new Map([
        ['measure_boiler_central_heating_mode_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_cic_central_heating_on_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_cic_central_heating_onoff_boiler_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_domestic_hot_water_on_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_flame_on_changed', this.defaultBooleanTriggerMapping],
    ]);

    private triggers: Map<string, FlowCardTrigger> = new Map();

    /**
     * onInit is called when the device is initialized.
     */
    async onInit() {
        this.log('Quatt Heatpump has been initialized');
        this.quattClient = new QuattClient(this.getStoreValue("address"));
        await this.registerTriggers();
        await this.setCapabilityValues();
        await this.setCapabilityValuesInterval(10);
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded() {
        this.log('Quatt Heatpump has been added');
    }

    async setCapabilityValues() {
        try {
            const cicStats = await this.quattClient.getCicStats();

            if (!cicStats) {
                this.log('Unable to fetch data from Quatt CIC');
                return;
            }

            if (!cicStats.hp2) {


                await this.addCapabilities(this.singleHeatpumpCapabilities);
                await this.setHeatPumpValues(cicStats.hp1);
                await this.safeSetCapabilityValue('measure_power', cicStats.hp1.powerInput)
            } else {
                await this.addCapabilities(this.multipleHeatpumpCapabilities);
                await this.setHeatPumpValues(cicStats.hp1, 'heatpump1');
                await this.setHeatPumpValues(cicStats.hp2, 'heatpump2');
                await this.safeSetCapabilityValue('measure_power', cicStats.hp1.powerInput + cicStats.hp2.powerInput)
            }

            await this.safeSetCapabilityValue('measure_thermostat_room_temperature', cicStats.thermostat.otFtRoomTemperature);
            await this.safeSetCapabilityValue('measure_boiler_central_heating_mode', cicStats.boiler.otFbChModeActive)
            await this.safeSetCapabilityValue('measure_boiler_cic_central_heating_on', cicStats.boiler.otTbCH)
            await this.safeSetCapabilityValue('measure_boiler_cic_central_heating_onoff_boiler', cicStats.boiler.oTtbTurnOnOffBoilerOn)
            await this.safeSetCapabilityValue('measure_boiler_domestic_hot_water_on', cicStats.boiler.otFbDhwActive)
            await this.safeSetCapabilityValue('measure_boiler_flame_on', cicStats.boiler.otFbFlameOn)
            await this.safeSetCapabilityValue('measure_boiler_temperature_incoming_water', cicStats.boiler.otFbSupplyInletTemperature)
            await this.safeSetCapabilityValue('measure_boiler_temperature_outgoing_water', cicStats.boiler.otFbSupplyOutletTemperature)
            await this.safeSetCapabilityValue('measure_flowmeter_water_flow_speed', cicStats.flowMeter.flowRate)
            await this.safeSetCapabilityValue('measure_flowmeter_water_supply_temperature', cicStats.flowMeter.waterSupplyTemperature)
            await this.safeSetCapabilityValue('measure_quality_control_supervisory_control_mode', cicStats.qc.supervisoryControlMode.toString());
            await this.safeSetCapabilityValue('measure_thermostat_cooling_on', cicStats.thermostat.otFtCoolingEnabled)
            await this.safeSetCapabilityValue('measure_thermostat_domestic_hot_water_on', cicStats.thermostat.otFtDhwEnabled)
            await this.safeSetCapabilityValue('measure_thermostat_heating_on', cicStats.thermostat.otFtChEnabled)
            await this.safeSetCapabilityValue('measure_thermostat_room_temperature', cicStats.thermostat.otFtRoomTemperature)
            await this.safeSetCapabilityValue('measure_thermostat_setpoint_room_temperature', cicStats.thermostat.otFtRoomSetpoint)
            await this.safeSetCapabilityValue('measure_thermostat_setpoint_water_supply_temperature', cicStats.thermostat.otFtControlSetpoint)
        } catch (error) {
            this.homey.app.error(error);
        }
    }

    async registerTriggers() {
        for (const trigger of this.homey.manifest.flow.triggers) {
            let triggerCard = this.homey.flow.getTriggerCard(trigger.id);
            let triggerMappingExists = this.triggerMappings.get(trigger.id);

            if (triggerMappingExists) {
                triggerCard.registerRunListener(async (args, state) => {
                    let triggerMapping = this.triggerMappings.get(trigger.id);

                    if (!triggerMapping) {
                        this.log(`[Trigger Run Listener] - Trigger mapping not found for ${trigger.id}`);
                    }

                    let argumentName = triggerMapping!.get('argument') as string;
                    let argumentValue = args[argumentName];
                    let mappedValue = triggerMapping!.get(argumentValue);

                    if (!mappedValue) {
                        this.log(`[Trigger Run Listener] - Trigger mapping not found for ${trigger.id} and ${argumentValue}`);
                    }

                    this.log(`[Trigger Run Listener] Trigger mapping found for ${trigger.id} and '${argumentValue}' => ${mappedValue}. State => ${state.value}`);

                    return mappedValue === state.value;
                });
            }

            this.triggers.set(trigger.id, triggerCard);
        }
    }

    async setHeatPumpValues(hp: CicHeatpump, name?: string) {
        let suffix = ""
        if (name) {
            suffix = `.${name}`;
        }

        await this.safeSetCapabilityValue(`measure_heatpump_limited_by_cop${suffix}`, hp.limitedByCop);
        await this.safeSetCapabilityValue(`measure_heatpump_thermal_power${suffix}`, hp.power);
        await this.safeSetCapabilityValue(`measure_heatpump_silent_mode${suffix}`, hp.silentModeStatus)
        await this.safeSetCapabilityValue(`measure_heatpump_temperature_incoming_water${suffix}`, hp.temperatureWaterIn)
        await this.safeSetCapabilityValue(`measure_heatpump_temperature_outgoing_water${suffix}`, hp.temperatureWaterOut)
        await this.safeSetCapabilityValue(`measure_heatpump_temperature_outside${suffix}`, hp.temperatureOutside)
        await this.safeSetCapabilityValue(`measure_heatpump_working_mode${suffix}`, hp.getMainWorkingMode.toString())
    }

    async addCapabilities(capabilities: string[]) {
        if (!this.capabilitiesAdded) {
            for (const capability of capabilities) {
                await this.addCapabilityIfNotPresent(capability)
            }
        }
    }

    async addCapabilityIfNotPresent(capability: string) {
        if (!this.hasCapability(capability)) {
            await this.addCapability(capability);
        }
    }

    async setCapabilityValuesInterval(update_interval_seconds: number) {
        try {
            const refreshInterval = 1000 * update_interval_seconds;

            this.log(`[Device] ${this.getName()} - onPollInterval =>`, refreshInterval);
            this.onPollInterval = setInterval(this.setCapabilityValues.bind(this), refreshInterval);
        } catch (error: unknown) {
            await this.setUnavailable(JSON.stringify(error));
            this.log(error);
        }
    }

    async safeSetCapabilityValue(capability: string, newValue: any, delay: number = 10) {
        // "measure_boiler_domestic_hot_water_on"
        // "measure_heatpump_limited_by_cop.heatpump1"

        // this.log(`[Device] ${this.getName()} - setValue => ${capability} => `, newValue);

        if (this.hasCapability(capability)) {
            const triggerId = capability.replace('.', '_');
            const oldValue = await this.getCapabilityValue(capability);

            // this.homey.app.log(`[Device] ${this.getName()} - setValue - oldValue => ${capability} => `, oldValue, newValue);

            if (delay) {
                await this.sleep(delay);
            }

            try {
                await this.setCapabilityValue(capability, newValue);

                if (oldValue !== null && oldValue !== newValue) {
                    const triggerExists = this.triggers.get(`${triggerId}_changed`);

                    if (triggerExists) {
                        await this.homey.flow.getTriggerCard(`${triggerId}_changed`).trigger(undefined, {value: newValue})
                            .catch(this.error)
                            .then(
                                () => this.homey.app.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Triggered: "${triggerId} | ${newValue}"`),
                                (error: unknown) => this.homey.app.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Error: "${error} | ${newValue}"`)
                            )

                        // await this.homey.flow
                        //     .getDeviceTriggerCard(`${triggerId}_changed`)
                        //     .trigger(this)
                        //     .catch(this.error)
                        //     .then(this.homey.app.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Triggered: "${triggerId} | ${newValue}"`));
                    } else {
                        this.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Trigger not found: "${triggerId} | ${newValue}"`);
                    }
                }
            } catch (error: unknown) {
                this.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Error: "${triggerId} | ${newValue}"`);
            }
        }
    }

    async clearIntervals() {
        await clearInterval(this.onPollInterval);
    }

    async sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = QuattHeatpump;

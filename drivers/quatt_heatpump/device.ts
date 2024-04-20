import Homey, {FlowCardTrigger} from 'homey';
import {QuattClient} from "../../lib/quatt";
import {CicHeatpump} from "../../lib/quatt/cic-stats";

class QuattHeatpump extends Homey.Device {
    private quattClient!: QuattClient;
    private onPollInterval!: NodeJS.Timer;

    private capabilitiesAdded = false;
    private multipleHeatpumps = false;
    private singleHeatpumpCapabilities = [
        "measure_heatpump_cop",
        "measure_heatpump_limited_by_cop",
        "measure_heatpump_thermal_power",
        "measure_heatpump_silent_mode",
        "measure_heatpump_temperature_delta_water",
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
    private defaultWorkingModeTriggerMapping = new Map<string, string | boolean>([
        ['argument', 'workingMode'],
    ]);
    private triggerMappings = new Map([
        ['measure_boiler_central_heating_mode_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_cic_central_heating_on_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_cic_central_heating_onoff_boiler_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_domestic_hot_water_on_changed', this.defaultBooleanTriggerMapping],
        ['measure_boiler_flame_on_changed', this.defaultBooleanTriggerMapping],
        ['measure_heatpump_working_mode_changed', this.defaultWorkingModeTriggerMapping],
        ['measure_quality_control_supervisory_control_mode_changed', this.defaultWorkingModeTriggerMapping],
        ['measure_thermostat_cooling_on_changed', this.defaultBooleanTriggerMapping],
        ['measure_thermostat_domestic_hot_water_on_changed', this.defaultBooleanTriggerMapping],
        ['measure_thermostat_heating_on_changed', this.defaultBooleanTriggerMapping],
    ]);

    private triggers: Map<string, FlowCardTrigger> = new Map();

    /**
     * onInit is called when the device is initialized.
     */
    async onInit() {
        this.log('Quatt Heatpump has been initialized');
        this.quattClient = new QuattClient(this.homey.app.manifest.version, this.getStoreValue("address"));
        await this.registerTriggers();
        await this.registerConditionListeners();
        await this.setCapabilityValues();
        await this.setCapabilityValuesInterval(5);
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

            let promises = [];

            if (!cicStats.hp2) {
                promises.push(
                    this.addCapabilities(this.singleHeatpumpCapabilities),
                    this.setHeatPumpValues(cicStats.hp1),
                    this.safeSetCapabilityValue('measure_power', cicStats.hp1.powerInput)
                );
            } else {
                this.multipleHeatpumps = true;

                promises.push(
                    this.addCapabilities(this.multipleHeatpumpCapabilities),
                    this.setHeatPumpValues(cicStats.hp1, 'heatpump1'),
                    this.setHeatPumpValues(cicStats.hp2, 'heatpump2'),
                    this.safeSetCapabilityValue('measure_power', cicStats.hp1.powerInput + cicStats.hp2.powerInput)
                );
            }

            promises.push(
                this.safeSetCapabilityValue('measure_thermostat_room_temperature', cicStats.thermostat.otFtRoomTemperature),
                this.safeSetCapabilityValue('measure_boiler_central_heating_mode', cicStats.boiler.otFbChModeActive),
                this.safeSetCapabilityValue('measure_boiler_cic_central_heating_on', cicStats.boiler.otTbCH),
                this.safeSetCapabilityValue('measure_boiler_cic_central_heating_onoff_boiler', cicStats.boiler.oTtbTurnOnOffBoilerOn),
                this.safeSetCapabilityValue('measure_boiler_domestic_hot_water_on', cicStats.boiler.otFbDhwActive),
                this.safeSetCapabilityValue('measure_boiler_flame_on', cicStats.boiler.otFbFlameOn),
                this.safeSetCapabilityValue('measure_boiler_temperature_incoming_water', cicStats.boiler.otFbSupplyInletTemperature),
                this.safeSetCapabilityValue('measure_boiler_temperature_outgoing_water', cicStats.boiler.otFbSupplyOutletTemperature),
                this.safeSetCapabilityValue('measure_flowmeter_water_flow_speed', cicStats.qc.flowRateFiltered),
                this.safeSetCapabilityValue('measure_flowmeter_water_supply_temperature', cicStats.flowMeter.waterSupplyTemperature),
                this.safeSetCapabilityValue('measure_quality_control_supervisory_control_mode', cicStats.qc.supervisoryControlMode),
                this.safeSetCapabilityValue('measure_thermostat_cooling_on', cicStats.thermostat.otFtCoolingEnabled),
                this.safeSetCapabilityValue('measure_thermostat_domestic_hot_water_on', cicStats.thermostat.otFtDhwEnabled),
                this.safeSetCapabilityValue('measure_thermostat_heating_on', cicStats.thermostat.otFtChEnabled),
                this.safeSetCapabilityValue('measure_thermostat_room_temperature', cicStats.thermostat.otFtRoomTemperature),
                this.safeSetCapabilityValue('measure_thermostat_setpoint_room_temperature', cicStats.thermostat.otFtRoomSetpoint),
                this.safeSetCapabilityValue('measure_thermostat_setpoint_water_supply_temperature', cicStats.thermostat.otFtControlSetpoint)
            )

            await Promise.all(promises);
        } catch (error) {
            this.homey.app.error(error);
        }
    }

    async registerTriggers() {
        for (const trigger of this.homey.manifest.flow.triggers) {
            let triggerCard = this.homey.flow.getTriggerCard(trigger.id);
            let triggerArgs: string[] = trigger.args !== undefined ? trigger.args?.map((arg: any) => arg.name) : [];

            triggerCard.registerRunListener(async (args, state) => {
                // If this card does not allow any arguments to be passed as input, it should always continue
                if (!args) {
                    return true;
                }

                let allowsSelection = triggerArgs.includes('selection') && state.heatpumpNumber !== undefined;

                let triggerMapping = this.triggerMappings.get(trigger.id);
                let argumentName = triggerMapping?.get('argument') as string | undefined;

                if (argumentName) {
                    let argumentValue = args[argumentName];
                    // Get the mapping if present, otherwise take the identity
                    let mappedValue = triggerMapping!.get(argumentValue) || argumentValue;

                    this.log(`[Trigger Run Listener] Trigger mapping found for ${trigger.id} and '${argumentValue}' => ${mappedValue}. State => ${state.value}`);

                    if (allowsSelection) {
                        // Heatpump selection and mapped value comparison
                        return args['selection'] === state.heatpumpNumber && mappedValue === state.value;
                    } else {
                        // Mapped value comparison
                        return mappedValue === state.value;
                    }
                } else {
                    // Heatpump selection only
                    this.log(`[Trigger Run Listener] - Trigger mapping not found for ${trigger.id} => selection = ${args['selection']} => heatpump number = ${state.heatpumpNumber}`);

                    if (allowsSelection) {
                        // In case there are multiple heatpumps, the selection needs to be checked
                        return args['selection'] === state.heatpumpNumber;
                    } else {
                        // In case there is only one heatpump, the selection does not need to be checked
                        return true;
                    }
                }
            });

            this.triggers.set(trigger.id, triggerCard);
        }
    }

    async registerConditionListeners() {
        for (const condition of this.homey.manifest.flow.conditions) {
            let capabilityId = condition.id.replace('condition_', 'measure_').replace('_compare', '');
            let conditionCard = this.homey.flow.getConditionCard(condition.id);

            this.log(`[Condition] ${condition.id} => ${capabilityId}`)

            conditionCard.registerRunListener(async (args, state) => {
                let capabilityId = condition.id.replace('condition_', 'measure_').replace('_compare', '');
                let capabilityValues = await Promise.all(
                    condition.supportsMultipleHeatpumps === true && this.multipleHeatpumps ?
                        [this.getCapabilityValue(`${capabilityId}.heatpump1`), this.getCapabilityValue(`${capabilityId}.heatpump2`)] :
                        [this.getCapabilityValue(capabilityId)]);

                this.log(`[Condition] ${condition.id} => capability: ${capabilityId}, values: ${capabilityValues} => ${JSON.stringify(args)} => ${JSON.stringify(state)}`);

                if (typeof capabilityValues[0] === 'boolean') {
                    // On / off capabilities
                    this.log(`[Condition Listener] ${condition.id} => boolean => values = ${capabilityValues}`);

                    // TODO let people with Quatt DUO test this
                    if (capabilityValues.length > 1) {
                        if (args['selection'] === 'any') {
                            return capabilityValues.some((value) => value);
                        } else if (args['selection'] === 'all') {
                            return capabilityValues.every((value) => value);
                        } else if (args['selection'] === '1') {
                            return capabilityValues[0];
                        } else if (args['selection'] === '2') {
                            return capabilityValues[1];
                        }
                    } else {
                        return capabilityValues[0];
                    }
                } else if (typeof capabilityValues[0] === 'number') {
                    // Temperature / speed / power value greater than
                    this.log(`[Condition Listener] ${condition.id} => number => values = ${capabilityValues}`);

                    if (capabilityValues.length > 1) {
                        if (args['selection'] === 'any') {
                            return capabilityValues.some((value) => value > args['value']);
                        } else if (args['selection'] === 'all') {
                            return capabilityValues.every((value) => value > args['value']);
                        } else if (args['selection'] === '1') {
                            return capabilityValues[0] > args['value']
                        } else if (args['selection'] === '2') {
                            return capabilityValues[1] > args['value'];
                        }
                    } else {
                        return capabilityValues[0] > args['value'];
                    }
                } else if (typeof capabilityValues[0] === 'string') {
                    // List of values, e.g. quality control mode
                    this.log(`[Condition Listener] ${condition.id} => string => values = ${capabilityValues}`);

                    if (capabilityValues.length > 1) {
                        if (args['selection'] === 'any') {
                            return capabilityValues.some((value) => value === args['value']);
                        } else if (args['selection'] === 'all') {
                            return capabilityValues.every((value) => value === args['value']);
                        } else if (args['selection'] === '1') {
                            return capabilityValues[0] === args['value'];
                        } else if (args['selection'] === '2') {
                            return capabilityValues[1] === args['value'];
                        }
                    } else {
                        return capabilityValues[0] === args['value'];
                    }
                }

                return false;
            })
        }
    }

    async setHeatPumpValues(hp: CicHeatpump, name?: string) {
        if (!hp) {
            return;
        }

        let suffix = ""
        if (name) {
            suffix = `.${name}`;
        }

        return Promise.all([
            this.safeSetCapabilityValue(`measure_heatpump_cop${suffix}`, this.computeCoefficientOfPerformance(hp)),
            this.safeSetCapabilityValue(`measure_heatpump_limited_by_cop${suffix}`, hp.limitedByCop),
            this.safeSetCapabilityValue(`measure_heatpump_thermal_power${suffix}`, hp.power),
            this.safeSetCapabilityValue(`measure_heatpump_silent_mode${suffix}`, hp.silentModeStatus),
            this.safeSetCapabilityValue(`measure_heatpump_temperature_delta_water${suffix}`, this.computeWaterTemperatureDelta(hp)),
            this.safeSetCapabilityValue(`measure_heatpump_temperature_incoming_water${suffix}`, hp.temperatureWaterIn),
            this.safeSetCapabilityValue(`measure_heatpump_temperature_outgoing_water${suffix}`, hp.temperatureWaterOut),
            this.safeSetCapabilityValue(`measure_heatpump_temperature_outside${suffix}`, hp.temperatureOutside),
            this.safeSetCapabilityValue(`measure_heatpump_working_mode${suffix}`, hp.getMainWorkingMode)
        ]);
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

    async safeSetCapabilityValue(capability: string | undefined, newValue: any, delay: number = 10) {
        if (capability === undefined || newValue === undefined) {
            return;
        }

        // this.log(`[Device] ${this.getName()} - setValue => ${capability} => `, newValue);

        if (this.hasCapability(capability)) {
            // @ts-ignore FIXME cannot get the typing correct, since it requires a minimum of 2 elements
            const [triggerId, heatpump]: [string, string | undefined] = capability.split('.');
            const heatpumpNumber: string | undefined = heatpump?.replace('heatpump', '');
            const oldValue = await this.getCapabilityValue(capability);

            // this.homey.app.log(`[Device] ${this.getName()} - setValue - oldValue => ${capability} => `, oldValue, newValue);

            if (delay) {
                await this.sleep(delay);
            }

            try {
                await this.setCapabilityValue(capability, newValue);

                // If the trigger is one of the built-in capabilities, we don't need to trigger the event
                if (triggerId === 'measure_power') return;

                if (oldValue !== null && oldValue !== newValue) {
                    const triggerExists = this.triggers.get(`${triggerId}_changed`);

                    if (triggerExists) {
                        await this.homey.flow.getTriggerCard(`${triggerId}_changed`).trigger(undefined, {
                            value: newValue,
                            heatpumpNumber: heatpumpNumber
                        })
                            .catch(this.error)
                            .then(
                                () => this.homey.app.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Triggered: "${triggerId} | ${newValue}"`),
                                (error: unknown) => this.homey.app.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Error: "${error} | ${newValue}"`)
                            );
                    } else {
                        this.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Trigger not found: "${triggerId} | ${newValue}"`);
                    }
                }
            } catch (error: unknown) {
                this.log(`[Device] ${this.getName()} - setValue ${triggerId}_changed - Error: "${error} | ${newValue}"`);
            }
        }
    }

    async clearIntervals() {
        await clearInterval(this.onPollInterval);
    }

    computeWaterTemperatureDelta(hp: CicHeatpump): number | undefined {
        if (hp.temperatureWaterOut < hp.temperatureWaterIn) {
            return undefined;
        }
        return hp.temperatureWaterOut - hp.temperatureWaterIn
    }

    computeCoefficientOfPerformance(hp: CicHeatpump): number | undefined {
        return hp?.power / hp?.powerInput || undefined;
    }

    async sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = QuattHeatpump;

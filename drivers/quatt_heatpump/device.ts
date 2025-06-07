import Homey, {FlowCardTrigger} from 'homey';
import {QuattClient} from "../../lib/quatt";
import {CicHeatpump} from "../../lib/quatt/cic-stats";
import { QuattApiError } from "../../lib/quatt/errors"; // DeviceUnavailableError was unused

// Define an interface for device settings for stronger typing
interface QuattDeviceSettings {
    ipAddress: string; // This is a label in compose, but used as a setting key
    enableAutomaticIpDiscovery: boolean;
}

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
        await this.initDeviceSettings();
        await this.registerTriggers();
        await this.registerConditionListeners();
        await this.setCapabilityValues();
        await this.setCapabilityValuesInterval(5);
    }

    async initDeviceSettings() {
        // This method is intended to set the display values for settings shown to the user.
        // The 'ipAddress' setting in driver.compose.json is a 'label'.
        // We set its value to the IP address stored for this device.
        const currentIpAddress = this.getStoreValue('address');
        if (typeof currentIpAddress === 'string' && currentIpAddress) {
            this.log(`Initializing device settings display. IP Address Label: ${currentIpAddress}`);
            await this.setSettings({ ipAddress: currentIpAddress })
                .catch(err => this.error('Error setting ipAddress label in initDeviceSettings:', err));
        } else {
            this.log('No stored IP address found to display in settings label during init.');
            // Optionally set the label to a default or placeholder if no IP is stored yet
            await this.setSettings({ ipAddress: this.homey.__('pair.manual.ipAddressPlaceholder') })
                 .catch(err => this.error('Error setting placeholder ipAddress label in initDeviceSettings:', err));
        }
        // For 'enableAutomaticIpDiscovery', it's a checkbox with a default value in driver.compose.json.
        // Homey handles displaying its stored value automatically. We could explicitly set it if needed:
        // const autoDiscovery = this.getSetting('enableAutomaticIpDiscovery') ?? false; // Get current or default
        // await this.setSettings({ enableAutomaticIpDiscovery: autoDiscovery });
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded() {
        this.log('Quatt Heatpump has been added');
    }

    // FIXME this method is made up by Jules and does not exist in the Device interface.
    // async onSettings({ oldSettings, newSettings, changedKeys }: { oldSettings: QuattDeviceSettings; newSettings: QuattDeviceSettings; changedKeys: string[] }) {
    //     this.log('Quatt Heatpump settings changed');
    //     // Explicitly check for ipAddress key, which is used to store the current IP for the device by convention
    //     // even though it's a 'label' type in driver.compose.json.
    //     // The actual user-editable IP is typically handled during pairing or via a repair-like flow.
    //     // This onSettings handler is more for if the 'label' value were programmatically changed
    //     // or if other actual settings were changed.
    //     if (changedKeys.includes('ipAddress') && newSettings.ipAddress !== oldSettings.ipAddress) {
    //         this.log(`IP address setting (label) changed from ${oldSettings.ipAddress} to ${newSettings.ipAddress}. Re-initializing client and fetching data.`);
    //
    //         if (this.quattClient) {
    //             this.quattClient.setDeviceAddress(newSettings.ipAddress);
    //         }
    //         // It's crucial that the 'address' store value is the source of truth for the client's IP.
    //         // If ipAddress setting is just a label, changing it here might not be what users expect
    //         // unless pairing/repair flows also update this setting value.
    //         // For now, assume this setting change implies the store value should also update.
    //         await this.setStoreValue('address', newSettings.ipAddress);
    //
    //         await this.setAvailable();
    //         await this.setCapabilityValues();
    //     }
    //
    //     if (changedKeys.includes('enableAutomaticIpDiscovery')) {
    //         this.log(`Automatic IP Discovery setting changed to: ${newSettings.enableAutomaticIpDiscovery}`);
    //         // Future implementation for auto-discovery would go here
    //     }
    // }

    async setCapabilityValues() {
        try {
            // Ensure client is initialized (e.g. after settings change before onInit completes fully)
            if (!this.quattClient) {
                this.log('QuattClient not initialized, re-initializing with address from store:', this.getStoreValue("address"));
                this.quattClient = new QuattClient(this.homey.app.manifest.version, this.getStoreValue("address"));
            }

            const cicStats = await this.quattClient.getCicStats();

            if (!cicStats) {
                this.log('Unable to fetch data from Quatt CiC');
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
            // If successful, ensure device is marked as available
            if (!this.getAvailable()) {
                await this.setAvailable();
                this.log('Device became available.');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isNetworkError = errorMessage.includes('ECONNREFUSED') ||
                                   errorMessage.includes('EHOSTUNREACH') ||
                                   errorMessage.includes('ETIMEDOUT') ||
                                   errorMessage.includes('ENOTFOUND') || // Added ENOTFOUND
                                   errorMessage.includes('EAI_AGAIN');   // Added EAI_AGAIN

            if (error instanceof QuattApiError && isNetworkError) {
                this.log(`Suspected IP address change for device. Current IP: ${this.getStoreValue("address")}. QuattApiError: ${errorMessage}. Automatic re-discovery is not yet implemented. Setting device to unavailable.`);
                this.setUnavailable(this.homey.__('error.ipChangeSuspected')).catch(this.error);
            } else if (error instanceof QuattApiError) {
                this.log(`QuattApiError (not network related): ${errorMessage}`);
                this.setUnavailable(this.homey.__('error.apiError', { message: errorMessage })).catch(this.error);
            } else if (isNetworkError) { // Generic error that is a network issue
                this.log(`Network-related error: ${errorMessage}. Suspected IP address change for device. Current IP: ${this.getStoreValue("address")}. Setting device to unavailable.`);
                this.setUnavailable(this.homey.__('error.ipChangeSuspected')).catch(this.error);
            }
             else if (error instanceof Error) {
                this.log(`Generic error: ${errorMessage}`);
                this.setUnavailable(this.homey.__('error.unknownDeviceError', { message: errorMessage })).catch(this.error);
            } else {
                this.log('An unknown error occurred during setCapabilityValues');
                this.setUnavailable(this.homey.__('error.unknownError', { message: errorMessage })).catch(this.error); // Consider a generic unknown error key
            }
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
                    let mappedValue = triggerMapping!.get(argumentValue) ?? argumentValue;

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
            const refreshInterval = 1000 * update_interval_seconds; // TODO: Consider making this a setting

            this.log(`[Device] ${this.getName()} - Setting up polling interval: ${refreshInterval}ms`);
            this.onPollInterval = setInterval(this.setCapabilityValues.bind(this), refreshInterval);
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : this.homey.__('error.unknown');
            this.error(`Error setting up capability polling interval: ${errorMessage}`);
            await this.setUnavailable(errorMessage).catch(this.error);
            // No need to log error separately if this.error already does console.error
        }
    }

    async safeSetCapabilityValue(capabilityId: string, newValue: string | number | boolean | null | undefined, delay: number = 10) {
        // Removed undefined check for capabilityId as it should always be provided.
        // newValue can be null (e.g. when a sensor value is unknown)
        if (newValue === undefined) {
            this.log(`[Device] ${this.getName()} - safeSetCapabilityValue - skipping undefined newValue for ${capabilityId}`);
            return;
        }

        // this.log(`[Device] ${this.getName()} - safeSetCapabilityValue => ${capabilityId} => `, newValue);

        if (this.hasCapability(capabilityId)) {
            const parts = capabilityId.split('.');
            const triggerId: string = parts[0];
            // heatpumpSuffix will be like "heatpump1" or undefined
            const heatpumpSuffix: string | undefined = parts.length > 1 && parts[parts.length-1].startsWith('heatpump') ? parts[parts.length-1] : undefined;
            const heatpumpNumber: string | undefined = heatpumpSuffix?.replace('heatpump', '');

            const oldValue = this.getCapabilityValue(capabilityId);

            // this.homey.app.log(`[Device] ${this.getName()} - safeSetCapabilityValue - oldValue => ${capabilityId} => `, oldValue, newValue);

            if (delay > 0) { // Only sleep if delay is positive
                await this.sleep(delay);
            }

            try {
                await this.setCapabilityValue(capabilityId, newValue);

                // If the trigger is one of the built-in capabilities, we don't need to trigger the event
                // Also, ensure triggerId is not undefined (though it shouldn't be from split)
                if (triggerId && triggerId === 'measure_power') return;

                if (oldValue !== null && oldValue !== newValue) { // Ensure oldValue is not null before comparing
                    const flowTriggerId = `${triggerId}_changed`;
                    const triggerCard = this.triggers.get(flowTriggerId);

                    if (triggerCard) {
                        // this.log(`Triggering flow card: ${flowTriggerId} with value: ${newValue} for heatpump: ${heatpumpNumber || 'N/A'}`);
                        triggerCard.trigger(undefined, { // First arg is tokens, second is state
                            value: newValue, // Pass the new value to the flow
                            heatpumpNumber: heatpumpNumber // Pass heatpumpNumber to the flow state if applicable
                        })
                        .then(() => this.log(`[Device] ${this.getName()} - Flow triggered: "${flowTriggerId}" for value "${newValue}"`))
                        .catch(err => this.error(`[Device] ${this.getName()} - Error triggering flow "${flowTriggerId}":`, err));
                    } else {
                        // this.log(`[Device] ${this.getName()} - Flow trigger card not found for: "${flowTriggerId}"`);
                    }
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.error(`[Device] ${this.getName()} - Error setting capability value for ${capabilityId}: ${errorMessage}`);
                // Potentially set unavailable if critical, for now just logging.
                if (errorMessage.includes('invalid_capability') || errorMessage.includes('capability_not_found')) {
                    this.log(`Critical error setting capability ${capabilityId}: ${errorMessage}`);
                    // Example: this.setUnavailable(this.homey.__('error.capabilityError', { capability: capabilityId })).catch(this.error);
                }
            }
        } else {
            this.log(`[Device] ${this.getName()} - Attempted to set value for non-existent capability: ${capabilityId}`);
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
        return hp?.power / hp?.powerInput ?? undefined;
    }

    async sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = QuattHeatpump;

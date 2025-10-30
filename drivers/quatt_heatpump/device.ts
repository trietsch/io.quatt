import Homey, {FlowCardTrigger} from 'homey';
import {QuattClient} from "../../lib/quatt";
import {CicHeatpump, CicStats} from "../../lib/quatt/cic-stats";
import {QuattApiError} from "../../lib/quatt/errors"; // DeviceUnavailableError was unused
import {QuattLocator} from "../../lib/quatt/locator";
import {AppSettings} from "../../app";

// Define an interface for device settings for stronger typing
interface QuattDeviceSettings {
    ipAddress: string; // This is a label in compose, but used as a setting key
    enableAutomaticIpDiscovery: boolean;
    updateInterval: number; // Update interval in seconds (1-60)
}

class QuattHeatpump extends Homey.Device {
    private quattClient!: QuattClient;
    private onPollInterval!: NodeJS.Timer;

    private capabilitiesUpdated = false;
    private multipleHeatpumps = false;
    private defaultCapabilities = this.driver.manifest.capabilities;
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
        this.log('Initialization device: Quatt CiC');
        this.quattClient = new QuattClient(this.homey.app.manifest.version, this.getStoreValue("address"));
        await this.initDeviceSettings();
        await this.initCapabilities();
        await this.registerTriggers();
        await this.registerConditionListeners();
        await this.setCapabilityValues();

        // Get update interval from settings, default to 5 seconds if not set
        const settings = this.getSettings() as QuattDeviceSettings;
        const updateInterval = typeof settings.updateInterval === 'number' ? settings.updateInterval : 5;
        this.log(`Using update interval: ${updateInterval} seconds`);
        await this.setCapabilityValuesInterval(updateInterval);
    }

    async initDeviceSettings() {
        try {
            // Each device manages its own IP address in device.store
            const deviceIpAddress = this.getStoreValue('address');
            this.log(`Device initialized with IP address: ${deviceIpAddress}`);
        } catch (err) {
            this.log('Error initializing device settings:', err);
        }
    }

    async initCapabilities() {
        this.log('Initializing capabilities for Quatt Heatpump device');

        const cicStats = await this.quattClient.getCicStats();

        if (!cicStats) {
            this.log('Unable to fetch data from Quatt CiC for capabilities initialization');
            this.setUnavailable(this.homey.__('error.unableToConnectToDevice')).catch(this.error);
            return;
        }

        if (!this.capabilitiesUpdated) {
            if (!cicStats.hp2) {
                this.log('Single heatpump detected, adding single heatpump capabilities');
                await this.addCapabilities(this.singleHeatpumpCapabilities);
                await this.removeCapabilities(this.multipleHeatpumpCapabilities);
            } else {
                this.log('Multiple heatpumps detected, adding multiple heatpump capabilities');
                await this.addCapabilities(this.multipleHeatpumpCapabilities);
                await this.removeCapabilities(this.singleHeatpumpCapabilities);
            }
            await this.addCapabilities(this.defaultCapabilities);

            this.capabilitiesUpdated = true;
        }
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded() {
        this.log('Quatt Heatpump has been added');
    }


    // @ts-ignore typing is different indeed, but this way we have explicit typing
    async onSettings({oldSettings, newSettings, changedKeys}: {
        oldSettings: QuattDeviceSettings;
        newSettings: QuattDeviceSettings;
        changedKeys: string[]
    }) {
        this.log('Quatt Heatpump settings changed');

        if (changedKeys.includes('ipAddress') && newSettings.ipAddress !== oldSettings.ipAddress) {
            this.log(`IP address changed from ${oldSettings.ipAddress} to ${newSettings.ipAddress}. Trying new IP address directly.`);

            // Update client and device storage with new IP
            if (this.quattClient) {
                this.quattClient.setDeviceAddress(newSettings.ipAddress);
            }
            await this.setStoreValue('address', newSettings.ipAddress);

            // Try to connect to the manually entered IP address directly (without autodiscovery)
            await this.setAvailable();
            let success = await this.setCapabilityValuesWithoutAutodiscovery();

            if (!success) {
                this.log(`Unable to connect to manually entered IP ${newSettings.ipAddress}`);
                this.setUnavailable(this.homey.__('error.unableToConnectToDeviceWithManualIP', {ipAddress: newSettings.ipAddress})).catch(this.error);
            } else {
                this.log('Successfully connected to new IP address and updated capability values.');
            }
        }

        if (changedKeys.includes('updateInterval') && newSettings.updateInterval !== oldSettings.updateInterval) {
            this.log(`Update interval changed from ${oldSettings.updateInterval} to ${newSettings.updateInterval} seconds. Restarting polling.`);

            // Restart polling with new interval
            await this.setCapabilityValuesInterval(newSettings.updateInterval);
        }
    }

    async setCapabilityValuesWithoutAutodiscovery(): Promise<boolean> {
        try {
            const cicStats = await this.quattClient.getCicStats();

            if (!cicStats) {
                this.log('Unable to fetch data from Quatt CiC');
                return false;
            }

            return await this.updateAllCapabilities(cicStats);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.log(`Error fetching capability values: ${errorMessage}`);
            return false;
        }
    }

    async setCapabilityValues(): Promise<boolean> {
        if (!this.getAvailable()) {
            this.log('Device is not available, skipping capability value setting. Rediscovering device...');
            await this.rediscoverQuattCiC();
            return false; // If the device is not available, skip setting capability values
        }

        try {
            const cicStats = await this.quattClient.getCicStats();

            if (!cicStats) {
                this.log('Unable to fetch data from Quatt CiC');
                return false;
            }

            return await this.updateAllCapabilities(cicStats);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isNetworkError = errorMessage.includes('ECONNREFUSED') ||
                errorMessage.includes('EHOSTUNREACH') ||
                errorMessage.includes('ETIMEDOUT') ||
                errorMessage.includes('ENOTFOUND') ||
                errorMessage.includes('EAI_AGAIN');

            if ((error instanceof QuattApiError && isNetworkError) || isNetworkError) {
                this.log(`Suspected IP address change for device. Current IP: ${this.getStoreValue("address")}. Attempting re-discovery...`);
                this.setUnavailable(this.homey.__('error.ipChangeSuspected', {message: errorMessage})).catch(this.error);
                await this.rediscoverQuattCiC();

            } else if (error instanceof QuattApiError) {
                this.log(`QuattApiError (not network related): ${errorMessage}`);
                this.setUnavailable(this.homey.__('error.apiError', {message: errorMessage})).catch(this.error);
            } else if (error instanceof Error) {
                this.log(`Generic error: ${errorMessage}`);
                this.setUnavailable(this.homey.__('error.unknownDeviceError', {message: errorMessage})).catch(this.error);
            } else {
                this.log('An unknown error occurred during setCapabilityValues');
                this.setUnavailable(this.homey.__('error.unknownError', {message: errorMessage})).catch(this.error);
            }

            return false;
        }
    }

    async updateAllCapabilities(cicStats: CicStats): Promise<boolean> {
        let promises = [];

        if (!cicStats.hp2) {
            promises.push(
                this.setHeatPumpValues(cicStats.hp1),
                this.safeSetCapabilityValue('measure_power', cicStats.hp1.powerInput)
            );
        } else {
            this.multipleHeatpumps = true;

            promises.push(
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
            this.safeSetCapabilityValue('measure_boiler_water_pressure', cicStats.boiler.otFbWaterPressure),
            this.safeSetCapabilityValue('measure_flowmeter_water_flow_speed', cicStats.qc.flowRateFiltered),
            this.safeSetCapabilityValue('measure_flowmeter_water_supply_temperature', cicStats.flowMeter.waterSupplyTemperature),
            this.safeSetCapabilityValue('measure_quality_control_supervisory_control_mode', cicStats.qc.supervisoryControlMode),
            this.safeSetCapabilityValue('measure_thermostat_cooling_on', cicStats.thermostat.otFtCoolingEnabled),
            this.safeSetCapabilityValue('measure_thermostat_domestic_hot_water_on', cicStats.thermostat.otFtDhwEnabled),
            this.safeSetCapabilityValue('measure_thermostat_heating_on', cicStats.thermostat.otFtChEnabled),
            this.safeSetCapabilityValue('meter_heating_status', cicStats.thermostat.otFtChEnabled ? '🔥 Heating' : '❄️ Idle'),
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

        return true;
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
        for (const capability of capabilities) {
            await this.addCapabilityIfNotPresent(capability)
        }
    }

    async removeCapabilities(capabilities: string[]) {
        for (const capability of capabilities) {
            if (this.hasCapability(capability)) {
                this.log(`[Device] ${this.getName()} - Removing capability: ${capability}`);
                await this.removeCapability(capability);
            }
        }
    }

    async addCapabilityIfNotPresent(capability: string) {
        if (!this.hasCapability(capability)) {
            this.log(`[Device] ${this.getName()} - Adding capability: ${capability}`);
            await this.addCapability(capability);
        }
    }

    async setCapabilityValuesInterval(update_interval_seconds: number) {
        try {
            // Clear existing interval if it exists to prevent multiple intervals
            if (this.onPollInterval) {
                this.log(`[Device] ${this.getName()} - Clearing existing polling interval`);
                clearInterval(this.onPollInterval);
            }

            // Validate and clamp the update interval between 1 and 60 seconds
            const validatedInterval = Math.max(1, Math.min(60, update_interval_seconds));

            if (validatedInterval !== update_interval_seconds) {
                this.log(`[Device] ${this.getName()} - Update interval ${update_interval_seconds}s is out of range. Clamping to ${validatedInterval}s`);
            }

            const refreshInterval = 1000 * validatedInterval;

            this.log(`[Device] ${this.getName()} - Setting up polling interval: ${refreshInterval}ms (${validatedInterval} seconds)`);
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
            const heatpumpSuffix: string | undefined = parts.length > 1 && parts[parts.length - 1].startsWith('heatpump') ? parts[parts.length - 1] : undefined;
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

    private computeWaterTemperatureDelta(hp: CicHeatpump): number | undefined {
        if (hp.temperatureWaterOut < hp.temperatureWaterIn) {
            return undefined;
        }
        return hp.temperatureWaterOut - hp.temperatureWaterIn
    }

    private computeCoefficientOfPerformance(hp: CicHeatpump): number | undefined {
        return hp?.powerInput ? hp.power / hp.powerInput : undefined;
    }

    private async sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async rediscoverQuattCiC() {
        const newIp = await this.discoverDeviceOnSubnets();

        if (newIp) {
            this.log(`Device rediscovered at new IP: ${newIp}. Updating device.`);

            await this.setIPAddress(newIp);
            await this.setAvailable();
            await this.setCapabilityValues();
            return;
        } else {
            this.log('Device not found on any subnet. Setting device to unavailable.');
            this.setUnavailable(this.homey.__('error.unableToAutoDiscoverQuattCiC')).catch(this.error);
        }
    }

    private async setIPAddress(newIp: string) {
        this.log(`Updating device IP address to: ${newIp}`);
        await this.setStoreValue('address', newIp);
        if (this.quattClient) {
            this.quattClient.setDeviceAddress(newIp);
        } else {
            this.log('QuattClient not initialized, creating new client with IP:', newIp);
            this.quattClient = new QuattClient(this.homey.app.manifest.version, newIp);
        }
    }

    private async discoverDeviceOnSubnets() {
        // Get this device's last known IP from its own store as fallback
        const deviceIp = this.getStoreValue('address');
        const subnetBasedOnDeviceIp = deviceIp ? deviceIp.substring(0, deviceIp.lastIndexOf('.')) : null;

        let homeyAddress: string | null = null;

        try {
            homeyAddress = await this.homey.cloud.getLocalAddress();
            this.log(`Homey local address from getLocalAddress(): ${homeyAddress}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.error(`Error getting Homey local address: ${errorMessage}`);
        }

        // Extract subnet from Homey IP (format is "ip:port", e.g. "10.7.7.5:80")
        const subnetBasedOnHomeyIp = homeyAddress ? homeyAddress.split(':')[0].substring(0, homeyAddress.split(':')[0].lastIndexOf('.')) : null;
        this.log(`Subnets to scan - Homey subnet: ${subnetBasedOnHomeyIp}, Device last known subnet: ${subnetBasedOnDeviceIp}`);

        const subnets = new Set<string>([subnetBasedOnHomeyIp, subnetBasedOnDeviceIp].filter((x): x is string => x !== null));

        if (subnets.size === 0) {
            this.log('No valid IP address found for subnet scanning.');
            return null;
        } else {
            for (const subnet of subnets) {
                this.log(`Scanning subnet: ${subnet}`);

                const newIp = await this.scanSubnetForDevice(subnet);

                if (newIp) {
                    this.log(`Device rediscovered at new IP: ${newIp}`);
                    return newIp;
                } else {
                    this.log('No device found on the subnet.');
                }
            }
            return null;
        }
    }

    private async scanSubnetForDevice(subnet: string) {
        try {
            // Get this device's unique hostname/ID to ensure we find the correct CiC
            const deviceData = this.getData();
            const deviceHostname = deviceData.id || deviceData.hostname;

            if (!deviceHostname) {
                this.error('Device has no hostname stored in data, cannot verify correct CiC during rediscovery');
                return null;
            }

            this.log(`Scanning subnet ${subnet} for THIS device's CiC with hostname: ${deviceHostname}`);

            const locator = new QuattLocator(this.log.bind(this), this.homey.app.manifest.version);

            // Use the new findQuattByHostname method to find the SPECIFIC CiC by hostname
            // This ensures we don't accidentally connect to a different CiC in multi-device setups
            const result = await locator.findQuattByHostname(subnet, deviceHostname);

            if (result && result.ip) {
                this.log(`✓ Found the correct CiC at ${result.ip} with matching hostname: ${result.hostname}`);
                return result.ip;
            } else {
                this.log(`✗ Could not find CiC with hostname ${deviceHostname} on subnet ${subnet}`);
                return null;
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.log(`Error scanning subnet ${subnet}: ${errorMessage}`);
        }
        return null;
    }
}

module.exports = QuattHeatpump;

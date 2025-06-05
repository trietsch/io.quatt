import Homey, {FlowCardTrigger} from 'homey';
import {QuattClient} from "../../lib/quatt";
import {CicHeatpump} from "../../lib/quatt/cic-stats";

class QuattHeatpump extends Homey.Device {
    private quattClient!: QuattClient;
    private onPollInterval!: NodeJS.Timer;
    private isReconnecting: boolean = false;
    private reconnectionRetries: number = 3; // Max number of full reconnection cycles
    private reconnectionAttempt: number = 0; // Current attempt in a cycle, might not be needed if using loop index

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
        this.log(`Initializing Quatt Heatpump device: ${this.getName()} (ID: ${this.getData().id})`);
        this.log(`Current app version: ${this.homey.manifest.version}`);

        try {
            // Determine IP address (prioritize settings, then paired IP)
            const settingsIp = this.homey.settings.get('cicIPAddress');
            const pairedIp = this.getStoreValue("address");
            let targetIp: string | undefined;

            if (settingsIp) {
                this.log(`Using IP address from app settings for ${this.getName()}: ${settingsIp}`);
                targetIp = settingsIp;
            } else if (pairedIp) {
                this.log(`Using IP address from device pairing for ${this.getName()}: ${pairedIp}`);
                targetIp = pairedIp;
            }

            if (!targetIp) {
                const errMsg = this.homey.__('error.noIpConfiguredShort') || 'No IP address configured';
                this.error(`Initialization aborted for ${this.getName()}: ${errMsg} (checked app settings and device pairing).`);
                await this.setUnavailable(errMsg);
                return;
            }

            this.log(`Initializing QuattClient for ${this.getName()} with target IP: ${targetIp}`);
            this.quattClient = new QuattClient(this.homey.manifest.version, targetIp); // Use this.homey.manifest

            this.log(`Registering triggers for ${this.getName()}...`);
            await this.registerTriggers();
            this.log(`Registering condition listeners for ${this.getName()}...`);
            await this.registerConditionListeners();

            this.log(`Performing initial capability update for ${this.getName()}...`);
            await this.setCapabilityValues(); // Initial poll

            const updateIntervalSetting = this.getSetting('update_interval');
            const effectiveUpdateInterval = typeof updateIntervalSetting === 'number' && updateIntervalSetting >= 1 ? updateIntervalSetting : 5;
            this.log(`Setting up polling interval for ${this.getName()} to ${effectiveUpdateInterval} seconds.`);
            await this.setCapabilityValuesInterval(effectiveUpdateInterval);

            this.log(`Device ${this.getName()} initialization complete and polling started.`);
            if (!this.getAvailable()) {
                await this.setAvailable();
                this.log(`Device ${this.getName()} marked as available.`);
            }
        } catch (error: any) {
            const errMsg = error.message || 'Unknown error during initialization';
            this.error(`Fatal error during onInit for ${this.getName()}: ${errMsg}`);
            await this.setUnavailable(this.homey.__('error.initFailed', { message: errMsg }) || `Initialization failed: ${errMsg}`);
        }
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded() {
        this.log('Quatt Heatpump has been added');
    }

    async setCapabilityValues() {
        if (this.isReconnecting) {
            this.log(`[Poll] ${this.getName()}: Currently attempting to reconnect, skipping poll cycle.`);
            return;
        }
        this.log(`[Poll] ${this.getName()}: Starting capability values update.`);

        try {
            if (!this.quattClient) {
                this.error(`[Poll] ${this.getName()}: QuattClient not initialized. This should not happen if onInit completed successfully.`);
                if (!this.isReconnecting) {
                    this.log(`[Poll] ${this.getName()}: Triggering reconnection due to missing client.`);
                    this.isReconnecting = true; // Set before calling attemptReconnection
                    if (!await this.attemptReconnection()) {
                         await this.setUnavailable(this.homey.__('error.clientUnavailable', { deviceName: this.getName() }) || `Quatt client unavailable for ${this.getName()}, reconnection failed.`);
                         this.log(`[Poll] ${this.getName()}: Reconnection failed, client still not available.`);
                    } else {
                        this.log(`[Poll] ${this.getName()}: Reconnection successful, client is now available. Data will be fetched in next cycle.`);
                    }
                    // isReconnecting is reset within attemptReconnection
                }
                return;
            }

            const cicStats = await this.quattClient.getCicStats();

            if (!cicStats) {
                this.log(`[Poll] ${this.getName()}: No data (null/undefined) received from Quatt CIC.`);
                // Potentially trigger reconnection if this happens multiple times. For now, just a missed poll.
                return;
            }
            this.log(`[Poll] ${this.getName()}: Successfully fetched CIC stats.`);

            let promises: Promise<void>[] = [];

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

            // If successfully fetched data, ensure device is marked available
            if (!this.getAvailable()) {
                await this.setAvailable();
                this.log(`[Poll] ${this.getName()}: Device is connected and marked as available.`);
            }
            if (this.reconnectionAttempt > 0) { // If we were in a retry cycle for this successful poll
               this.log(`[Poll] ${this.getName()}: Successful poll after ${this.reconnectionAttempt} previous failed attempts in this cycle.`);
            }
            this.reconnectionAttempt = 0; // Reset reconnection attempts on successful poll
        } catch (error: any) {
            this.error(`[Poll] ${this.getName()}: Error fetching data (attempt ${this.reconnectionAttempt + 1}): ${error.message}`);

            const isConnectionError = error.code === 'ECONNREFUSED' ||
                                   error.code === 'ETIMEDOUT' ||
                                   error.code === 'EHOSTUNREACH' ||
                                   error.message.toLowerCase().includes('timeout') ||
                                   error.message.toLowerCase().includes('failed to connect');

            if (isConnectionError) {
                if (!this.isReconnecting) {
                    this.log(`[Poll] ${this.getName()}: Connection error detected, initiating reconnection process.`);
                    this.isReconnecting = true; // Set flag before starting
                    if (!await this.attemptReconnection()) { // isReconnecting is reset within this call
                        const unavailableMsg = this.homey.__('error.reconnectFailedMaxAttempts', { deviceName: this.getName(), retries: this.reconnectionRetries, error: error.message }) || `Failed to reconnect ${this.getName()} after ${this.reconnectionRetries} attempts. Last error: ${error.message}`;
                        await this.setUnavailable(unavailableMsg);
                        this.log(`[Poll] ${this.getName()}: ${unavailableMsg}`);
                    } else {
                        this.log(`[Poll] ${this.getName()}: Reconnection process completed successfully after error. Normal operation resumes.`);
                    }
                } else {
                    this.log(`[Poll] ${this.getName()}: Reconnection process already active, current error will be handled by it or next cycle.`);
                }
            } else {
                this.error(`[Poll] ${this.getName()}: Non-connection error during data fetch: ${error.message}`, error.code || '');
                // For critical non-connection errors, might set unavailable, but often these are parsing issues or unexpected data.
                // await this.setUnavailable(this.homey.__('error.processing', { deviceName: this.getName(), message: error.message }));
            }
        }
    }

    private async _testConnection(ip: string): Promise<string | null> {
        this.log(`[Reconnection] ${this.getName()}: Testing connection to IP: ${ip}`);
        try {
            const tempClient = new QuattClient(this.homey.manifest.version, ip);
            const stats = await tempClient.getCicStats(true); // Assuming getCicStats(true) is a quick check for connection verification
            if (stats && stats.system && stats.system.hostName) {
                this.log(`[Reconnection] ${this.getName()}: Successfully connected to ${ip}, hostname: ${stats.system.hostName}`);
                return stats.system.hostName;
            }
            this.log(`[Reconnection] ${this.getName()}: Connected to ${ip}, but response missing system/hostname. Not a valid Quatt CIC.`);
            return null;
        } catch (error: any) {
            this.error(`[Reconnection] ${this.getName()}: Failed to connect to ${ip}: ${error.message}`);
            return null;
        }
    }

    private async _updateClientWithNewIp(newIp: string, hostname: string) {
        this.log(`[Reconnection] ${this.getName()}: Updating QuattClient with new IP: ${newIp} (Hostname: ${hostname})`);
        try {
            this.quattClient = new QuattClient(this.homey.manifest.version, newIp);
            await this.setStoreValue("address", newIp);
            if(!this.getAvailable()) { // Only log if changing state
                await this.setAvailable();
                this.log(`[Reconnection] ${this.getName()}: QuattClient updated. Device IP set to ${newIp} and marked as available.`);
            } else {
                this.log(`[Reconnection] ${this.getName()}: QuattClient updated with IP ${newIp}. Device was already available.`);
            }
        } catch (storeError: any) {
            this.error(`[Reconnection] ${this.getName()}: Error updating stored IP or availability for ${newIp}: ${storeError.message}`);
            // This is a non-fatal error for the reconnection itself if client was updated, but good to know.
        }
    }

    private async _rediscoverDevice(): Promise<{ ip: string; hostname: string } | null> {
        this.log(`[Reconnection] ${this.getName()}: Attempting device rediscovery (simulated).`);
        // This is a placeholder. In a real app, this would involve:
        // 1. Using shared discovery logic (if `findQuattDevice` from driver is refactored into a lib).
        // 2. Or, emitting an event to the driver to perform discovery and somehow get the result back.
        //    This is complex due to async nature and inter-component communication.
        // For now, this will simulate failure.
        // To make this work, you'd need to call a method similar to the Driver's findQuattDevice.
        // Example (if findQuattDevice was part of this class or a utility):
        // try {
        //   const { ip, hostname } = await this.findQuattDeviceLogic(); // Fictional shared logic
        //   this.log(`[Reconnection] ${this.getName()}: Rediscovery successful: Found ${hostname} at ${ip}`);
        //   return { ip, hostname };
        // } catch (discoveryError: any) {
        //   this.error(`[Reconnection] ${this.getName()}: Rediscovery failed: ${discoveryError.message}`);
        //   return null;
        // }
        this.log(`[Reconnection] ${this.getName()}: Device rediscovery feature is a placeholder. Returning null.`);
        return null;
    }


    async attemptReconnection(): Promise<boolean> {
        // Ensure isReconnecting is true when this function is active.
        // It should be set by the caller before awaiting this.
        if (!this.isReconnecting) {
             this.log(`[Reconnection] ${this.getName()}: attemptReconnection called while isReconnecting is false. This might indicate an issue. Setting it true now.`);
             this.isReconnecting = true;
        }

        const delays = [30000, 60000, 120000]; // 30s, 1m, 2m

        for (let currentAttemptInCycle = 0; currentAttemptInCycle < this.reconnectionRetries; currentAttemptInCycle++) {
            // Note: this.reconnectionAttempt is for tracking across multiple poll cycles if needed,
            // currentAttemptInCycle is for the current active reconnection process.
            this.log(`[Reconnection] ${this.getName()}: Cycle Attempt ${currentAttemptInCycle + 1} of ${this.reconnectionRetries}...`);

            const settingsIp = this.homey.settings.get('cicIPAddress');
            if (settingsIp) {
                this.log(`[Reconnection] ${this.getName()}: Trying IP from app settings: ${settingsIp}`);
                const hostname = await this._testConnection(settingsIp);
                if (hostname) {
                    await this._updateClientWithNewIp(settingsIp, hostname);
                    this.isReconnecting = false;
                    this.reconnectionAttempt = 0; // Reset global attempt counter on success
                    return true;
                }
            }

            const pairedIp = this.getStoreValue("address");
            if (pairedIp && pairedIp !== settingsIp) {
                this.log(`[Reconnection] ${this.getName()}: Trying IP from device store: ${pairedIp}`);
                const hostname = await this._testConnection(pairedIp);
                if (hostname) {
                    await this._updateClientWithNewIp(pairedIp, hostname);
                    this.isReconnecting = false;
                    this.reconnectionAttempt = 0; // Reset global attempt counter on success
                    return true;
                }
            }

            // Placeholder for actual discovery
            // this.log(`[Reconnection] ${this.getName()}: Trying device rediscovery (placeholder)...`);
            // const discoveredDetails = await this._rediscoverDevice();
            // if (discoveredDetails) { ... }


            if (currentAttemptInCycle < this.reconnectionRetries - 1) {
                const delayMs = delays[currentAttemptInCycle] || delays[delays.length -1];
                this.log(`[Reconnection] ${this.getName()}: Cycle Attempt ${currentAttemptInCycle + 1} failed. Retrying in ${delayMs / 1000}s.`);
                await this.sleep(delayMs);
            }
        }

        this.log(`[Reconnection] ${this.getName()}: All ${this.reconnectionRetries} reconnection attempts in this cycle failed.`);
        this.isReconnecting = false; // Finished this cycle of attempts
        // this.reconnectionAttempt is not reset here, it's reset on a successful poll.
        // This allows setCapabilityValues to know if previous polls were also part of a failing sequence.
        return false;
    }

    async registerTriggers() {
        this.log(`Registering flow triggers for ${this.getName()}.`);
        for (const trigger of this.homey.manifest.flow.triggers) {
            let triggerCard = this.homey.flow.getTriggerCard(trigger.id);
            let triggerArgs: string[] = trigger.args !== undefined ? trigger.args?.map((arg: any) => arg.name) : [];

            triggerCard.registerRunListener(async (args, state) => {
                if (!args) {
                    this.log(`[Trigger ${trigger.id}] Running (no args) for ${this.getName()}.`);
                    return true;
                }
                this.log(`[Trigger ${trigger.id}] Evaluating for ${this.getName()} with args: ${JSON.stringify(args)}, state: ${JSON.stringify(state)}`);
                try {
                    let allowsSelection = triggerArgs.includes('selection') && state.heatpumpNumber !== undefined;
                    let triggerMapping = this.triggerMappings.get(trigger.id);
                    let argumentName = triggerMapping?.get('argument') as string | undefined;

                    if (argumentName) {
                        let argumentValue = args[argumentName];
                        let mappedValue = triggerMapping!.get(argumentValue) ?? argumentValue;
                        let result: boolean;
                        if (allowsSelection) {
                            result = args['selection'] === state.heatpumpNumber && mappedValue === state.value;
                        } else {
                            result = mappedValue === state.value;
                        }
                        this.log(`[Trigger ${trigger.id}] For ${this.getName()}, mapped '${argumentName}' from '${argumentValue}' to '${mappedValue}'. Expected state value: '${state.value}'. Allows selection: ${allowsSelection}. Result: ${result}`);
                        return result;
                    } else {
                        if (allowsSelection) {
                            const result = args['selection'] === state.heatpumpNumber;
                            this.log(`[Trigger ${trigger.id}] For ${this.getName()}, no argument mapping, selection only. Result: ${result}`);
                            return result;
                        } else {
                            this.log(`[Trigger ${trigger.id}] For ${this.getName()}, no argument mapping and no selection. Defaulting to true.`);
                            return true;
                        }
                    }
                } catch (runError: any) {
                    this.error(`[Trigger ${trigger.id}] Error during run listener for ${this.getName()}: ${runError.message}`);
                    return false;
                }
            });
            this.triggers.set(trigger.id, triggerCard);
        }
    }

    async registerConditionListeners() {
        this.log(`Registering flow condition listeners for ${this.getName()}.`);
        for (const condition of this.homey.manifest.flow.conditions) {
            const capabilityId = condition.id.replace('condition_', 'measure_').replace('_compare', '');
            const conditionCard = this.homey.flow.getConditionCard(condition.id);
            this.log(`[Condition] ${this.getName()}: Registering listener for ${condition.id} (cap: ${capabilityId})`);

            conditionCard.registerRunListener(async (args, state) => {
                const localCapId = condition.id.replace('condition_', 'measure_').replace('_compare', '');
                this.log(`[Condition ${condition.id}] Evaluating for ${this.getName()} with args: ${JSON.stringify(args)}, state: ${JSON.stringify(state)} (cap: ${localCapId})`);
                try {
                    let capabilityValues = await Promise.all(
                        condition.supportsMultipleHeatpumps === true && this.multipleHeatpumps ?
                            [this.getCapabilityValue(`${localCapId}.heatpump1`), this.getCapabilityValue(`${localCapId}.heatpump2`)] :
                            [this.getCapabilityValue(localCapId)]);

                    if (capabilityValues.some(v => v === null || v === undefined)) {
                        this.log(`[Condition ${condition.id}] ${this.getName()}: One or more capability values are null/undefined. Condition evaluates to false.`);
                        return false;
                    }

                    let result = false;
                    const argValue = args['value']; // Value from the condition card argument

                    if (typeof capabilityValues[0] === 'boolean') {
                        // For boolean conditions, typically there's no 'value' arg from card, it's implicit true/false.
                        // The structure { "titleFormatted": { "en": "CV is !{{heating|not heating}}" } } implies the check is against 'true'.
                        // If a boolean capability is checked, it's usually if it IS true.
                        // Assuming the comparison is implicitly against 'true' unless the card implies otherwise.
                        // This part might need adjustment based on how Homey structures boolean conditions with args.
                        // For now, let's assume a direct check if the capability is true, or if 'value' arg is provided.
                        const compareValue = (typeof argValue === 'boolean') ? argValue : true;
                        if (capabilityValues.length > 1 && args['selection']) {
                            if (args['selection'] === 'any') result = capabilityValues.some(v => v === compareValue);
                            else if (args['selection'] === 'all') result = capabilityValues.every(v => v === compareValue);
                            else if (args['selection'] === '1') result = capabilityValues[0] === compareValue;
                            else if (args['selection'] === '2') result = capabilityValues[1] === compareValue;
                        } else {
                            result = capabilityValues[0] === compareValue;
                        }
                    } else if (typeof capabilityValues[0] === 'number' && typeof argValue === 'number') {
                        if (capabilityValues.length > 1 && args['selection']) {
                            if (args['selection'] === 'any') result = capabilityValues.some(v => v > argValue);
                            else if (args['selection'] === 'all') result = capabilityValues.every(v => v > argValue);
                            else if (args['selection'] === '1') result = capabilityValues[0] > argValue;
                            else if (args['selection'] === '2') result = capabilityValues[1] > argValue;
                        } else {
                            result = capabilityValues[0] > argValue;
                        }
                    } else if (typeof capabilityValues[0] === 'string' && typeof argValue === 'string') { // Enum
                        if (capabilityValues.length > 1 && args['selection']) {
                            if (args['selection'] === 'any') result = capabilityValues.some(v => v === argValue);
                            else if (args['selection'] === 'all') result = capabilityValues.every(v => v === argValue);
                            else if (args['selection'] === '1') result = capabilityValues[0] === argValue;
                            else if (args['selection'] === '2') result = capabilityValues[1] === argValue;
                        } else {
                            result = capabilityValues[0] === argValue;
                        }
                    } else {
                        this.log(`[Condition ${condition.id}] ${this.getName()}: Type mismatch or unhandled types. Capability type: ${typeof capabilityValues[0]}, Argument type: ${typeof argValue}`);
                    }
                    this.log(`[Condition ${condition.id}] ${this.getName()}: Result: ${result}`);
                    return result;
                } catch (runError: any) {
                    this.error(`[Condition ${condition.id}] Error during run listener for ${this.getName()}: ${runError.message}`);
                    return false;
                }
            })
        }
    }

    async setHeatPumpValues(hp: CicHeatpump, name?: string) {
        if (!hp) {
            this.log(`[SetHPValues] ${this.getName()}: No heatpump data provided for ${name || 'default'}. Skipping.`);
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
            this.log(`Adding capability for ${this.getName()}: ${capability}`);
            try {
                await this.addCapability(capability);
            } catch (err: any) {
                this.error(`Error adding capability ${capability} for ${this.getName()}: ${err.message}`);
            }
        }
    }

    async setCapabilityValuesInterval(update_interval_seconds: number) {
        this.log(`[Polling] Setting up polling interval for ${this.getName()} to ${update_interval_seconds} seconds.`);
        try {
            const refreshInterval = 1000 * update_interval_seconds;
            if (this.onPollInterval) {
                clearInterval(this.onPollInterval);
                this.log(`[Polling] Cleared existing polling interval for ${this.getName()}.`);
            }
            this.onPollInterval = setInterval(async () => { // Added async here
                // Polling logic will be enhanced later with reconnection
                await this.setCapabilityValues();
            }, refreshInterval);
            this.log(`[Polling] Polling interval set for ${this.getName()}.`);
        } catch (error: any) {
            this.error(`[Polling] Error setting up polling interval for ${this.getName()}: ${error.message}`);
            await this.setUnavailable(this.homey.__('error.pollingSetupFailed', { deviceName: this.getName(), message: error.message }) || `Polling setup failed: ${error.message}`);
        }
    }

    // onDeleted is called when the user removes the device.
    async onDeleted() {
        this.log(`Device ${this.getName()} has been deleted, clearing intervals.`);
        if (this.onPollInterval) {
            clearInterval(this.onPollInterval);
        }
    }

    async safeSetCapabilityValue(capability: string | undefined, newValue: any, delay: number = 10) {
        if (capability === undefined || newValue === undefined) {
            this.log(`[SafeSet] ${this.getName()}: Skipping set for ${capability} due to undefined value.`);
            return;
        }

        if (this.hasCapability(capability)) {
            const oldValue = await this.getCapabilityValue(capability);

            if (delay) {
                await this.sleep(delay);
            }

            try {
                await this.setCapabilityValue(capability, newValue);
                // this.log(`[SafeSet] ${this.getName()}: Successfully set ${capability} to ${newValue}. Old value was ${oldValue}.`);


                let insightValue: number | undefined;
                if (typeof newValue === 'number') {
                    insightValue = newValue;
                } else if (typeof newValue === 'boolean') {
                    insightValue = newValue ? 1 : 0;
                } else if (typeof newValue === 'string') {
                    const parsedNum = parseFloat(newValue);
                    if (!isNaN(parsedNum)) {
                        insightValue = parsedNum;
                    }
                }

                if (insightValue !== undefined) {
                    this.homey.insights.createEntry(capability, insightValue)
                        .catch(err => {
                            this.error(`Error logging insight for ${capability} on ${this.getName()}: ${err.message}`);
                        });
                }

                if (oldValue !== null && oldValue !== newValue) {
                    const triggerId = capability.split('.')[0]; // Base capability ID for trigger
                    const heatpumpNumberSuffix = capability.split('.')[1]; // e.g., 'heatpump1' or undefined

                    const triggerCardId = `${triggerId}_changed`;
                    const triggerExists = this.triggers.get(triggerCardId);

                    if (triggerExists) {
                        // this.log(`[FlowTrigger] ${this.getName()}: Triggering ${triggerCardId} for capability ${capability}. New: ${newValue}, Old: ${oldValue}`);
                        await triggerExists.trigger(this, { // Pass device instance
                            value: newValue,
                            heatpumpNumber: heatpumpNumberSuffix?.replace('heatpump', '') // '1' or '2' or undefined
                        })
                            .catch(err => this.error(`[FlowTrigger] ${this.getName()}: Error for ${triggerCardId} on cap ${capability}: ${err.message}`))
                            // .then(() => this.log(`[FlowTrigger] ${this.getName()}: ${triggerCardId} completed for ${capability}.`)) // Verbose
                            ;
                    }
                }
            } catch (error: any) {
                this.error(`[SafeSet] ${this.getName()}: Error for cap ${capability} with value ${newValue}: ${error.message}`);
            }
        } else {
            this.log(`[SafeSet] ${this.getName()}: Attempted to set value for non-existent capability: ${capability}`);
        }
    }

    async clearIntervals() { // Added for completeness if needed, though onDeleted handles the main poll interval
        this.log(`[Intervals] Clearing intervals for ${this.getName()}.`);
        if (this.onPollInterval) {
            clearInterval(this.onPollInterval);
        }
    }

    computeWaterTemperatureDelta(hp: CicHeatpump): number | undefined {
        if (hp.temperatureWaterOut < hp.temperatureWaterIn) {
            return undefined;
        }
        return hp.temperatureWaterOut - hp.temperatureWaterIn
    }

    computeCoefficientOfPerformance(hp: CicHeatpump): number | undefined {
        if (hp && typeof hp.power === 'number' && typeof hp.powerInput === 'number') {
            if (hp.powerInput !== 0) {
                return parseFloat((hp.power / hp.powerInput).toFixed(2)); // Rounded to 2 decimal places
            } else {
                if (hp.power > 0) {
                    this.log(`[Compute] COP for ${this.getName()}: powerInput is 0 but power is ${hp.power}, returning Infinity.`);
                    return Infinity;
                }
                this.log(`[Compute] COP for ${this.getName()}: powerInput and power are 0, returning 0.`);
                return 0;
            }
        }
        this.log(`[Compute] Invalid or missing values for COP calculation for ${this.getName()}: power=${hp?.power}, powerInput=${hp?.powerInput}`);
        return undefined;
    }

    async sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

module.exports = QuattHeatpump;

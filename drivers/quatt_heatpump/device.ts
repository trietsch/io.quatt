import Homey from 'homey';
import axios from 'axios';
import {CicStats} from './cic-stats';

class QuattHeatpump extends Homey.Device {

    /**
     * onInit is called when the device is initialized.
     */
    async onInit() {
        this.log('QuattHeatpump has been initialized');
        await this.setCapabilityValues();
    }

    /**
     * onAdded is called when the user adds the device, called just after pairing.
     */
    async onAdded() {
        this.log('QuattHeatpump has been added');
    }

    /**
     * onSettings is called when the user updates the device's settings.
     * @param {object} event the onSettings event data
     * @param {object} event.oldSettings The old settings object
     * @param {object} event.newSettings The new settings object
     * @param {string[]} event.changedKeys An array of keys changed since the previous version
     * @returns {Promise<string|void>} return a custom message that will be displayed
     */
    async onSettings({
                         oldSettings,
                         newSettings,
                         changedKeys,
                     }: {
        oldSettings: { [key: string]: boolean | string | number | undefined | null };
        newSettings: { [key: string]: boolean | string | number | undefined | null };
        changedKeys: string[];
    }): Promise<string | void> {
        this.log('QuattHeatpump settings where changed');
    }

    /**
     * onRenamed is called when the user updates the device's name.
     * This method can be used this to synchronise the name to the device.
     * @param {string} name The new name
     */
    async onRenamed(name: string) {
        this.log('QuattHeatpump was renamed');
    }

    /**
     * onDeleted is called when the user deleted the device.
     */
    async onDeleted() {
        this.log('QuattHeatpump has been deleted');
    }

    async fetchQuattData(): Promise<CicStats> {
        try {
            const response = await axios.get('http://192.168.1.204:8080/beta/feed/data.json');
            return response.data as CicStats;
        } catch (error) {
            this.log(error);
            throw (error);
        }
    }

    async setCapabilityValues() {
        this.homey.app.log(`[Device] ${this.getName()} - setCapabilityValues`);

        try {
            const settings = this.getSettings();
            const deviceInfo = await this.fetchQuattData();

            this.homey.app.log(`[Device] ${this.getName()} - deviceInfo =>`, deviceInfo.system.hostName);
            this.homey.app.log(`[Device] ${this.getName()} - settings =>`, settings);
            this.homey.app.log(`[Device] ${this.getName()} - deviceInfo =>`, JSON.stringify(deviceInfo));

            // // Check for existence
            // const pump0 = await this.getComponent('PUMP', components, '0');
            // const pump1 = await this.getComponent('PUMP', components, '1');
            // const pump2 = await this.getComponent('PUMP', components, '2');
            // const blower0 = await this.getComponent('BLOWER', components, '0');
            // const blower1 = await this.getComponent('BLOWER', components, '1');
            // const blower2 = await this.getComponent('BLOWER', components, '2');
            // const circulationPump = await this.getComponent('CIRCULATION_PUMP', components);
            // const heater = await this.getComponent('HEATER', components);
            // const ozone = await this.getComponent('OZONE', components);
            //
            // if (check) {
            //     if (pump0) await this.addCapability('action_pump_state');
            //     if (pump1) await this.addCapability('action_pump_state.1');
            //     if (pump2) await this.addCapability('action_pump_state.2');
            //     if (blower0) await this.addCapability('action_blower_state');
            //     if (blower1) await this.addCapability('action_blower_state.1');
            //     if (blower2) await this.addCapability('action_blower_state.2');
            // }
            //
            // // ------------ Get values --------------
            // const light = await this.getComponentValue('LIGHT', components);
            // const tempRangeHigh = (tempRange === 'HIGH');
            // const tempRangeLow = (tempRange === 'LOW');
            // const heaterReady = (heaterMode === 'READY');
            // const runModeReady = (runMode === 'Ready'); // deprecated
            //
            // if (tempRangeHigh) {
            //     this.setCapabilityOptions('target_temperature', {
            //         min: toCelsius(setupParams.highRangeLow),
            //         max: toCelsius(setupParams.highRangeHigh)
            //     });
            // } else if (tempRangeLow) {
            //     this.setCapabilityOptions('target_temperature', {
            //         min: toCelsius(setupParams.lowRangeLow),
            //         max: toCelsius(setupParams.lowRangeHigh)
            //     });
            // }
            //
            // if (pump0) {
            //     const pump0_val = pump0.value === 'HIGH';
            //     await this.setValue('action_pump_state', pump0_val, check);
            // }
            // if (pump1) {
            //     const pump1_val = pump1.value === 'HIGH';
            //     await this.setValue('action_pump_state.1', pump1_val, check);
            // }
            // if (pump2) {
            //     const pump2_val = pump2.value === 'HIGH';
            //     await this.setValue('action_pump_state.2', pump2_val, check);
            // }
            // if (blower0) {
            //     const blower0_val = blower0.value === 'HIGH';
            //     await this.setValue('action_blower_state', blower0_val, check);
            // }
            // if (blower1) {
            //     const blower1_val = blower1.value === 'HIGH';
            //     await this.setValue('action_blower_state.1', blower1_val, check);
            // }
            // if (blower2) {
            //     const blower2_val = blower2.value === 'HIGH';
            //     await this.setValue('action_blower_state.2', blower2_val, check);
            // }
            // if (heater) {
            //     await this.setValue('measure_heater', heater.value, check);
            // }
            //
            // if (circulationPump) {
            //     await this.setValue('measure_circulation_pump', circulationPump.value, check);
            // }
            //
            // if (ozone) {
            //     await this.setValue('measure_ozone', ozone.value, check);
            // }
            //
            // await this.setValue('action_update_data', false, check);
            // await this.setValue('locked', panelLock, check);
            // await this.setValue('action_light_state', light, check);
            // await this.setValue('action_heater_mode', heaterReady, check);
            // await this.setValue('action_temp_range', tempRangeHigh, check);
            // await this.setValue('measure_temperature_range', tempRange, check);
            // await this.setValue('measure_heater_mode', heaterMode, check);
            // await this.setValue('measure_online', online, check);
            // await this.setValue('measure_runmode', runModeReady, check);
            //
            // if (currentTemp) await this.setValue('measure_temperature', toCelsius(currentTemp), check, 10, settings.round_temp);
            // // If desiredTemp is available, compare it to targetDesiredTemp. There should be 0.4 difference for valid value.
            // // Use also desiredTemp when targetDesiredTemp is at highRangeHigh or lowRangeLow, when tempRange was changed.
            // // Fallback to targetDesiredTemp and helps desireTemp is not available or update is delayed in the device API.
            // // Values neet to be Number for the strict comparison.
            // targetDesiredTemp = Number(targetDesiredTemp);
            // desiredTemp = Number(desiredTemp);
            // if (desiredTemp && ((targetDesiredTemp === desiredTemp + 0.4) || targetDesiredTemp === setupParams.highRangeHigh || targetDesiredTemp == setupParams.lowRangeLow)) {
            //     await this.setValue('target_temperature', toCelsius(desiredTemp), check, 10, settings.round_temp);
            // } else {
            //     await this.setValue('target_temperature', toCelsius(targetDesiredTemp - 0.4), check, 10, settings.round_temp);
            // }
            //
            // // Set Spa clock if spa is online and clock_sync is enabled.
            // // - timeNotSet: true if time is not set in the spa
            // // - military: true if 24h clock is used in the spa
            // // - settings.clock_24: true if 24h clock is set by user in Homey
            // // - time difference between spa and Homey is more than 5 minutes
            // const timeNow = new Date();
            // const myTZ = this.homey.clock.getTimezone();
            // const myTime = timeNow.toLocaleString('en-US', {
            //     hour: '2-digit',
            //     minute: '2-digit',
            //     hour12: false,
            //     timeZone: myTZ
            // });
            // const myDate = timeNow.toLocaleString('en-US', {
            //     day: '2-digit',
            //     month: '2-digit',
            //     year: 'numeric',
            //     timeZone: myTZ
            // });
            // const myTimeMinutes = Number(myTime.split(':')[0]) * 60 + Number(myTime.split(':')[1]);
            // const spaTimeMinutes = (hour * 60) + minute;
            //
            // if ((online && settings.clock_sync) && (timeNotSet || military !== settings.clock_24 || (Math.abs(spaTimeMinutes - myTimeMinutes) > 5))) {
            //     this.homey.app.log(`[Device] ${this.getName()} - setClock ${myDate} ${myTime} ${myTZ} clock_24=${settings.clock_24}`);
            //     await this._controlMySpaClient.setTime(myDate, myTime, settings.clock_24);
            // } else {
            //     this.homey.app.log(`[Device] ${this.getName()} - setClock - clock sync disabled or clock is in sync.`);
            // }
        } catch (error) {
            this.homey.app.error(error);
        }
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

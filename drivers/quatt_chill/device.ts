import Homey from 'homey';
import {QuattChill, QuattRemoteApiClient, QuattTokens} from '../../lib/quatt';

interface QuattChillDeviceSettings {
    updateInterval: number;
}

class QuattChillDevice extends Homey.Device {
    private remoteClient: QuattRemoteApiClient | null = null;
    private onPollInterval: NodeJS.Timer | null = null;
    private chillUuid: string | null = null;
    private chillStatusChangedTrigger: any = null;
    private chillErrorDetectedTrigger: any = null;
    private chillTankFullDetectedTrigger: any = null;

    async onInit() {
        this.log('Initialization device: Quatt Chill');

        this.chillUuid = this.getStoreValue('chillUuid') as string | null;
        const remoteTokens = this.getStoreValue('remoteTokens') as QuattTokens | undefined;
        const remoteCicId = this.getStoreValue('remoteCicId') as string | undefined;
        const remoteInstallationId = this.getStoreValue('remoteInstallationId') as string | undefined;

        if (!this.chillUuid || !remoteTokens || !remoteCicId || !remoteInstallationId) {
            await this.setUnavailable('Quatt Chill is nog niet gekoppeld. Voeg hem opnieuw toe vanuit een Quatt met Remote Control.').catch(this.error);
            return;
        }

        this.remoteClient = new QuattRemoteApiClient(
            this.homey.app.manifest.version,
            remoteTokens,
            remoteCicId,
            remoteInstallationId
        );

        await this.migrateCapabilities();
        await this.registerCapabilityListeners();
        await this.registerFlowActions();
        await this.updateChillCapabilities();

        const settings = this.getSettings() as QuattChillDeviceSettings;
        const updateInterval = typeof settings.updateInterval === 'number' ? settings.updateInterval : 30;
        this.setCapabilityValuesInterval(updateInterval);
    }

    async onDeleted() {
        if (this.onPollInterval) {
            this.homey.clearInterval(this.onPollInterval);
            this.onPollInterval = null;
        }
    }

    // @ts-ignore typing is different in the SDK types
    async onSettings({oldSettings, newSettings, changedKeys}: {
        oldSettings: QuattChillDeviceSettings;
        newSettings: QuattChillDeviceSettings;
        changedKeys: string[];
    }) {
        if (changedKeys.includes('updateInterval') && newSettings.updateInterval !== oldSettings.updateInterval) {
            this.setCapabilityValuesInterval(newSettings.updateInterval);
        }
    }

    private async migrateCapabilities() {
        const requiredCapabilities = ['measure_temperature', 'target_temperature', 'chill_water_tank_status', 'alarm_chill_disconnected'];
        for (const capability of requiredCapabilities) {
            if (!this.hasCapability(capability)) {
                await this.addCapability(capability).catch(this.error);
            }
        }

        // Oude beta capabilities netjes weghalen zodra de standaard Homey capabilities aanwezig zijn.
        const oldCapabilities = [
            'measure_chill_ambient_temperature',
            'target_temperature.chill_cooling',
            'target_temperature.chill_heating',
            'measure_chill_fan_mode',
            'measure_power',
            'alarm_chill_tank_full',
            'alarm_chill_tank_missing',
        ];
        for (const capability of oldCapabilities) {
            if (this.hasCapability(capability)) {
                await this.removeCapability(capability).catch(this.error);
            }
        }
    }

    private setCapabilityValuesInterval(updateIntervalSeconds: number) {
        if (this.onPollInterval) {
            this.homey.clearInterval(this.onPollInterval);
        }

        this.onPollInterval = this.homey.setInterval(async () => {
            await this.updateChillCapabilities();
        }, updateIntervalSeconds * 1000);
    }

    private async registerCapabilityListeners() {
        this.registerCapabilityListener('onoff', async (value) => {
            await this.sendChillAction({type: 'SET_ON_OFF', on: Boolean(value)}, 'Unable to switch Quatt Chill');
            await this.updateChillCapabilities();
        });

        this.registerCapabilityListener('target_temperature', async (value) => {
            const mode = String(this.getCapabilityValue('chill_mode') || 'COOLING');
            if (mode === 'HEATING') {
                await this.sendChillAction({
                    type: 'SET_HEATING_TARGET_TEMPERATURE',
                    heatingTargetTemperature: Number(value)
                }, 'Unable to set Chill heating target');
            } else {
                await this.sendChillAction({
                    type: 'SET_COOLING_TARGET_TEMPERATURE',
                    coolingTargetTemperature: Number(value)
                }, 'Unable to set Chill cooling target');
            }
            await this.updateChillCapabilities();
        });

        this.registerCapabilityListener('chill_fan_mode', async (value) => {
            await this.sendChillAction({type: 'SET_FAN_MODE', fanMode: this.normalizeFanModeForApi(String(value))}, 'Unable to set Chill fan mode');
            await this.updateChillCapabilities();
        });

        this.registerCapabilityListener('chill_mode', async (value) => {
            await this.sendChillAction({type: 'SET_MODE', mode: this.normalizeModeForApi(String(value))}, 'Unable to set Chill mode');
            await this.updateChillCapabilities();
        });
    }

    private async registerFlowActions() {
        this.chillStatusChangedTrigger = this.getOptionalDeviceTriggerCard('chill_status_changed');
        this.chillErrorDetectedTrigger = this.getOptionalDeviceTriggerCard('chill_error_detected');
        this.chillTankFullDetectedTrigger = this.getOptionalDeviceTriggerCard('chill_tank_full_detected');

        this.registerFlowAction('set_chill_fan_mode', async (args: any) => {
            const device = args.device as QuattChillDevice | undefined;
            await (device || this).setFanMode(String(args.fanMode));
            return true;
        });

        this.registerFlowAction('set_chill_mode', async (args: any) => {
            const device = args.device as QuattChillDevice | undefined;
            await (device || this).setMode(String(args.mode));
            return true;
        });

        this.registerFlowAction('set_chill_target_temperature', async (args: any) => {
            const device = args.device as QuattChillDevice | undefined;
            await (device || this).setTargetTemperature(Number(args.temperature));
            return true;
        });
    }

    private getOptionalDeviceTriggerCard(cardId: string): any {
        try {
            return this.homey.flow.getDeviceTriggerCard(cardId);
        } catch (error) {
            this.log(`Flow trigger ${cardId} is not available, skipping registration`, error);
            return null;
        }
    }

    private registerFlowAction(cardId: string, listener: any) {
        try {
            this.homey.flow.getActionCard(cardId).registerRunListener(listener);
        } catch (error) {
            this.log(`Flow card ${cardId} is not available, skipping registration`, error);
        }
    }

    private async setFanMode(fanMode: string) {
        await this.sendChillAction({type: 'SET_FAN_MODE', fanMode: this.normalizeFanModeForApi(fanMode)}, 'Unable to set Chill fan mode');
        await this.updateChillCapabilities();
    }

    private async setMode(mode: string) {
        await this.sendChillAction({type: 'SET_MODE', mode: this.normalizeModeForApi(mode)}, 'Unable to set Chill mode');
        await this.updateChillCapabilities();
    }

    private async setTargetTemperature(temperature: number) {
        const mode = String(this.getCapabilityValue('chill_mode') || 'COOLING');
        if (mode === 'HEATING') {
            await this.sendChillAction({type: 'SET_HEATING_TARGET_TEMPERATURE', heatingTargetTemperature: temperature}, 'Unable to set Chill heating target');
        } else {
            await this.sendChillAction({type: 'SET_COOLING_TARGET_TEMPERATURE', coolingTargetTemperature: temperature}, 'Unable to set Chill cooling target');
        }
        await this.updateChillCapabilities();
    }

    private async sendChillAction(action: Parameters<QuattRemoteApiClient['updateChillAction']>[1], errorMessage: string) {
        if (!this.remoteClient || !this.chillUuid) {
            throw new Error('Quatt Chill is not available');
        }

        const ok = await this.remoteClient.updateChillAction(this.chillUuid, action);
        await this.persistRefreshedTokens();
        if (!ok) {
            throw new Error(errorMessage);
        }
    }

    private async updateChillCapabilities() {
        if (!this.remoteClient || !this.chillUuid) return;

        try {
            const chills = await this.remoteClient.getChills();
            await this.persistRefreshedTokens();
            const currentChill = chills.find((chill) => chill.uuid === this.chillUuid);

            if (!currentChill) {
                await this.setUnavailable('Quatt Chill niet gevonden via de Quatt remote API').catch(this.error);
                return;
            }

            const mode = String(currentChill.mode || this.getCapabilityValue('chill_mode') || 'COOLING');
            const targetTemperature = mode === 'HEATING'
                ? currentChill.heatingTargetTemperature
                : currentChill.coolingTargetTemperature;

            const normalizedStatus = String(currentChill.status || '').toUpperCase();

            await Promise.all([
                this.safeSetCapabilityValue('measure_temperature', currentChill.ambientTemperature),
                this.safeSetCapabilityValue('target_temperature', targetTemperature),
                this.safeSetCapabilityValue('measure_chill_status', currentChill.status),
                this.safeSetCapabilityValue('measure_chill_mode', currentChill.mode),
                this.safeSetCapabilityValue('chill_mode', currentChill.mode),
                this.safeSetCapabilityValue('chill_fan_mode', this.normalizeFanModeForCapability(currentChill.fanMode)),
                this.safeSetCapabilityValue('onoff', this.getChillIsOn(currentChill)),
                this.safeSetCapabilityValue('chill_water_tank_status', this.getWaterTankStatus(normalizedStatus)),
                this.safeSetCapabilityValue('alarm_chill_disconnected', normalizedStatus === 'WARNING_DISCONNECTED'),
            ]);

            await this.triggerChillStatusChanged(currentChill.status);
            if (!this.getAvailable()) {
                await this.setAvailable();
            }
        } catch (error) {
            this.log('Unable to update Chill capabilities:', error);
            await this.setUnavailable(error instanceof Error ? error.message : String(error)).catch(this.error);
        }
    }

    private async persistRefreshedTokens() {
        const tokens = this.remoteClient?.getTokens();
        if (tokens) {
            await this.setStoreValue('remoteTokens', tokens).catch(this.error);
        }
    }

    private getChillIsOn(chill: QuattChill): boolean {
        if (typeof chill?.isOn === 'boolean') return chill.isOn;
        return Boolean(chill?.isOn?.value);
    }


    private getWaterTankStatus(status: string): string {
        if (status === 'WARNING_TANK_FULL') return 'FULL';
        if (status === 'WARNING_TANK_MISSING') return 'MISSING';
        return 'OK';
    }

    private normalizeFanModeForCapability(fanMode: unknown): string | undefined {
        if (fanMode === undefined || fanMode === null) return undefined;
        const value = String(fanMode).toUpperCase();
        if (value === 'NORMAL') return 'MEDIUM';
        return value;
    }

    private normalizeModeForApi(mode: string): string {
        const value = String(mode || '').toUpperCase();
        if (value.includes('HEAT') || value.includes('VERWARM')) return 'HEATING';
        if (value.includes('COOL') || value.includes('KOEL')) return 'COOLING';
        return value;
    }

    private normalizeFanModeForApi(fanMode: string): string {
        const value = fanMode.toUpperCase();
        if (value === 'MEDIUM') return 'NORMAL';
        return value;
    }


    private async triggerChillStatusChanged(status: unknown): Promise<void> {
        const currentStatus = status === undefined || status === null ? '' : String(status);
        const previousStatus = this.getStoreValue('lastChillStatus') || '';
        if (currentStatus === previousStatus) return;

        await this.setStoreValue('lastChillStatus', currentStatus).catch(this.error);
        const tokens = { status: currentStatus, previous_status: previousStatus };
        await this.triggerOptionalDeviceCard(this.chillStatusChangedTrigger, 'chill_status_changed', tokens);

        const normalizedStatus = currentStatus.toUpperCase();
        if (this.isChillErrorStatus(normalizedStatus)) {
            await this.triggerOptionalDeviceCard(this.chillErrorDetectedTrigger, 'chill_error_detected', tokens);
        }
        if (this.isChillTankFullStatus(normalizedStatus)) {
            await this.triggerOptionalDeviceCard(this.chillTankFullDetectedTrigger, 'chill_tank_full_detected', tokens);
        }
    }

    private isChillErrorStatus(status: string): boolean {
        return status === 'ERROR'
            || status.includes('FAULT')
            || status.includes('ALARM')
            || status === 'WARNING_DISCONNECTED'
            || status === 'WARNING_TANK_MISSING';
    }

    private isChillTankFullStatus(status: string): boolean {
        return (status.includes('TANK') && status.includes('FULL')) || status.includes('WATER_TANK_FULL') || status.includes('RESERVOIR_FULL') || status.includes('CONDENSATE_FULL');
    }

    private async triggerOptionalDeviceCard(card: any, cardId: string, tokens: { status: string; previous_status: string }): Promise<void> {
        if (!card) return;
        try {
            await card.trigger(this, tokens, {});
        } catch (error) {
            this.log(`Failed to trigger ${cardId}:`, error);
        }
    }

    private async safeSetCapabilityValue(capabilityId: string, value: unknown): Promise<void> {
        if (!this.hasCapability(capabilityId) || value === undefined || value === null) return;

        try {
            await this.setCapabilityValue(capabilityId, value as never);
        } catch (error) {
            this.log(`Failed to set capability ${capabilityId}:`, error);
        }
    }
}

module.exports = QuattChillDevice;

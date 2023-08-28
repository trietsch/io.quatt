import Homey from 'homey';

class QuattHeatpumpDriver extends Homey.Driver {

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
        // try {
        //   const settings = this.homey.getSettings();
        //
        //   this.homey.app.log('[Device] - init =>', this.homey.getName());
        //
        //   this.homey.app.setDebugLogging(settings.debug);
        //
        //   if(!settings.mac || settings.mac.length < 8) {
        //     await this.findMacAddress();
        //   }
        //
        //   if(!settings.encrypted_password || !settings.passwd.includes('+')) {
        //     await this.savePassword({...settings, encrypted_password: true, encrypted_password_fix: true });
        //   }
        //
        //   await this.checkCapabilities();
        //
        //   await this.setSynoClient();
        //
        //   this.registerCapabilityListener('onoff', this.onCapability_ON_OFF.bind(this));
        //   this.registerCapabilityListener('onoff_override', this.onCapability_ON_OFF_OVERRIDE.bind(this));
        //   this.registerCapabilityListener('action_reboot', this.onCapability_REBOOT.bind(this));
        //   this.registerCapabilityListener('action_update_data', this.onCapability_UPDATE_DATA.bind(this));
        //
        //   await this.checkOnOffState();
        //   await this.setCapabilityValues();
        //
        //   if(settings.enable_interval) {
        //     await this.checkOnOffStateInterval(settings.update_interval);
        //     await this.setCapabilityValuesInterval(settings.update_interval);
        //   }
        //
        //   await this.setAvailable();
        // } catch (error) {
        //   this.homey.app.log(`[Device] ${this.getName()} - OnInit Error`, error);
        // }
    }

    /**
     * TODO should also be able to select a device if the mac address is not in the known prefixes
     */
    async onPairListDevices() {
        const discoveryStrategy = this.getDiscoveryStrategy();
        this.log('discoveryStrategy', discoveryStrategy);
        const discoveryResults = discoveryStrategy.getDiscoveryResults();

        this.homey.app.log('discoveryResults', discoveryResults);

        return Object.values(discoveryResults)
            .map(discoveryResult => {
                return {
                    name: "Quatt Heatpump",
                    data: {
                        id: discoveryResult.id,
                    },
                    store: {
                        address: discoveryResult.address,
                    },
                };
            });
    }

}

module.exports = QuattHeatpumpDriver;

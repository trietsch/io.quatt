import Homey from 'homey';
import {Socket} from "net";
import {QuattClient} from "../../lib/quatt";

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

    async onPairListDevices() {
        let quattIP = await this.findQuattDevice();
        let quattMAC = await this.homey.arp.getMAC(quattIP)

        return [
            {
                name: "Quatt CIC",
                data: {
                    id: quattMAC,
                },
                store: {
                    address: quattIP,
                },
            }
        ];
    }

    /**
     * As the Quatt CIC doesn't broadcast its presence through mDNS, nor via SSDP, we need to discover it via MAC address ranges.
     * However, I've used the MAC address discovery strategy in the past, with all the MAC address prefixes as defined for Sunplus technologies (that's probably the manufacturer of the network card used in the Quatt CIC) (as defined here: https://udger.com/resources/mac-address-vendor-detail?name=sunplus_technology_co-ltd), but one day it stopped detecting the Quatt CIC.
     *
     * Therefore, I've setup a simple network scan, which scans the local network for the Quatt CIC, by trying to connect to port 8080 on all IP addresses in the local subnet. If the port is open, we try to fetch data from the candidate device, and if that succeeds, we assume it's the Quatt CIC.
     */
    private async findQuattDevice(): Promise<string> {
        let homeyAddress = await this.homey.cloud.getLocalAddress();
        let lan = homeyAddress.split('.').slice(0, 3).join('.');
        this.log('lan', lan)

        let quattCandidates: string[] = [];
        let quattIP: string | null = null;

        for (let i = 1; i <= 255; i++) {
            let host = `${lan}.${i}`;

            let socket = new Socket();
            let status: string | null = null;

            // Socket connection established, port is open
            socket.on('connect', function () {
                status = 'open';
                socket.end();
            });
            socket.setTimeout(1500);// If no response, assume port is not listening
            socket.on('timeout', function () {
                status = 'closed';
                quattCandidates.splice(quattCandidates.indexOf(host), 1);
                socket.destroy();
            });
            socket.on('error', (exception) => {
                status = 'closed';
                quattCandidates.splice(quattCandidates.indexOf(host), 1);
            });
            socket.on('close', async (exception) => {
                if (status == 'open') {
                    if (await this.verifyIsQuatt(host)) {
                        quattIP = host;
                    }
                }

                quattCandidates.splice(quattCandidates.indexOf(host), 1);
            });

            quattCandidates.push(host);
            socket.connect(8080, host);
        }

        while (quattCandidates.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 25));
        }

        if (quattIP) {
            return quattIP;
        } else {
            this.homey.app.log('No Quatt device found on the local network');
            throw new Error('No Quatt device found on the local network');
        }
    }

    private async verifyIsQuatt(address: string) {
        try {
            let client = new QuattClient(this.homey.app.manifest.version, address);
            return await client.getCicStats(false) != null;
        } catch (error) {
            return false
        }
    }

}

module.exports = QuattHeatpumpDriver;

import Homey from 'homey';
import {QuattClient} from "../../lib/quatt";

class QuattHeatpumpDriver extends Homey.Driver {

    /**
     * onInit is called when the driver is initialized.
     */
    async onInit() {
    }

    async onPairListDevices() {
        let homeyAddress = await this.homey.cloud.getLocalAddress();
        let quattIP = await QuattClient.discover(homeyAddress);
        let quattMAC = await this.homey.arp.getMAC(quattIP);

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
}

module.exports = QuattHeatpumpDriver;

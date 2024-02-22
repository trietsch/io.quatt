import axios from "axios";
import {CicStats} from "./cic-stats";

/*
 * Look at https://www.pluralsight.com/tech-blog/taming-dynamic-data-in-typescript/ for a way to make this class more type-safe
 * in terms of converting the data from the Quatt CIC to the CicStats interface.
 */
export class QuattClient {
    private deviceAddress: string;

    constructor(deviceAddress: string) {
        this.deviceAddress = deviceAddress;
    }

    setDeviceAddress(deviceAddress: string) {
        this.deviceAddress = deviceAddress;
    }

    async getCicStats(shouldLog: boolean = true): Promise<CicStats | null> {
        try {
            const response = await axios.get(`http://${this.deviceAddress}:8080/beta/feed/data.json`);

            response.data['qc']['supervisoryControlMode'] = response.data['qc']['supervisoryControlMode'] >= 100 ? '100' : response.data['qc']['supervisoryControlMode'].toString();
            response.data['hp1']['getMainWorkingMode'] = response.data['hp1']['getMainWorkingMode'].toString();

            if (response.data['hp2'] && response.data['hp2']['getMainWorkingMode'] !== null) {
                response.data['hp2']['getMainWorkingMode'] = response.data['hp2']['getMainWorkingMode'].toString();
            }

            return response.data as CicStats;
        } catch (error) {
            if (shouldLog) {
                console.log(`Error fetching data from ${this.deviceAddress}`);
                console.log(error);
            }
            return null;
        }
    }
}

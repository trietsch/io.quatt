import axios from "axios";
import {CicStats} from "./cic-stats";


export class QuattClient {
    private deviceAddress: string;
    constructor(deviceAddress: string) {
        console.log('constructor', deviceAddress);
        this.deviceAddress = deviceAddress;
    }

    setDeviceAddress(deviceAddress: string) {
        console.log('setDeviceAddress', deviceAddress);
        this.deviceAddress = deviceAddress;
    }

    async getCicStats(): Promise<CicStats> {
        try {
            const response = await axios.get(`http://${this.deviceAddress}:8080/beta/feed/data.json`);
            return response.data as CicStats;
        } catch (error) {
            console.log(error);
            return {} as CicStats;
        }
    }
}

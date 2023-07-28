import Homey from 'homey';
import axios from "axios";

class Quatt extends Homey.App {

    // -------------------- INIT ----------------------
    async onInit() {
        this.log(`${this.homey.manifest.id} started...`);
        await this.fetchQuattData();
    }

    async fetchQuattData() {
        try {
            const response = await axios.get("http://192.168.1.204:8080/beta/feed/data.json");
            const data = response.data;
            this.log(data);
        } catch (error) {
          this.log(error);
        }
    }
}

module.exports = Quatt;

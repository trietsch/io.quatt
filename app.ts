import Homey from 'homey';

class Quatt extends Homey.App {
    async onInit() {
        this.log(`${this.homey.manifest.id} started`);
    }
}

module.exports = Quatt;

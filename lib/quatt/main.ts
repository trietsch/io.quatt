import {QuattClient} from "./index";

let client = new QuattClient('localhost');

client.getCicStats(false).then(stats => {
    console.log(stats);
});

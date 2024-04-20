import {QuattClient} from "./index";

let client = new QuattClient('dev', 'localhost');

client.getCicStats(false).then(stats => {
    console.log(stats);
});

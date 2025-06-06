import {QuattClient} from "./index";

let client = new QuattClient('dev', 'localhost');

client.getCicStats().then(stats => {
    console.log(stats);
});

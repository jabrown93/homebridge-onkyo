/* eslint-disable no-console */
import { Eiscp } from '../eiscp.js';
const eiscp = new Eiscp(console);

eiscp.on('debug', console.log);
eiscp.on('error', console.log);

// Discover receviers on network, stop after 2 receviers or 5 seconds

eiscp.discover({ devices: 2, timeout: 5 }, (err, result) => {
  if (err) {
    console.log('Error message: ' + result);
  } else {
    console.log('Found these receivers on the local network:');
    console.dir(result);
  }
});

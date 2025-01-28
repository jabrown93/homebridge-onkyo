/* eslint-disable no-console */
import util from 'utils';

import eiscp from '../eiscp.js';

eiscp.on('debug', util.log);
eiscp.on('error', util.log);

// Discover receviers on network, stop after 2 receviers or 5 seconds

eiscp.discover({ devices: 2, timeout: 5 }, (err, result) => {
  if (err) {
    console.log('Error message: ' + result);
  } else {
    console.log('Found these receivers on the local network:');
    console.dir(result);
  }
});

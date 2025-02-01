/* eslint-disable no-console,no-undef */
/*jslint node:true nomen:true*/
'use strict';

import eiscp from '../eiscp';
// This will output a list of available commands

eiscp.get_commands('main', (err, cmds) => {
  console.log(cmds);
  cmds.forEach(cmd => {
    console.log(cmd);
    eiscp.get_command(cmd, (err, values) => {
      console.log(values);
    });
  });
});

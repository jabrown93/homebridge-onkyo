/* eslint-disable no-console */
import eiscp from '../eiscp.js';
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

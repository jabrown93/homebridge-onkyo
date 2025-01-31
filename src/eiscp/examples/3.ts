/* eslint-disable no-console */
import { Eiscp } from '../eiscp.js';
// This will output a list of available commands
const eiscp = new Eiscp(console);
eiscp.get_commands('main', (err, cmds) => {
  console.log(cmds);
  cmds.forEach(cmd => {
    console.log(cmd);
    eiscp.get_command(cmd, (err, values) => {
      console.log(values);
    });
  });
});

import net from 'net';
import dgram from 'dgram';
import async from 'async';
import util from 'util';

import { EventEmitter } from 'events';

export class Eiscp extends EventEmitter {
  private is_connected: boolean;
  private eiscp?: net.Socket;
  private readonly send_queue?;
  private readonly COMMANDS;
  private readonly COMMAND_MAPPINGS;
  private readonly VALUE_MAPPINGS;
  private readonly MODELSETS;

  private readonly config = {
    port: 60128,
    reconnect: true,
    reconnect_sleep: 5,
    modelsets: [],
    send_delay: 500,
    verify_commands: true,
    host: '',
    model: undefined,
  };

  constructor() {
    super();
    this.is_connected = false;
    const eiscp_commands = JSON.parse('./eiscp-commands.json');
    this.COMMANDS = eiscp_commands.commands;
    this.COMMAND_MAPPINGS = eiscp_commands.command_mappings;
    this.VALUE_MAPPINGS = eiscp_commands.value_mappings;
    this.MODELSETS = eiscp_commands.modelsets;
    this.send_queue = async.queue((data, callback) => {
      /*
          Syncronous queue which sends commands to device
        callback(bool error, string error_message)
        */
      if (this.is_connected) {
        this.emit(
          'debug',
          util.format(
            'DEBUG (sent_command) Sent command to %s:%s - %s',
            this.config.host,
            this.config.port,
            data
          )
        );

        this.eiscp?.write(this.eiscp_packet(data));

        setTimeout(callback, this.config.send_delay);
        return;
      }

      this.emit(
        'error',
        util.format(
          "ERROR (send_not_connected) Not connected, can't send data: %j",
          data
        )
      );
    }, 1);
  }

  private in_modelsets(set) {
    // returns true if set is in modelsets false otherwise
    return this.config.modelsets.indexOf(set as unknown as never) !== -1;
  }

  private eiscp_packet(data) {
    /*
        Wraps command or iscp message in eISCP packet for communicating over Ethernet
        type is device type where 1 is receiver and x is for the discovery broadcast
        Returns complete eISCP packet as a buffer ready to be sent
      */

    // Add ISCP header if not already present
    if (data.charAt(0) !== '!') {
      data = '!1' + data;
    }
    // ISCP message
    const iscp_msg = Buffer.from(data + '\x0D\x0a');

    // eISCP header
    const header = Buffer.from([
      73,
      83,
      67,
      80, // magic
      0,
      0,
      0,
      16, // header size
      0,
      0,
      0,
      0, // data size
      1, // version
      0,
      0,
      0, // reserved
    ]);
    // write data size to eISCP header
    header.writeUInt32BE(iscp_msg.length, 8);

    return Buffer.concat([header, iscp_msg]);
  }

  private eiscp_packet_extract(packet) {
    /*
        Exracts message from eISCP packet
        Strip first 18 bytes and last 3 since that's only the header and end characters
      */
    return packet.toString('ascii', 18, packet.length - 3);
  }

  private iscp_to_command(iscp_message) {
    /*
        Transform a low-level ISCP message to a high-level command
      */
    const command = iscp_message.slice(0, 3),
      value = iscp_message.slice(3),
      result = {
        command: undefined,
        argument: undefined as unknown as number,
      };

    Object.keys(this.COMMANDS).forEach(zone => {
      if (typeof this.COMMANDS[zone][command] !== 'undefined') {
        const zone_cmd = this.COMMANDS[zone][command];

        result.command = zone_cmd.name;

        if (typeof zone_cmd.values[value] !== 'undefined') {
          result.argument = zone_cmd.values[value].name;
        } else if (
          typeof this.VALUE_MAPPINGS[zone][command].INTRANGES !== 'undefined' &&
          /^[0-9a-fA-F]+$/.test(value)
        ) {
          // It's a range so we need to convert args from hex to decimal
          result.argument = parseInt(value, 16);
        }
      }
    });

    return result;
  }

  // TODO: This function is starting to get very big, it should be split up into smaller parts and oranized better
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private command_to_iscp(command: any, args?: any, zone?: any) {
    /*
        Transform high-level command to a low-level ISCP message
      */

    function parse_command(cmd) {
      // Splits and normalizes command into 3 parts: { zone, command, value }
      // Split by space, dot, equals and colon
      const parts = cmd
        .toLowerCase()
        .split(/[\s.=:]/)
        .filter(item => {
          return item !== '';
        });
      if (parts.length < 2 || parts.length > 3) {
        return false;
      }
      if (parts.length === 2) {
        parts.unshift('main');
      }
      return {
        zone: parts[0],
        command: parts[1],
        value: parts[2],
      };
    }

    function in_intrange(number, range) {
      const parts = range.split(',');
      number = parseInt(number, 10);
      return (
        parts.length === 2 &&
        number >= parseInt(parts[0], 10) &&
        number <= parseInt(parts[1], 10)
      );
    }

    // If parts are not explicitly given - parse the command
    if (typeof args === 'undefined' && typeof zone === 'undefined') {
      const parts = parse_command(command);
      if (!parts) {
        // Error parsing command
        this.emit(
          'error',
          util.format(
            'ERROR (cmd_parse_error) Command and arguments provided could not be parsed (%s)',
            command
          )
        );
        return;
      }
      zone = parts.zone;
      command = parts.command;
      args = parts.value;
    }

    this.emit(
      'debug',
      util.format(
        'DEBUG (command_to_iscp) Zone: %s | Command: %s | Argument: %s',
        zone,
        command,
        args
      )
    );

    // Find the command in our database, resolve to internal eISCP command

    if (typeof this.COMMANDS[zone] === 'undefined') {
      this.emit(
        'error',
        util.format(
          'ERROR (zone_not_exist) Zone %s does not exist in command file',
          zone
        )
      );
      return;
    }

    if (typeof this.COMMAND_MAPPINGS[zone][command] === 'undefined') {
      this.emit(
        'error',
        util.format(
          'ERROR (cmd_not_exist) Command %s does not exist in zone %s',
          command,
          zone
        )
      );
      return;
    }
    const prefix = this.COMMAND_MAPPINGS[zone][command];
    let value;

    if (typeof this.VALUE_MAPPINGS[zone][prefix][args] === 'undefined') {
      if (
        typeof this.VALUE_MAPPINGS[zone][prefix].INTRANGES !== 'undefined' &&
        /^\d+$/.test(args)
      ) {
        // This command is part of a integer range
        const intranges = this.VALUE_MAPPINGS[zone][prefix].INTRANGES;
        const len = intranges.length;
        for (let i = 0; i < len; i += 1) {
          if (
            this.in_modelsets(intranges[i].models) &&
            in_intrange(args, intranges[i].range)
          ) {
            // args is an integer and is in the available range for this command
            value = args;
          }
        }

        if (typeof value === 'undefined' && this.config.verify_commands) {
          this.emit(
            'error',
            util.format(
              'ERROR (arg_not_in_range) Command %s=%s is not available on this model',
              command,
              args
            )
          );
          return;
        } else {
          value = args;
        }

        // Convert decimal number to hexadecimal since receiver doesn't understand decimal
        value = (+value).toString(16).toUpperCase();
        // Pad value if it is not 2 digits
        value = value.length < 2 ? '0' + value : value;
      } else {
        // Not yet supported command
        this.emit(
          'error',
          util.format(
            'ERROR (arg_not_exist) Argument %s does not exist in command %s',
            args,
            command
          )
        );
        return;
      }
    } else if (
      !this.config.verify_commands ||
      this.in_modelsets(this.VALUE_MAPPINGS[zone][prefix][args].models)
    ) {
      value = this.VALUE_MAPPINGS[zone][prefix][args].value;
    } else {
      this.emit(
        'error',
        util.format(
          'ERROR (cmd_not_supported) Command %s in zone %s is not supported on this model.',
          command,
          zone
        )
      );
      return;
    }

    this.emit(
      'debug',
      util.format('DEBUG (command_to_iscp) raw command "%s"', prefix + value)
    );

    return prefix + value;
  }

  public discover(options: object, callback) {
    /*
        discover([options, ] callback)
        Sends broadcast and waits for response callback called when number of devices or timeout reached
        option.devices    - stop listening after this amount of devices have answered (default: 1)
        option.timeout    - time in seconds to wait for devices to respond (default: 10)
        option.address    - broadcast address to send magic packet to (default: 255.255.255.255)
        option.port       - receiver port should always be 60128 this is just available if you need it
      */
    let timeout_timer;

    const result = [];
    const client = dgram.createSocket('udp4');
    // eslint-disable-next-line prefer-rest-params
    const argv = Array.prototype.slice.call(arguments);
    const argc = argv.length;

    if (argc === 1 && typeof argv[0] === 'function') {
      callback = argv[0];
    } else if (argc === 2 && typeof argv[1] === 'function') {
      options = argv[0];
      callback = argv[1];
    } else {
      return;
    }

    options['devices'] = options['devices'] ?? 1;
    options['timeout'] = options['timeout'] ?? 10;
    options['address'] = options['address'] ?? '255.255.255.255';
    options['port'] = options['port'] ?? 60128;

    function close() {
      client.close();
      callback(false, result);
    }

    client
      .on('error', err => {
        this.emit(
          'error',
          util.format(
            'ERROR (server_error) Server error on %s:%s - %s',
            options['address'],
            options['port'],
            err
          )
        );
        client.close();
        callback(err, null);
      })
      .on('message', (packet, rinfo) => {
        const message = this.eiscp_packet_extract(packet);
        const command = message.slice(0, 3);
        let data;
        if (command === 'ECN') {
          data = message.slice(3).split('/');
          result.push({
            host: rinfo.address,
            port: data[1],
            model: data[0],
            mac: data[3].slice(0, 12), // There's lots of null chars after MAC so we slice them off
            areacode: data[2],
          } as unknown as never);
          this.emit(
            'debug',
            util.format(
              'DEBUG (received_discovery) Received discovery packet from %s:%s (%j)',
              rinfo.address,
              rinfo.port,
              result
            )
          );
          if (result.length >= options['devices']) {
            clearTimeout(timeout_timer);
            close();
          }
        } else {
          this.emit(
            'debug',
            util.format(
              'DEBUG (received_data) Recevied data from %s:%s - %j',
              rinfo.address,
              rinfo.port,
              message
            )
          );
        }
      })
      .on('listening', () => {
        client.setBroadcast(true);
        const buffer = this.eiscp_packet('!xECNQSTN');
        this.emit(
          'debug',
          util.format(
            'DEBUG (sent_discovery) Sent broadcast discovery packet to %s:%s',
            options['address'],
            options['port']
          )
        );
        client.send(
          buffer,
          0,
          buffer.length,
          options['port'],
          options['address']
        );
        timeout_timer = setTimeout(close, options['timeout'] * 1000);
      })
      .bind(0);
  }

  public connect(options?: object) {
    /*
        No options required if you only have one receiver on your network. We will find it and connect to it!
        options.host            - Hostname/IP
        options.port            - Port (default: 60128)
        options.send_delay      - Delay in milliseconds between each command sent to receiver (default: 500)
        options.model           - Should be discovered automatically but if you want to override it you can
        options.reconnect       - Try to reconnect if connection is lost (default: false)
        options.reconnect_sleep - Time in seconds to sleep between reconnection attempts (default: 5)
        options.verify_commands - Whether the reject commands not found for the current model
      */

    options = options || {};
    this.config.host = options['host'] ?? this.config.host;
    this.config.port = options['port'] ?? this.config.port;
    this.config.model = options['model'] ?? this.config.model;
    this.config.reconnect = options['reconnect'] ?? this.config.reconnect;
    this.config.reconnect_sleep =
      options['reconnect_sleep'] ?? this.config.reconnect_sleep;
    this.config.verify_commands =
      options['verify_commands'] ?? this.config.verify_commands;

    const connection_properties = {
      host: this.config.host,
      port: this.config.port,
    };

    // If no host is configured - we connect to the first device to answer
    if (typeof this.config.host === 'undefined' || this.config.host === '') {
      this.discover({}, (err, hosts) => {
        if (!err && hosts && hosts.length > 0) {
          this.connect(hosts[0]);
        }
      });
      return;
    }

    // If host is configured but no model is set - we send a discover directly to this receiver
    if (typeof this.config.model === 'undefined' || this.config.model === '') {
      this.discover({ address: this.config.host }, (err, hosts) => {
        if (!err && hosts && hosts.length > 0) {
          this.connect(hosts[0]);
        }
      });
      return;
    }

    /*
      Compute modelsets for this model (so commands which are possible on this model are allowed)
        Note that this is not an exact match, model only has to be part of the modelname
      */
    Object.keys(this.MODELSETS).forEach(set => {
      this.MODELSETS[set].forEach(models => {
        if (models.indexOf(this.config.model) !== -1) {
          this.config.modelsets.push(set as unknown as never);
        }
      });
    });

    this.emit(
      'debug',
      util.format(
        'INFO (connecting) Connecting to %s:%s (model: %s)',
        this.config.host,
        this.config.port,
        this.config.model
      )
    );

    // Reconnect if we have previously connected
    if (typeof this.eiscp !== 'undefined') {
      this.eiscp.connect(connection_properties);
      return;
    }

    // Connecting the first time
    this.eiscp = net.connect(connection_properties);

    this.eiscp
      .on('connect', () => {
        this.is_connected = true;
        this.emit(
          'debug',
          util.format(
            'INFO (connected) Connected to %s:%s (model: %s)',
            this.config.host,
            this.config.port,
            this.config.model
          )
        );
        this.emit(
          'connect',
          this.config.host,
          this.config.port,
          this.config.model
        );
      })
      .on('close', () => {
        this.is_connected = false;
        this.emit(
          'debug',
          util.format(
            'INFO (disconnected) Disconnected from %s:%s',
            this.config.host,
            this.config.port
          )
        );
        this.emit('close', this.config.host, this.config.port);

        if (this.config.reconnect) {
          setTimeout(this.connect, this.config.reconnect_sleep * 1000);
        }
      })
      .on('error', err => {
        this.emit(
          'error',
          util.format(
            'ERROR (server_error) Server error on %s:%s - %s',
            this.config.host,
            this.config.port,
            err
          )
        );
        this.eiscp?.destroy();
      })
      .on('data', data => {
        const iscp_message = this.eiscp_packet_extract(data),
          result = this.iscp_to_command(iscp_message) as object;

        result['iscp_command'] = iscp_message;
        result['host'] = this.config.host;
        result['port'] = this.config.port;
        result['model'] = this.config.model;

        this.emit(
          'debug',
          util.format(
            'DEBUG (received_data) Received data from %s:%s - %j',
            this.config.host,
            this.config.port,
            result
          )
        );
        this.emit('data', result);

        // If the command is supported we emit it as well
        if (typeof result['command'] !== 'undefined') {
          if (Array.isArray(result['command'])) {
            result['command'].forEach(cmd => {
              this.emit(cmd, result['argument']);
            });
          } else {
            this.emit(result['command'], result['argument']);
          }
        }
      });
  }

  public disconnect() {
    this.close();
  }

  public close() {
    if (this.is_connected) {
      this.eiscp?.destroy();
    }
  }

  public raw(data, callback) {
    /*
        Send a low level command like PWR01
        callback only tells you that the command was sent but not that it succsessfully did what you asked
      */
    if (typeof data !== 'undefined' && data !== '') {
      this.send_queue.push(data, err => {
        if (typeof callback === 'function') {
          callback(err, null);
        }
      });
    } else if (typeof callback === 'function') {
      callback(true, 'No data provided.');
    }
  }

  public command(data, callback?) {
    /*
        Send a high level command like system-power=query
        callback only tells you that the command was sent but not that it succsessfully did what you asked
      */

    this.raw(this.command_to_iscp(data), callback);
  }

  public get_commands(zone, callback) {
    /*
        Returns all commands in given zone
      */
    const result = [];
    async.each(
      Object.keys(this.COMMAND_MAPPINGS[zone]),
      (cmd, cb) => {
        //console.log(cmd);
        result.push(cmd as unknown as never);
        cb();
      },
      err => {
        callback(err, result);
      }
    );
  }

  public get_command(command, callback) {
    /*
        Returns all command values in given zone and command
      */
    let zone;
    const result = [];
    const parts = command.split('.');

    if (parts.length !== 2) {
      zone = 'main';
      command = parts[0];
    } else {
      zone = parts[0];
      command = parts[1];
    }

    async.each(
      Object.keys(
        this.VALUE_MAPPINGS[zone][this.COMMAND_MAPPINGS[zone][command]]
      ),
      (val, cb) => {
        result.push(val as unknown as never);
        cb();
      },
      err => {
        callback(err, result);
      }
    );
  }
}

export default new Eiscp();

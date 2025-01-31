/*
    Script that converts eiscp-commands.yaml to eiscp-commands.json
*/
/* eslint-disable no-console */
import yaml from 'js-yaml';
import fs from 'fs';

export default function convertYamlToJson() {
  const command_mappings = new Map();
  const value_mappings = {};
  const result = {
    commands: {},
    modelsets: {},
    command_mappings: {},
    value_mappings: {},
  };
  try {
    const doc: Record<string, object> = yaml.load(
      fs.readFileSync('./eiscp-commands.yaml', 'utf8')
    ) as Record<string, object>;
    result.modelsets = doc.modelsets;
    delete doc.modelsets;

    for (const zone in doc) {
      result.commands[zone] = doc[zone];
      if (typeof command_mappings[zone] === 'undefined') {
        command_mappings[zone] = {};
        value_mappings[zone] = {};
      }
      for (const command in doc[zone]) {
        const name = doc[zone][command].name;
        if (name instanceof Array) {
          for (const element of name) {
            command_mappings[zone][element] = command;
          }
        } else {
          command_mappings[zone][name] = command;
        }

        if (typeof value_mappings[zone][command] === 'undefined') {
          value_mappings[zone][command] = {};
        }
        for (const value in doc[zone][command].values) {
          const name = doc[zone][command].values[value].name;
          if (/[BT]\{xx}/.exec(value) && /[bt]-xx/.exec(name)) {
            // It's not yet supported
            console.log(
              'Not yet supported: (command: ' +
                command +
                ') (value: ' +
                value +
                ') ( ' +
                doc[zone][command].values[value].description +
                ' )'
            );
          } else if (typeof name !== 'undefined') {
            if (name instanceof Array) {
              for (const element of name) {
                value_mappings[zone][command][element] = {
                  value: value,
                  models: doc[zone][command].values[value].models,
                };
              }
            } else {
              value_mappings[zone][command][name] = {
                value: value,
                models: doc[zone][command].values[value].models,
              };
            }
            // Special values don't have names so we can handle them here
          } else if (value.indexOf(',') !== -1) {
            // It's a range
            if (
              typeof value_mappings[zone][command].INTRANGES === 'undefined'
            ) {
              value_mappings[zone][command].INTRANGES = [];
            }
            value_mappings[zone][command].INTRANGES.push({
              range: value,
              models: doc[zone][command].values[value].models,
            });
          } else {
            // It's not yet supported
            console.log(
              'Not yet supported: (command: ' +
                command +
                ') (value: ' +
                value +
                ') ( ' +
                doc[zone][command].values[value].description +
                ' )'
            );
          }
        }
      }

      result.command_mappings = command_mappings;
      result.value_mappings = value_mappings;

      fs.writeFile('eiscp-commands.json', JSON.stringify(result), err => {
        if (err) {
          return console.log(err);
        }

        console.log('eiscp-commands.json created!');
      });
    }
  } catch (e) {
    console.log(e);
  }
}

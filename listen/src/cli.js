const main = require("./main.js");
import arg from 'arg';

function parseArgumentsIntoOptions(rawArgs) {
 const args = arg(
   {
     '--verbose': Boolean,
     '-v': '--verbose',
     '--name': String,
     '-n': '--name',
   },
   {
     argv: rawArgs.slice(2),
   }
 );
 return {
   verbose: args['--verbose'] || false,
   name: args['--name'] || '',
 };
}

export async function cli(args) {
    const options = parseArgumentsIntoOptions(args);
    main(options);
}
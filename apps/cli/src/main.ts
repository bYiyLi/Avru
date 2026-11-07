import { command } from './command.js';
const result = command(process.argv.slice(2));
if (result.code === 0) console.log(result.message);
else console.error(result.message);
process.exitCode = result.code;

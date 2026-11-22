import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'logs');
fs.mkdirSync(dir, { recursive: true });
const streams = {};

export function writeLog(file, record) {
  if (!streams[file]) streams[file] = fs.createWriteStream(path.join(dir, file + '.log'), { flags: 'a' });
  streams[file].write(JSON.stringify(record) + '\n');
}

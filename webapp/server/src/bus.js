import { EventEmitter } from 'node:events';
import { writeLog } from './logger.js';

class Bus extends EventEmitter {
  emitUi(msg) { this.emit('ui', msg); }
  emitLog(file, record) {
    const rec = { timestamp: new Date().toISOString(), ...record };
    writeLog(file, rec);
    this.emit('log', { file, record: rec });
    this.emit('ui', { type: 'log', file, ...rec });
  }
}
export const bus = new Bus();
bus.setMaxListeners(100);

// 持久化日志：~/.meowser/logs/meowser-YYYY-MM-DD.log
// hook console.log/warn/error，原始输出仍保留
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), '.meowser', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

function dateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function logFile() { return path.join(LOG_DIR, `meowser-${dateStr()}.log`); }

let curDate = dateStr();
let stream = fs.createWriteStream(logFile(), { flags: 'a' });

function fmt(arg) {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'object' && arg !== null) {
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }
  return String(arg);
}

function write(level, args) {
  const d = dateStr();
  if (d !== curDate) {
    try { stream.end(); } catch {}
    curDate = d;
    stream = fs.createWriteStream(logFile(), { flags: 'a' });
  }
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(fmt).join(' ')}\n`;
  try { stream.write(line); } catch {}
}

const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
console.log   = (...a) => { write('INFO',  a); orig.log(...a); };
console.info  = (...a) => { write('INFO',  a); orig.info(...a); };
console.warn  = (...a) => { write('WARN',  a); orig.warn(...a); };
console.error = (...a) => { write('ERROR', a); orig.error(...a); };

process.on('uncaughtException',  e => write('FATAL', ['uncaughtException', e]));
process.on('unhandledRejection', r => write('FATAL', ['unhandledRejection', r]));

write('INFO', ['── meowser started, log dir:', LOG_DIR]);

module.exports = { LOG_DIR, currentLogFile: logFile };

// Drives a running debug build of Filmie over the DevTools protocol, for real screenshots.
// node capture.mjs eval "<js>"   runs JS in the app window and prints the result
// node capture.mjs shot out.png  saves a 1440x900 screenshot at 2x
// Start the app first with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 (see README.md).
import { writeFileSync } from 'node:fs';

const [cmd, arg] = process.argv.slice(2);
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find(t => t.type === 'page' && t.url.startsWith('http://tauri.localhost'));
if (!page) throw new Error('No Filmie window on port 9222');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const waiting = {};
ws.onmessage = e => { const m = JSON.parse(e.data); waiting[m.id]?.(m); delete waiting[m.id]; };
await new Promise(r => (ws.onopen = r));
const send = (method, params = {}) => new Promise(r => { waiting[++id] = r; ws.send(JSON.stringify({ id, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg);
} else {
  console.error('usage: node capture.mjs eval "<js>" | shot <file.png>');
}
ws.close();

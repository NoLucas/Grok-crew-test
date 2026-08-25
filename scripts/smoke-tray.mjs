import assert from 'node:assert/strict';
import { app, BrowserWindow } from 'electron';
import { createDesktopTray, createTrayMenu, installCloseToTray } from '../desktop/tray-controller.mjs';

async function run() {
  let quitting = false;
  let showCalls = 0;
  let hideCalls = 0;
  let quitCalls = 0;
  const window = new BrowserWindow({ show: false });
  installCloseToTray(window, () => quitting);
  window.show();
  window.close();
  assert.equal(window.isDestroyed(), false, 'Close must preserve the desktop window.');
  assert.equal(window.isVisible(), false, 'Close must hide the desktop window.');

  const actions = {
    show: () => { showCalls += 1; },
    hide: () => { hideCalls += 1; },
    quit: () => { quitCalls += 1; },
  };
  const menu = createTrayMenu(actions);
  assert.deepEqual(menu.items.filter((item) => item.type !== 'separator').map((item) => item.label), ['Grok Crew 열기', '숨기기', '종료']);
  menu.items[0].click();
  menu.items[1].click();
  menu.items[3].click();
  assert.deepEqual([showCalls, hideCalls, quitCalls], [1, 1, 1]);

  const tray = createDesktopTray(actions);
  tray.emit('click');
  assert.equal(showCalls, 2, 'Clicking the tray icon must restore the app.');
  tray.destroy();
  quitting = true;
  window.destroy();
  console.log('Desktop close-to-tray smoke test passed.');
}

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});

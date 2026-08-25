import { Menu, nativeImage, Tray } from 'electron';

const TRAY_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA20lEQVR42u1XQRLCMAhMmDygvk4v9XH1Ul+nP7CnzHS0xLBs6UE5dhh2gU2BlH7d8jeH8fx4eQBu91OGCHiBe4lIBHgrpkSAt2JLFLiGUdBA0zx8fLtenvgr6M1+CxghUkUp3qw9fiYClqAWK8x+Vz+LFiARagCICOWo0ps14MmS3gKkWhpxSUE2zcMmwTACNA2wRVl6RNcL2vo30CrQCqr1mTKMWKWvVTIPI/b7h1qwB4mMbkTagNJatSa/XlBz9Er2TkAsO/we67lYDwn2bSDINcM8TA4/zf62AFjuZ/4yqMK/AAAAAElFTkSuQmCC';

export function installCloseToTray(window, isQuitting) {
  window.on('close', (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
}

export function createTrayMenu({ show, hide, quit }) {
  return Menu.buildFromTemplate([
    { label: 'Grok Crew 열기', click: show },
    { label: '숨기기', click: hide },
    { type: 'separator' },
    { label: '종료', click: quit },
  ]);
}

export function createDesktopTray({ show, hide, quit }) {
  const icon = nativeImage.createFromBuffer(Buffer.from(TRAY_ICON_PNG, 'base64'));
  if (icon.isEmpty()) throw new Error('The Grok Crew tray icon could not be decoded.');
  const tray = new Tray(icon);
  tray.setToolTip('Grok Crew Desktop');
  tray.setContextMenu(createTrayMenu({ show, hide, quit }));
  tray.on('click', show);
  return tray;
}

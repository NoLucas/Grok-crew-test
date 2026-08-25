import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const e2eRoot = await mkdtemp(join(tmpdir(), 'grok-crew-e2e-'));
const workspace = join(e2eRoot, 'workspace');
const input = join(workspace, 'inputs', 'e2e-source.mp4');
await mkdir(dirname(input), { recursive: true });
await copyFile(join(root, 'public', 'demo', 'bot-edit-result-source.mp4'), input);

let desktop;
let page;
let passed = false;
try {
  desktop = await electron.launch({
    args: ['desktop/main.mjs'],
    cwd: root,
    env: {
      ...process.env,
      GROK_CREW_E2E_ROOT: e2eRoot,
    },
    timeout: 60_000,
  });
  page = await desktop.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.locator('.desktop-shell').waitFor({ timeout: 30_000 });

  // Create a project using only visible desktop controls.
  await page.locator('.desktop-side-head button').first().click();
  const create = page.locator('.desktop-create-card');
  await create.locator('input').first().fill('Desktop E2E');
  await create.locator('select').selectOption({ label: 'e2e-source.mp4' });
  await create.locator('.desktop-primary').click();
  await page.locator('.desktop-project-bar h1').filter({ hasText: 'Desktop E2E' }).waitFor();
  await page.locator('.desktop-timeline-revision').filter({ hasText: 'v1' }).waitFor();

  // Direct edit, marker, undo, and redo without opening a terminal.
  await page.locator('.desktop-titlebar nav button').nth(1).click();
  const clip = page.locator('.desktop-clip-body').first();
  await clip.click();
  await clip.press('s');
  await page.locator('.desktop-timeline-revision').filter({ hasText: 'v2' }).waitFor();
  assert.equal(await page.locator('.desktop-timeline-clip').count(), 2);

  const markerButton = page.locator('.desktop-timeline-tools button').filter({ hasText: /Marker|마커|标记|マーカー/ }).first();
  await markerButton.click();
  await page.locator('.desktop-timeline-revision').filter({ hasText: 'v3' }).waitFor();
  assert.equal(await page.locator('.desktop-marker-flag').count(), 1);

  await page.locator('.desktop-timeline-tools button').filter({ hasText: /Undo|취소|撤销|取消/ }).first().click();
  await page.locator('.desktop-timeline-revision').filter({ hasText: 'v4' }).waitFor();
  assert.equal(await page.locator('.desktop-marker-flag').count(), 0);
  await page.locator('.desktop-timeline-tools button').filter({ hasText: /Redo|다시|重做|やり直し/ }).first().click();
  await page.locator('.desktop-timeline-revision').filter({ hasText: 'v5' }).waitFor();
  assert.equal(await page.locator('.desktop-marker-flag').count(), 1);

  // Generate a proxy and prove the monitor switches to it.
  const proxyButton = page.locator('.desktop-monitor-actions button').filter({ hasText: /proxy|프록시|代理|プロキシ/i }).first();
  await proxyButton.click();
  await page.locator('.desktop-monitor-actions button[aria-pressed="true"]').waitFor({ timeout: 90_000 });
  const previewSource = await page.locator('.desktop-monitor video').getAttribute('src');
  assert.match(previewSource ?? '', /\/media\/proxies\//);

  // Render through the desktop's Export surface and wait for the local job.
  await page.locator('.desktop-titlebar nav button').nth(2).click();
  await page.locator('.desktop-render-card .desktop-primary').click();
  await page.waitForFunction(async () => {
    const value = await window.grokCrew?.request('/api/jobs');
    const jobs = value?.jobs ?? [];
    return jobs.some((job) => job.kind === 'render' && job.status === 'succeeded');
  }, undefined, { timeout: 180_000, polling: 500 });
  const jobs = await page.evaluate(async () => {
    const value = await window.grokCrew?.request('/api/jobs');
    return value?.jobs ?? [];
  });
  const renderJob = jobs.find((job) => job.kind === 'render');
  assert.equal(renderJob?.status, 'succeeded', JSON.stringify(renderJob));
  const output = String(renderJob?.result_json?.output_path ?? '');
  assert.ok(output.startsWith(workspace), `Render escaped E2E workspace: ${output}`);
  assert.ok((await stat(output)).size > 0);

  passed = true;
  console.log(JSON.stringify({
    status: 'passed',
    project: 'Desktop E2E',
    revision: await page.locator('.desktop-project-chips span').first().textContent(),
    proxyPreview: previewSource,
    output,
  }, null, 2));
} catch (error) {
  if (page) {
    const screenshot = join(e2eRoot, 'failure.png');
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
    console.error(`Desktop E2E screenshot: ${screenshot}`);
  }
  throw error;
} finally {
  await desktop?.close().catch(() => undefined);
  if (passed && !process.env.GROK_CREW_KEEP_E2E) await rm(e2eRoot, { recursive: true, force: true });
}

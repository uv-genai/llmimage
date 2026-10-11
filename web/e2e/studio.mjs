/** End-to-end UI test against the real stack.

It drives the built SPA in a real browser (Firefox via Playwright) through a full
session: configure an endpoint, verify the model list, generate, open the viewer,
paint a mask, edit the result and check the history. Every step talks to a live
backend, so nothing here is stubbed.

Prerequisites (see README):
  npm --prefix web run build && uv run llmimage serve
  an OpenAI-compatible image endpoint reachable by the backend

Usage:
  UPSTREAM_URL=http://127.0.0.1:8080/v1 UPSTREAM_KEY=sk-... npm --prefix web run e2e
*/

import { firefox } from 'playwright';
import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BASE = process.env.STUDIO_URL ?? 'http://127.0.0.1:8765';
const UPSTREAM_URL = process.env.UPSTREAM_URL ?? 'http://127.0.0.1:8080/v1';
const UPSTREAM_KEY = process.env.UPSTREAM_KEY ?? '';
const MODEL = process.env.UPSTREAM_MODEL ?? 'qwen-image-2.1-turbo';
const SIZE = process.env.UPSTREAM_SIZE ?? '512x512';
const SHOTS = process.env.SHOT_DIR ?? '/tmp/llmimage-e2e';
const GENERATE_TIMEOUT = Number(process.env.GENERATE_TIMEOUT_MS ?? 300000);

mkdirSync(SHOTS, { recursive: true });

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const MOCK_PORT = 8099;
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/v1`;
const mock = spawn('python3', [fileURLToPath(new URL('../../scripts/mock_endpoint.py', import.meta.url)), '--port', String(MOCK_PORT)], { stdio: 'ignore' });
async function waitUp(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${url}/models`, { method: 'GET' });
      if (response.ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
const mockUp = await waitUp(MOCK_URL);

const browser = await firefox.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // --- shell ------------------------------------------------------------
  check('brand rendered', await page.getByText('llmimage').first().isVisible());
  for (const tab of ['Generate', 'Edit', 'Vary']) {
    check(`${tab} tab present`, await page.locator('nav').getByRole('button', { name: tab }).isVisible());
  }
  check('empty state before any run', await page.getByText('Nothing rendered yet').isVisible());

  if (!UPSTREAM_KEY) {
    // Without a key the GPU half is skipped; the mock half below still proves
    // streaming, usage reporting, and error handling.
    check('live endpoint checks skipped (set UPSTREAM_URL + UPSTREAM_KEY)', true);
  } else {
    // --- configure the endpoint ------------------------------------------
    await page.locator('button[title="Connection and preferences"]').click();
    const urlInput = page.locator('input[placeholder="http://127.0.0.1:8080/v1"]');
    await urlInput.fill(UPSTREAM_URL);
    await page.locator('input[type="password"]').fill(UPSTREAM_KEY);
    await page.getByRole('button', { name: 'Use this endpoint' }).click();
    await page.getByRole('button', { name: 'Test connection' }).click();
    await page.getByText(/Reachable · \d+ model/).waitFor({ timeout: 20000 });
    check('model list loaded from /v1/models', true, (await page.locator('text=Reachable').first().textContent()) ?? '');
    await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/01-settings.jpg` });
    await page.keyboard.press('Escape');

    // --- generate ---------------------------------------------------------
    // The model list arrives asynchronously; a model typed around that response must
    // survive it (an earlier build let the late list overwrite it).
    const modelInput = page.locator('input[list="model-suggestions"]');
    await modelInput.fill(MODEL);
    await page.waitForTimeout(1200);
    check('typed model survives the model-list response', (await modelInput.inputValue()) === MODEL, await modelInput.inputValue());
    await page.getByPlaceholder('Describe the image you want…').fill(
      'A neon shop sign that reads "STUDIO E2E", rainy night, cinematic',
    );
    await page.locator('button[title*="512×512"]').click();
    check('size preset applied', (await page.locator('.chip.tabular').first().textContent())?.includes(SIZE));

    const started = Date.now();
    await page.locator('footer').getByRole('button', { name: /Generate/ }).click();
    const firstImage = page.locator('figure img').first();
    await firstImage.waitFor({ state: 'visible', timeout: GENERATE_TIMEOUT });
    await page.waitForFunction(
      () => document.querySelectorAll('figure figcaption').length > 0,
      undefined,
      { timeout: GENERATE_TIMEOUT },
    );
    const caption = (await page.locator('figure figcaption').first().textContent()) ?? '';
    check('generation returned an image', caption.includes('512×512'), `${caption} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/02-generated.jpg` });

    // --- viewer -----------------------------------------------------------
    await page.locator('figure button.checker').first().click();
    await page.locator('aside h3:has-text("Request")').waitFor({ timeout: 5000 });
    check('lightbox opened with metadata', true);
    await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/03-lightbox.jpg` });
    await page.keyboard.press('Escape');

    // --- reuse the result as an edit input, then paint a mask -------------
    const card = page.locator('figure').first();
    await card.hover();
    await card.locator('button[title="Use as edit input"]').click();
    await page.getByText('Input images (1/16)').waitFor({ timeout: 5000 });
    check('result added as edit input, task switched to Edit', true);
    const editSizeChip = (await page.locator('.chip.tabular').first().textContent()) ?? '';
    check('parameters carry over to the Edit tab', editSizeChip.includes(SIZE), editSizeChip.trim());

    await page.getByRole('button', { name: 'Paint mask', exact: true }).click();
    const maskCanvas = page.locator('div.relative canvas').last();
    await maskCanvas.waitFor({ timeout: 5000 });
    const box = await maskCanvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.45, { steps: 12 });
    await page.mouse.up();
    const marked = await page.locator('p:has-text("Marked:")').textContent();
    check('mask painting reports coverage', /Marked: [1-9]/.test(marked ?? ''), (marked ?? '').trim().slice(-24));
    await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/04-mask.jpg` });
    await page.getByRole('button', { name: 'Use as mask' }).click();
    const attached = (await page.locator('p.font-medium:has-text("Mask attached")').textContent()) ?? '';
    const kb = /([0-9.]+)\s*(KB|B)/.exec(attached);
    const bytes = kb ? Number(kb[1]) * (kb[2] === 'KB' ? 1024 : 1) : 0;
    check('mask attached and non-empty', bytes > 1000, attached.trim());

    // --- run the edit -----------------------------------------------------
    await page.getByPlaceholder(/change the sign text/i).fill('Change the sign text to "EDITED E2E", keep the framing');
    await page.locator('footer').getByRole('button', { name: /^Edit/ }).click();
    // innerText uppercases the section title, so match case-insensitively.
    await page.waitForFunction(
      () => /edited images/i.test(document.body.innerText) && document.querySelectorAll('figure').length >= 1,
      undefined,
      { timeout: GENERATE_TIMEOUT },
    );
    const editCaption = (await page.locator('figure figcaption').first().textContent()) ?? '';
    check('edit returned an image', /512×512/.test(editCaption), editCaption.trim());
    await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/05-edited.jpg` });

    // --- history ----------------------------------------------------------
    await page.keyboard.press('h');
    await page.getByText(/History · \d+ runs?/).waitFor({ timeout: 5000 });
    const historyItems = await page.locator('li:has(button:has-text("Reuse"))').count();
    check('history stored both runs', historyItems >= 2, `${historyItems} entries`);
    await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/06-history.jpg` });
    await page.keyboard.press('Escape');

    // --- request preview --------------------------------------------------
    await page.locator('button[title="Show the curl request"]').click();
    await page.getByText('Request preview').waitFor({ timeout: 4000 });
    const preview = await page.locator('pre').textContent();
    check('curl preview names the endpoint', (preview ?? '').includes('/images/edits'), (preview ?? '').slice(0, 46));
    await page.keyboard.press('Escape');

    // --- light theme ------------------------------------------------------
    await page.getByRole('button', { name: 'Toggle theme' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', undefined, { timeout: 4000 });
    await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/07-light.jpg` });
    check('light theme applied', true);
  }
  if (mockUp) {
    // --- streaming against the bundled mock --------------------------------
    // Partial previews must land *while* the request is open, which only a streaming
    // upstream can show; the local engine does not implement stream: true.
    const streamPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await streamPage.goto(BASE, { waitUntil: 'networkidle' });
    await streamPage.locator('button[title="Connection and preferences"]').click();
    await streamPage.locator('input[placeholder="http://127.0.0.1:8080/v1"]').fill(MOCK_URL);
    await streamPage.locator('input[type="password"]').fill('mock-key');
    await streamPage.getByRole('button', { name: 'Use this endpoint' }).click();
    await streamPage.getByRole('button', { name: 'Test connection' }).click();
    await streamPage.keyboard.press('Escape');
    await streamPage.getByRole('switch', { name: 'Stream partial images' }).click();

    await streamPage.getByPlaceholder('Describe the image you want…').fill('Gradient study, chromatic, soft light');
    await streamPage.locator('footer').getByRole('button', { name: /Generate/ }).click();
    // With n=1 the partials refine the same tile, so the proof of a live stream is the
    // frame counter advancing before the request completes — never true for a plain call.
    await streamPage.getByText('preview 2').waitFor({ timeout: 20000 });
    await streamPage.getByText('preview 3').waitFor({ timeout: 20000 });
    const stillStreaming = await streamPage.getByText(/streaming previews/i).count();
    check('partial frames advance while streaming', stillStreaming === 1, 'preview 1 -> 2 -> 3 before completion');
    await streamPage.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/08-streaming.jpg` });
    await streamPage.locator('figure figcaption').first().waitFor({ timeout: 20000 });
    const tokChip = (await streamPage.locator('.chip', { hasText: 'tok' }).first().textContent().catch(() => '')) ?? '';
    check('completed event surfaced token usage', tokChip.includes('132'), tokChip.trim());
    await streamPage.close();

    // --- provider error surfaces readably ----------------------------------
    const errorPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await errorPage.goto(BASE, { waitUntil: 'networkidle' });
    await errorPage.evaluate((url) => {
      const key = 'llmimage.ui.v2';
      const base = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...base, baseUrl: url, params: { ...(base.params ?? {}), model: 'mock-image' } }));
    }, MOCK_URL);
    await errorPage.reload({ waitUntil: 'networkidle' });
    await errorPage.getByPlaceholder('Describe the image you want…').fill('boom');
    await errorPage.locator('footer').getByRole('button', { name: /Generate/ }).click();
    await errorPage.locator('main').getByText('Request failed').waitFor({ timeout: 20000 });
    const advice = (await errorPage.locator('main .hint').first().textContent()) ?? '';
    check('upstream error is readable with advice', /provider rejected/i.test(advice), advice.trim().slice(0, 60));
    await errorPage.close();
  } else {
    check('mock endpoint started', false, `could not reach ${MOCK_URL}`);
  }
} catch (error) {
  check('scripted session completed', false, error.message);
  await page.screenshot({ type: 'jpeg', quality: 55, path: `${SHOTS}/99-failure.jpg` }).catch(() => {});
} finally {
  if (process.env.E2E_KEEP !== '1') await browser.close();
  mock.kill();
}

const noise = consoleErrors.filter((text) => !/favicon|Download the React DevTools/i.test(text));
check('no console errors', noise.length === 0, noise.slice(0, 3).join(' | '));

const failed = checks.filter((item) => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed · screenshots in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openBlankEditor, sleep } from '../helpers/canvasEditor';

const FIXTURE = path.resolve(
  __dirname,
  '../../apps/web/src/components/editor/nodes/AnimationNode/__tests__/fixtures/retake-lot-user.json'
);

async function uploadLottieJson(page: import('@playwright/test').Page) {
  // Open media menu → Upload Lottie (reveals/focuses the hidden JSON input handler).
  const mediaMenuBtn = page.locator('[data-tour="editor-tools"] button').nth(7);
  if (await mediaMenuBtn.isVisible().catch(() => false)) {
    await mediaMenuBtn.click({ force: true });
    await sleep(200);
  }
  const lottieItem = page.getByText(/Upload Lottie|上传 Lottie|上传Lottie/i).first();
  if (await lottieItem.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // Don't wait for click to open OS dialog — set files on the hidden input instead.
    await sleep(100);
  }
  const input = page.locator('input[type="file"][accept*=".json"]').first();
  await expect(input).toHaveCount(1, { timeout: 15_000 });
  await input.setInputFiles(FIXTURE);
  await expect(page.locator('[data-lottie-timeline-dock]').first()).toBeVisible({
    timeout: 45_000,
  });
}

async function countVisibleLottiePaths(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const hosts = Array.from(document.querySelectorAll('[data-lottie-node]'));
    let paths = 0;
    for (const host of hosts) {
      const style = window.getComputedStyle(host);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      paths += host.querySelectorAll('svg path, svg rect, svg ellipse').length;
    }
    return paths;
  });
}

test.describe('LOT precomp tab → main scene preview', () => {
  test('switching back to 主场景 keeps nested LOT ink visible', async ({ page }) => {
    test.setTimeout(120_000);
    await openBlankEditor(page);
    await uploadLottieJson(page);

    const dock = page.locator('[data-lottie-timeline-dock]').first();
    await expect(dock).toBeVisible({ timeout: 45_000 });

    const mainTab = dock.getByRole('button', { name: /主场景|Main Scene/i }).first();
    const lotTab = dock.getByRole('button').filter({ hasNot: mainTab }).first();
    await expect(lotTab).toBeVisible({ timeout: 15_000 });

    await lotTab.click();
    await sleep(600);

    await mainTab.click();
    await sleep(800);

    const pathsAfter = await countVisibleLottiePaths(page);
    expect(pathsAfter).toBeGreaterThan(0);

    await lotTab.click();
    await sleep(600);

    const pathsLotAgain = await countVisibleLottiePaths(page);
    expect(pathsLotAgain).toBeGreaterThan(0);

    await mainTab.click();
    await sleep(300);
    const pathsMain = await countVisibleLottiePaths(page);
    expect(pathsMain).toBeGreaterThan(0);
  });
});

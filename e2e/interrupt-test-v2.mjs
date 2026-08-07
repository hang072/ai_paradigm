import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const ssPath = 'D:/DH/Project/paradigm_eino/e2e/screenshots/interrupts-v2';
fs.mkdirSync(ssPath, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const log = [];

  async function step(label, fn) {
    log.push(`\n=== ${label} ===`);
    try {
      await fn();
      log.push(`  [PASS] ${label}`);
    } catch (e) {
      log.push(`  [FAIL] ${label}: ${e.message}`);
    }
  }

  await step('1. Create new task', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const newBtn = page.locator('button').filter({ hasText: '新建' });
    await newBtn.click();
    await page.waitForTimeout(800);

    const articleBtn = page.locator('.ant-radio-button-wrapper').nth(1);
    await articleBtn.click({ force: true });
    await page.waitForTimeout(300);

    const select = page.locator('.ant-select-selector').first();
    await select.click();
    await page.waitForTimeout(500);

    const option = page.locator('.ant-select-item-option').filter({ hasText: '完整流程' }).first();
    await option.click();
    await page.waitForTimeout(300);

    const textarea = page.locator('textarea').first();
    await textarea.fill('写一篇关于高血压的用药教育文章，面向基层医生。');
    await page.waitForTimeout(300);

    const startBtn = page.locator('.ant-modal-footer button.ant-btn-primary').first();
    await startBtn.click({ force: true });
    await page.waitForTimeout(3000);
    log.push(`  Task created: ${page.url()}`);
    await page.screenshot({ path: `${ssPath}/01-created.png`, fullPage: true });
  });

  await step('2. Switch to "概览" tab and wait for interrupt', async () => {
    const overviewTab = page.locator('.ant-tabs-tab').filter({ hasText: '概览' }).first();
    if (await overviewTab.isVisible().catch(() => false)) {
      await overviewTab.click();
      await page.waitForTimeout(1000);
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      await page.waitForTimeout(2000);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      const overviewTab2 = page.locator('.ant-tabs-tab').filter({ hasText: '概览' }).first();
      if (await overviewTab2.isVisible().catch(() => false)) {
        await overviewTab2.click();
        await page.waitForTimeout(1000);
      }

      const bodyText = await page.locator('body').innerText();
      const hasInterrupt = bodyText.includes('等待人工') || bodyText.includes('澄清') || bodyText.includes('确认');

      // Find any input field
      const hasInput = await page.locator('input, textarea').first().isVisible().catch(() => false);

      if (hasInterrupt) {
        log.push(`  Interrupt detected on attempt ${attempt + 1}`);
        await page.screenshot({ path: `${ssPath}/02-interrupt-found.png`, fullPage: true });
        break;
      }
    }
  });

  await step('3. Submit response via send button', async () => {
    // Try to find input first
    const inputs = page.locator('textarea, input');
    const count = await inputs.count();
    log.push(`  Found ${count} input fields`);

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      if (await input.isVisible().catch(() => false)) {
        await input.fill('确认无误，请继续。重点关注药物选择和剂量计算。');
        await page.waitForTimeout(500);
        log.push(`  Filled input ${i}`);
        break;
      }
    }

    await page.screenshot({ path: `${ssPath}/03-after-fill.png`, fullPage: true });

    // Find and click send button
    const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
    if (await sendBtn.isVisible().catch(() => false)) {
      await sendBtn.click();
      log.push('  Sent response');
      await page.waitForTimeout(3000);
    }
  });

  await step('4. Wait for task completion', async () => {
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(2500);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('已完成')) {
        log.push('  Task completed successfully!');
        await page.screenshot({ path: `${ssPath}/04-completed.png`, fullPage: true });
        break;
      }
      if (bodyText.includes('等待人工')) {
        log.push('  Still waiting for human input');
      }
    }
  });

  log.push('\n\n═══════════════════════════════════════');
  log.push('        TEST SUMMARY');
  log.push('═══════════════════════════════════════');
  log.push('Screenshots: ' + ssPath);

  console.log(log.join('\n'));
  await browser.close();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });

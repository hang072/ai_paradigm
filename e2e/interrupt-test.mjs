import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const ssPath = 'D:/DH/Project/paradigm_eino/e2e/screenshots/interrupts';
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

  // ──────────────────────────────────────────
  // 1. Create task
  // ──────────────────────────────────────────
  await step('1. Create new task', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);

    const newBtn = page.locator('button').filter({ hasText: '新建' });
    await newBtn.click();
    await page.waitForTimeout(800);

    // Select type and template
    const articleBtn = page.locator('.ant-radio-button-wrapper').nth(1);
    await articleBtn.click({ force: true });
    await page.waitForTimeout(300);

    const select = page.locator('.ant-select-selector').first();
    await select.click();
    await page.waitForTimeout(500);

    const option = page.locator('.ant-select-item-option').filter({ hasText: '完整流程' }).first();
    await option.click();
    await page.waitForTimeout(300);

    // Fill brief
    const textarea = page.locator('textarea').first();
    await textarea.fill('写一篇关于高血压的用药教育文章，面向基层医生。');
    await page.waitForTimeout(300);

    // Start
    const startBtn = page.locator('.ant-modal-footer button.ant-btn-primary').first();
    await startBtn.click({ force: true });
    await page.waitForTimeout(3000);

    const url = page.url();
    log.push(`  Task created: ${url}`);
    await page.screenshot({ path: `${ssPath}/01-created.png`, fullPage: true });
  });

  // ──────────────────────────────────────────
  // 2. Wait for first interrupt (clarification)
  // ──────────────────────────────────────────
  await step('2. Wait for clarification interrupt', async () => {
    let found = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(2000);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      const bodyText = await page.locator('body').innerText();
      const hasClarify = bodyText.includes('澄清') || bodyText.includes('请问') || bodyText.includes('需要确认') || bodyText.includes('InterruptPanel');

      const input = page.locator('textarea').first();
      const hasInput = await input.isVisible().catch(() => false);

      if (hasClarify || hasInput) {
        log.push(`  Interrupt detected on attempt ${attempt + 1}`);
        found = true;
        await page.screenshot({ path: `${ssPath}/02-clarification.png`, fullPage: true });
        break;
      }
    }
    if (!found) log.push('  No clarification interrupt detected, proceeding');
  });

  // ──────────────────────────────────────────
  // 3. Submit clarification response
  // ──────────────────────────────────────────
  await step('3. Submit clarification response', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('确认无误，按照默认方向继续即可。重点关注药物选择和剂量计算。');
      await page.waitForTimeout(500);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  Sent clarification response');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${ssPath}/03-clarified.png`, fullPage: true });
      } else {
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } else {
      log.push('  No textarea found, skipping');
    }
  });

  // ──────────────────────────────────────────
  // 4. Wait for strategy confirmation
  // ──────────────────────────────────────────
  await step('4. Wait for strategy confirmation', async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(2000);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      const bodyText = await page.locator('body').innerText();
      const hasStrategy = bodyText.includes('策略') || bodyText.includes('大纲') || bodyText.includes('框架') || bodyText.includes('目录');

      if (hasStrategy) {
        log.push(`  Strategy confirmation detected on attempt ${attempt + 1}`);
        await page.screenshot({ path: `${ssPath}/04-strategy.png`, fullPage: true });
        break;
      }
    }
  });

  // ──────────────────────────────────────────
  // 5. Approve strategy
  // ──────────────────────────────────────────
  await step('5. Submit strategy approval', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('策略确认通过，大纲结构合理，建议在药物相互作用部分增加与常见降压药组合的配伍禁忌说明。请继续生成完整内容。');
      await page.waitForTimeout(500);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  Strategy approved and submitted');
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${ssPath}/05-strategy-approved.png`, fullPage: true });
      }
    }
  });

  // ──────────────────────────────────────────
  // 6. Observe content generation and review
  // ──────────────────────────────────────────
  await step('6. Observe content generation & review loop', async () => {
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(2500);
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      const bodyText = await page.locator('body').innerText();
      if (bodyText.includes('已完成')) {
        log.push('  Task completed!');
        await page.screenshot({ path: `${ssPath}/06-completed.png`, fullPage: true });
        break;
      }
      if (bodyText.includes('审核') || bodyText.includes('修订')) {
        log.push('  Review loop active');
      }
    }
  });

  // ──────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────
  log.push('\n\n═══════════════════════════════════════');
  log.push('        INTERRUPT TEST SUMMARY');
  log.push('═══════════════════════════════════════');
  log.push('Screenshots: ' + ssPath);

  console.log(log.join('\n'));
  await browser.close();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
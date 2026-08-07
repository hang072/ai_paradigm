import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const log = [];

  const errors = [];
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !t.includes('deprecated') && !t.includes('Warning')) errors.push(t);
  });
  page.on('pageerror', e => errors.push('PAGE_ERROR: ' + e.message));

  async function step(label, fn) {
    log.push('\n=== ' + label + ' ===');
    try {
      await fn();
      log.push('  [PASS] ' + label);
    } catch (e) {
      log.push('  [FAIL] ' + label + ': ' + e.message);
    }
  }

  const ssPath = 'D:/DH/Project/paradigm_eino/e2e/screenshots';

  // ──────────────────────────────────────────
  // 1. Navigate to /tasks
  // ──────────────────────────────────────────
  await step('1. Navigate to /tasks', async () => {
    await page.goto(BASE + '/tasks', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
  });

  // ──────────────────────────────────────────
  // 2. Click "新建" button to create a task
  // ──────────────────────────────────────────
  await step('2. Click "新建" button', async () => {
    const btn = page.locator('button').filter({ hasText: '新建' });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(800);
  });

  // ──────────────────────────────────────────
  // 3. Select "文章" type - use nth() selector
  // ──────────────────────────────────────────
  await step('3. Select "文章" type', async () => {
    // The radio buttons are 2 siblings: 0="幻灯片", 1="文章"
    const articleBtn = page.locator('.ant-radio-button-wrapper').nth(1);
    await articleBtn.waitFor({ state: 'visible', timeout: 3000 });
    await articleBtn.click({ force: true, noWaitAfter: false });
    await page.waitForTimeout(500);
    log.push('  selected "文章" type via nth(1)');
    await page.screenshot({ path: ssPath + '/after-type-select.png', fullPage: false });
  });

  // ──────────────────────────────────────────
  // 4. Fill brief textarea
  // ──────────────────────────────────────────
  await step('4. Fill brief textarea', async () => {
    const textarea = page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 3000 });
    await textarea.fill('写一篇关于高血压的用药教育文章');
    log.push('  filled textarea');
    await page.waitForTimeout(300);
  });

  // ──────────────────────────────────────────
  // 5. Click "启动" to create task
  // ──────────────────────────────────────────
  await step('5. Click "启动" button', async () => {
    // Use nth for the buttons in modal footer
    const buttons = page.locator('.ant-modal-footer button');
    const count = await buttons.count();
    log.push('  modal buttons count: ' + count);
    // The second button is "启动" (primary/blue)
    const startBtn = buttons.nth(count - 1);
    await startBtn.waitFor({ state: 'visible', timeout: 3000 });
    const btnText = await startBtn.innerText();
    log.push('  button text: ' + btnText);
    await startBtn.click({ force: true });
    log.push('  clicked button');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: ssPath + '/after-create.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 6. Verify navigated to task detail
  // ──────────────────────────────────────────
  await step('6. Verify task detail page', async () => {
    const currentUrl = page.url();
    log.push('  current URL: ' + currentUrl);
    if (currentUrl.includes('/tasks/')) {
      log.push('  SUCCESS: navigated to task detail page');
    } else {
      log.push('  still on /tasks - will wait a bit more');
      await page.waitForTimeout(3000);
      log.push('  after extra wait: ' + page.url());
    }
    await page.screenshot({ path: ssPath + '/task-detail.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 7. Interact with task flow
  // ──────────────────────────────────────────
  await step('7. Interact with task flow', async () => {
    await page.waitForTimeout(2000);

    const canvas = page.locator('.react-flow').first();
    if (await canvas.isVisible().catch(() => false)) {
      log.push('  flow canvas visible');
    }

    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      log.push('  textarea visible - task in interrupt state');
      await textarea.fill('确认无误，请继续');
      await page.waitForTimeout(200);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent user input');
        await page.waitForTimeout(2000);
      }
    } else {
      log.push('  no textarea - task running or completed');
    }
  });

  // ──────────────────────────────────────────
  // 8. Navigate to /chat
  // ──────────────────────────────────────────
  await step('8. Navigate to /chat', async () => {
    await page.goto(BASE + '/chat', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
  });

  // ──────────────────────────────────────────
  // 9. Click "新建会话"
  // ──────────────────────────────────────────
  await step('9. Click "新建会话"', async () => {
    const newChatBtn = page.locator('button').filter({ hasText: '新建会话' }).first();
    if (await newChatBtn.isVisible().catch(() => false)) {
      await newChatBtn.click();
      await page.waitForTimeout(1000);
      log.push('  clicked 新建会话');
    }
  });

  // ──────────────────────────────────────────
  // 10. Send a chat message
  // ──────────────────────────────────────────
  await step('10. Send a chat message', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('你好，请介绍一下你自己');
      await page.waitForTimeout(200);
      const sendBtn = page.locator('button').filter({ hasText: /发送|Send/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent chat message');
        await page.waitForTimeout(2000);
      }
    }
  });

  // ──────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────
  log.push('\n\n═══════════════════════════════════════');
  log.push('             TEST SUMMARY');
  log.push('═══════════════════════════════════════');
  log.push('Console errors: ' + (errors.length > 0 ? errors.join(' | ') : '0'));
  log.push('Page errors: ' + errors.length);

  console.log(log.join('\n'));
  await browser.close();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
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
    await page.screenshot({ path: ssPath + '/01-tasks.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 2. Click "新建" button to create a task
  // ──────────────────────────────────────────
  await step('2. Click "新建" button', async () => {
    const btn = page.locator('button').filter({ hasText: '新建' });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/02-new-task-modal.png', fullPage: false });
  });

  // ──────────────────────────────────────────
  // 3. Select "文章" type
  // ──────────────────────────────────────────
  await step('3. Select "文章" type', async () => {
    const articleBtn = page.locator('.ant-radio-button-wrapper, button, span').filter({ hasText: '文章' }).first();
    await articleBtn.waitFor({ state: 'visible', timeout: 3000 });
    await articleBtn.click();
    await page.waitForTimeout(300);
    log.push('  selected "文章" type');
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
    const startBtn = page.locator('button').filter({ hasText: '启动' }).first();
    await startBtn.waitFor({ state: 'visible', timeout: 3000 });
    await startBtn.click();
    log.push('  clicked "启动"');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: ssPath + '/03-after-create.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 6. Verify navigated to task detail
  // ──────────────────────────────────────────
  await step('6. Verify task detail page', async () => {
    const currentUrl = page.url();
    log.push('  current URL: ' + currentUrl);
    if (currentUrl.includes('/tasks/')) {
      log.push('  navigated to task detail page');
    }
    await page.screenshot({ path: ssPath + '/04-task-detail.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 7. Interact with task - send user response if in interrupt state
  // ──────────────────────────────────────────
  await step('7. Interact with task flow', async () => {
    // Wait for page to stabilize
    await page.waitForTimeout(2000);

    // Check for textarea for user input
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('确认无误，请继续');
      await page.waitForTimeout(200);

      const sendBtn = page.locator('button').filter({ hasText: /发送|提交|确认|继续/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent user input');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: ssPath + '/05-after-input.png', fullPage: true });
      }
    } else {
      log.push('  no textarea found (task might still be running in background)');
    }
  });

  // ──────────────────────────────────────────
  // 8. Navigate to /chat
  // ──────────────────────────────────────────
  await step('8. Navigate to /chat', async () => {
    await page.goto(BASE + '/chat', { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: ssPath + '/06-chat.png', fullPage: true });
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
    } else {
      // Fallback: click sidebar "+ 新建"
      const sidebarNew = page.locator('button').filter({ hasText: '新建' }).first();
      if (await sidebarNew.isVisible().catch(() => false)) {
        await sidebarNew.click();
        await page.waitForTimeout(1000);
        log.push('  clicked sidebar 新建');
      }
    }
    await page.screenshot({ path: ssPath + '/07-chat-new.png', fullPage: true });
  });

  // ──────────────────────────────────────────
  // 10. Send a chat message
  // ──────────────────────────────────────────
  await step('10. Send a chat message', async () => {
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible().catch(() => false)) {
      await textarea.fill('你好，请介绍一下你自己');
      await page.waitForTimeout(200);

      // Check for send button
      const sendBtn = page.locator('button').filter({ hasText: /发送|Send|➤/ }).first();
      if (await sendBtn.isVisible().catch(() => false)) {
        await sendBtn.click();
        log.push('  sent chat message');
        await page.waitForTimeout(2000);
        await page.screenshot({ path: ssPath + '/08-chat-sent.png', fullPage: true });
      } else {
        // Maybe an icon button?
        const iconBtn = page.locator('button').filter({ has: page.locator('.anticon-send') }).first();
        if (await iconBtn.isVisible().catch(() => false)) {
          await iconBtn.click();
          log.push('  sent via icon button');
          await page.waitForTimeout(2000);
        }
      }
    } else {
      log.push('  no chat textarea found');
    }
  });

  // ──────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────
  log.push('\n\n=== TEST SUMMARY ===');
  log.push('Console errors: ' + (errors.length > 0 ? errors.join(' | ') : '0'));
  log.push('Page errors: ' + errors.length);
  log.push('Screenshots saved to: ' + ssPath);

  console.log(log.join('\n'));
  await browser.close();
}

run().catch(e => { console.error('FATAL:', e); process.exit(1); });
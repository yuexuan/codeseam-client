import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const output = path.resolve(process.env.DIAGNOSTICS_EVIDENCE || '../docs/tasks/evidence/2026-11-04-diagnostics');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.__qa = { calls: [], recovery: 'clean', configured: false, node: false, expected: '', failProbe: false, pid: undefined };
  window.__qaCommands = ['cs_cli_info', 'cs_status', 'cs_resume', 'cs_diagnose', 'cs_configure', 'cs_restore', 'cs_sg_status', 'cs_sg_import', 'cs_sg_remove', 'cs_sg_probe'];
  window.__qaInvoke = (cmd, args) => {
    const q = window.__qa;
    q.calls.push(cmd);
    if (cmd === 'cs_status' || cmd === 'cs_resume') return { logged_in: false, services: [], proxy_running: true, configured: q.configured, cli: 'C:\\fixture\\claude.cmd', cli_pid: q.pid, local_url: 'http://127.0.0.1:18899/claude' };
    if (cmd === 'cs_cli_info') return { version: '2.0.0 (fixture)', settings_path: 'C:\\fixture\\.claude\\settings.json', settings_exists: true, settings_readable: true, env_count: 1, recovery_state: q.recovery, managed_fields: { ANTHROPIC_API_KEY: '已设置（已隐藏）', ANTHROPIC_BASE_URL: '未设置', ANTHROPIC_AUTH_TOKEN: '未设置' } };
    if (cmd === 'cs_configure') { if (q.failConfigure) throw new Error('fixture: 配置应用失败'); q.configured = true; q.recovery = 'pending_restore'; return null; }
    if (cmd === 'cs_restore') { q.configured = false; q.recovery = 'clean'; return null; }
    if (cmd === 'cs_sg_status') return { configured: q.node, expected: q.expected };
    if (cmd === 'cs_sg_import') { q.node = true; q.expected = args.expected || ''; return null; }
    if (cmd === 'cs_sg_remove') { q.node = false; q.expected = ''; return null; }
    if (cmd === 'cs_sg_probe') { if (q.failProbe) throw new Error('fixture: 节点出口测试失败'); return { ip: '192.0.2.8', expectedMatch: q.expected ? q.expected === '192.0.2.8' : null }; }
    if (cmd === 'cs_diagnose') return { generatedAt: Math.floor(Date.now() / 1000), apiProtection: 'unknown', nonApiCoverage: 'not_covered', canStart: false, checks: [
      { id: 'timezone', label: '系统时区', status: 'pass', detail: 'China Standard Time；只读事实' },
      { id: 'tun', label: 'TUN', status: 'pass', detail: '网卡已读取，不证明请求命中' },
      { id: 'clash', label: 'Clash 控制接口', status: 'pass', detail: '只读连接成功' },
      { id: 'egress_ipv4', label: '出口', status: 'fail', detail: '实测出口与预期不一致', evidence: '192.0.2.9', protected: true, remediation: '核对分配的出口' },
      { id: 'non_api', label: '非 API', status: 'warning', detail: '未覆盖；没有进程网络层证据' },
      { id: 'config', label: '配置', status: q.configured ? 'pass' : 'fail', detail: q.configured ? '配置一致' : '配置尚未应用', protected: true },
      { id: 'future_check', label: '未来检查项', status: 'unknown', detail: '新增检查不能丢失' },
    ] };
  };
});
await page.route('**/src/codeseam/lib/devMock.ts*', async route => {
  const r = await route.fetch();
  const body = (await r.text()).replace('switch (cmd) {', 'if (window.__qaCommands.includes(cmd)) return window.__qaInvoke(cmd, args); switch (cmd) {');
  assert(body.includes('window.__qaCommands.includes'));
  await route.fulfill({ response: r, body });
});
const tab = name => page.getByRole('tab', { name, exact: true });
const panel = () => page.getByRole('tabpanel').filter({ visible: true });
const button = name => page.getByRole('button', { name, exact: true });
const top = () => page.locator('main.content').evaluate(el => el.scrollTop = 0);
const screenshot = async name => {
  const dismiss = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await top(); await page.screenshot({ path: path.join(output, name), fullPage: true });
};
try {
  await page.goto(process.env.DIAGNOSTICS_URL || 'http://127.0.0.1:1420/');
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '环境诊断', exact: true }).click();
  await tab('系统环境').waitFor();
  assert.equal(await page.getByRole('tab').count(), 5);
  assert.match(await panel().innerText(), /尚未检测/);
  await button('更多诊断操作').click(); assert(await button('导出最近报告').isDisabled()); await button('更多诊断操作').click();
  await button('检测全部').click();
  await page.getByText('本次检测完成', { exact: true }).isVisible();
  await page.getByText('China Standard Time；只读事实', { exact: true }).first().waitFor();
  await button('更多诊断操作').click();
  const downloading = page.waitForEvent('download'); await button('导出最近报告').click();
  const download = await downloading; const exported = path.join(output, 'fixture-report.json'); await download.saveAs(exported);
  assert(JSON.parse(await fs.readFile(exported, 'utf8')).checks.some(c => c.id === 'future_check'));
  assert.match(await panel().innerText(), /已读取/);
  await screenshot('01-system.png');
  await tab('系统环境').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await tab('浏览器与指纹').getAttribute('aria-selected'), 'true');
  assert.match(await panel().innerText(), /真实浏览器检测/);
  assert.match(await panel().innerText(), /浏览器预览无法检测本机/);
  await screenshot('02-browser.png');
  await tab('代理与网络').click();
  assert.match(await panel().innerText(), /未来检查项/);
  await button('客户端 API 路径出口探针详情').click();
  assert.match(await panel().innerText(), /192\.0\.2\.9/);
  const nested = await page.evaluate(() => [...document.querySelectorAll('main.content *')].filter(e => e.getBoundingClientRect().height && e.scrollHeight > e.clientHeight + 2 && /^(auto|scroll)$/.test(getComputedStyle(e).overflowY)).map(e => e.className));
  assert.deepEqual(nested, []);
  const field = page.getByLabel('SS 节点链接', { exact: true });
  await field.fill('ss://fixture-not-a-real-secret');
  await page.getByLabel('预期出口 IPv4', { exact: false }).fill('192.0.2.8');
  await tab('系统环境').click(); await tab('代理与网络').click();
  assert.equal(await field.inputValue(), 'ss://fixture-not-a-real-secret');
  let guarded = false;
  page.once('dialog', d => { guarded = true; void d.dismiss(); });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '概览', exact: true }).click();
  assert(guarded); assert.equal(await tab('代理与网络').getAttribute('aria-selected'), 'true');
  await button('加密保存节点').click();
  await page.getByText('节点已加密保存，待测试；尚未应用到专属路由。', { exact: true }).waitFor();
  assert.equal(await field.inputValue(), '');
  await button('测试已保存节点出口').click();
  await page.getByText(/实测出口：192.0.2.8/).waitFor();
  await field.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, '07-node-configuration.png') });
  await page.evaluate(() => window.__qa.failProbe = true);
  await button('测试已保存节点出口').click();
  await page.getByRole('alert').filter({ hasText: 'fixture: 节点出口测试失败' }).waitFor();
  await screenshot('03-network.png');
  await button('移除本地节点').click(); await button('取消').click();
  assert.equal(await button('测试已保存节点出口').isEnabled(), true);
  await button('移除本地节点').click(); await button('确认移除节点').click();
  await page.getByText('本地节点已移除。', { exact: true }).waitFor();
  assert.equal(await button('测试已保存节点出口').isDisabled(), true);
  await tab('Claude Code').click();
  assert.equal(await button('备份并应用').isDisabled(), true);
  await panel().getByRole('checkbox').check();
  await page.evaluate(() => window.__qa.failConfigure = true);
  await button('备份并应用').click();
  await panel().getByRole('alert').filter({ hasText: 'fixture: 配置应用失败' }).waitFor();
  await page.evaluate(() => window.__qa.failConfigure = false);
  await button('备份并应用').click();
  await page.getByText(/已应用，待验证。网络保护结论/).first().waitFor();
  await button('检测全部').click();
  await page.getByText(/配置验证通过（仅 API 配置）/).first().waitFor();
  await screenshot('04-claude.png');
  await tab('高级与恢复').click();
  assert.equal(await panel().getByRole('button', { name: '恢复原配置', exact: true }).isEnabled(), true);
  await screenshot('05-recovery.png');
  await panel().getByRole('button', { name: '恢复原配置', exact: true }).click();
  await panel().getByRole('button', { name: '确认恢复 Claude API 配置', exact: true }).click();
  await panel().getByText(/已恢复，待验证。网络保护结论/).waitFor();
  assert.equal(await panel().getByRole('button', { name: '恢复原配置', exact: true }).isDisabled(), true);
  await tab('系统环境').click();
  const help = page.getByRole('button', { name: '系统检测帮助', exact: true });
  await help.focus(); assert.equal(await page.getByRole('tooltip').count(), 1);
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('tooltip').count(), 0);
  await help.click(); assert.equal(await page.getByRole('tooltip').count(), 1); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await screenshot('06-dark-1024.png');
  assert.equal(await page.evaluate(() => document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth), true);
  await page.evaluate(() => { window.__qa.recovery = 'conflict'; });
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '概览', exact: true }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '环境诊断', exact: true }).click();
  await tab('Claude Code').click();
  await page.getByText('恢复冲突', { exact: true }).first().waitFor();
  assert.equal(await button('备份并应用').isDisabled(), true);
  assert.equal(await panel().getByRole('button', { name: '恢复原配置', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  const result = { passed: true, fixturesOnly: true, screenshots: 7, checks: ['five tabs', 'keyboard navigation', 'neutral observations', 'browser preview honestly requires native backend', 'unknown checks retained', 'inline evidence', 'single vertical scroll', 'draft persistence and leave guard', 'node save/probe failure/remove', 'config consent/apply failure/recheck/restore/conflict', 'report export and empty state', 'help focus/click/Escape', 'dark 1024 layout'], consoleErrors: errors };
  await fs.writeFile(path.join(output, 'interaction-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }

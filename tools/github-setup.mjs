// =============================================================================
// 一次性把 GitHub 侧全部配好：建仓 → 推送 → 写 4 项 Secrets/Variables → 触发保活
//
//   node tools/github-setup.mjs                全流程
//   node tools/github-setup.mjs --check        只探测 token 权限和现有仓库，不做改动
//   node tools/github-setup.mjs --skip-push    仓库和 Secrets 配好，推送你自己来
//
// 需要 supabase/.env.local 里加一行（该文件已被 gitignore）：
//   GITHUB_TOKEN=ghp_xxxxxxxx
//
// Token 在 https://github.com/settings/tokens/new 生成：
//   用 Classic 最省事，勾 repo + workflow 两个 scope 就够。
//   Fine-grained 也行，但要给 Contents:RW + Administration:RW + Actions:RW。
//
// 默认建 **私有仓库**。私有库每月有 2000 分钟 Actions 免费额度，
// 保活任务一个月才跑约 48 分钟，绰绰有余；而 keepalive.yml 里那个每 20 天的
// 心跳提交，正是为了绕开「私有库 60 天无提交会被停用 schedule」这个坑。
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import libsodium from 'libsodium-wrappers';
await libsodium.ready;

const ROOT = path.resolve(import.meta.dirname, '..');
const REPO_NAME = process.env.GH_REPO || 'family-menu';
const CHECK_ONLY = process.argv.includes('--check');
const SKIP_PUSH = process.argv.includes('--skip-push');
const PROXY = 'http://127.0.0.1:7897';

function loadEnv() {
  const o = {};
  const f = path.join(ROOT, 'supabase', '.env.local');
  if (fs.existsSync(f)) {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return { ...o, ...process.env };
}
const env = loadEnv();
const TOKEN = env.GITHUB_TOKEN;
if (!TOKEN || !/^ghp_|^github_pat_/.test(TOKEN)) {
  console.error('缺 GITHUB_TOKEN（或格式不对）。在 https://github.com/settings/tokens/new 生成，勾 repo + workflow。');
  process.exit(1);
}
for (const k of ['SB_URL', 'SB_ANON_KEY', 'SB_PROJECT_REF', 'SB_MGMT_TOKEN']) {
  if (!env[k]) { console.error(`supabase/.env.local 里缺 ${k}，Secrets 配不全`); process.exit(1); }
}

const H = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

// github.com 在这台机器上直连超时，只有 api.github.com 通 —— 所以 git 走代理，API 直连
async function api(method, url, body) {
  const res = await fetch('https://api.github.com' + url, {
    method, headers: H, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 空响应 */ }
  return { ok: res.ok, status: res.status, json, text };
}
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/* ---------- 0. 探测身份 ---------- */
const me = await api('GET', '/user');
if (!me.ok) {
  console.error(`token 无效：HTTP ${me.status} ${me.text.slice(0, 200)}`);
  process.exit(1);
}
const OWNER = me.json.login;
console.log(`\nGitHub 用户：${OWNER}（${me.json.name || '未填姓名'}）`);

const existing = await api('GET', `/repos/${OWNER}/${REPO_NAME}`);
console.log(`仓库 ${OWNER}/${REPO_NAME}：${existing.ok ? '已存在，复用' : '不存在，将新建（private）'}`);

if (CHECK_ONLY) {
  const rs = await api('GET', `/repos/${OWNER}/${REPO_NAME}/actions/secrets/public-key`);
  console.log(`\n--check 模式。Secrets 端点可达性：HTTP ${rs.status} ${rs.ok ? '✓ 有写权限' : '（可能缺 repo/admin 权限或仓库不存在）'}`);
  process.exit(0);
}

/* ---------- 1. 建仓库 ---------- */
if (!existing.ok) {
  const r = await api('POST', '/user/repos', {
    name: REPO_NAME, private: true, has_issues: false, has_wiki: false,
    auto_init: false, description: '家庭点餐系统 · Vue 3 + Vite + PWA + Supabase',
  });
  if (!r.ok) { console.error('建仓失败：', r.text.slice(0, 400)); process.exit(1); }
  console.log('✓ 仓库已创建（private）');
}

/* ---------- 2. 推送 ---------- */
if (!SKIP_PUSH) {
  const clean = `https://github.com/${OWNER}/${REPO_NAME}.git`;
  try { git(['remote', 'remove', 'origin']); } catch { /* 首次跑时 origin 还不存在，正常 */ }
  git(['remote', 'add', 'origin', clean]);
  try { git(['rev-parse', '--verify', 'HEAD']); } catch {
    console.error('\n还没有提交。先跑：\n  git commit -m "init"\n（需要 git 身份，见 README 或问我）');
    process.exit(1);
  }
  // 凭据只通过 askpass 临时注入，不写进 .git/config，也不落盘
  const helper = path.join(ROOT, '.git', 'askpass.mjs');
  fs.writeFileSync(helper,
    `#!/bin/sh\ncase "$1" in\n*Username*) echo "x-access-token" ;;\n*Password*) echo "${TOKEN}" ;;\nesac\n`);
  fs.chmodSync(helper, 0o700);
  try {
    execFileSync('git', ['-c', `http.proxy=${PROXY}`, '-c', 'http.sslVerify=true',
                         'push', '-u', 'origin', 'main'],
      { cwd: ROOT, stdio: 'inherit', env: { ...process.env, GIT_ASKPASS: helper } });
    console.log('✓ 已推送到 main');
  } catch (e) {
    console.error('\n✗ 推送失败。检查代理是否开着（127.0.0.1:7897），或手动：\n  git push -u origin main');
    process.exit(1);
  } finally {
    fs.rmSync(helper, { force: true });
  }
}

/* ---------- 3. Secrets（需要 libsodium sealed box，用 tweetnacl 实现）---------- */
const pk = await api('GET', `/repos/${OWNER}/${REPO_NAME}/actions/secrets/public-key`);
if (!pk.ok) { console.error('拿不到 Secrets 公钥：', pk.text.slice(0, 300)); process.exit(1); }

function seal(plainB64, value) {
  const key = libsodium.from_base64(plainB64, libsodium.base64_variants.ORIGINAL);
  const sealed = libsodium.crypto_box_seal(value, key);
  // 必须用标准 base64。libsodium 的 to_base64 默认是 URLSAFE 变体（含 _ 和 -），
  // 直接拿去给 GitHub 会得到「写入成功、运行时解不开」的 Secret，最难查的那种坑
  return Buffer.from(sealed).toString('base64');
}

const SECRETS = {
  SB_ANON_KEY: env.SB_ANON_KEY,
  SB_MGMT_TOKEN: env.SB_MGMT_TOKEN,
};
for (const [name, value] of Object.entries(SECRETS)) {
  const r = await api('PUT', `/repos/${OWNER}/${REPO_NAME}/actions/secrets/${name}`,
    { encrypted_value: seal(pk.json.key, value), key_id: pk.json.key_id });
  console.log(r.ok ? `✓ Secret ${name} 已写入` : `✗ Secret ${name}：${r.status} ${r.text.slice(0, 160)}`);
}

/* ---------- 4. Variables（明文，无需加密）---------- */
const VARS = {
  SB_URL: env.SB_URL.replace(/\/(rest\/v1|storage\/v1)\/?$/i, '').replace(/\/+$/, ''),
  SB_PROJECT_REF: env.SB_PROJECT_REF,
};
for (const [name, value] of Object.entries(VARS)) {
  const body = { name, value };
  let r = await api('POST', `/repos/${OWNER}/${REPO_NAME}/actions/variables`, body);
  if (r.status === 409) r = await api('PATCH', `/repos/${OWNER}/${REPO_NAME}/actions/variables/${name}`, { value });
  console.log(r.ok ? `✓ Variable ${name} = ${value}` : `✗ Variable ${name}：${r.status} ${r.text.slice(0, 160)}`);
}

/* ---------- 5. 手动触发一次，激活 schedule ---------- */
const run = await api('POST', `/repos/${OWNER}/${REPO_NAME}/actions/workflows/keepalive.yml/dispatches`,
  { ref: 'main' });
console.log(run.status === 204 ? '\n✓ 已触发 keep-alive 手动运行' : `\n✗ 触发失败：${run.status} ${run.text.slice(0, 200)}`);

console.log(`
下一步（这两件只能你自己在网页上做）：
  1. 看运行结果   https://github.com/${OWNER}/${REPO_NAME}/actions
                   第一次必须手动跑成功，schedule 才会被激活
  2. 开失败邮件   https://github.com/settings/notifications
                   拉到 "Emailing notifications" → 勾选 Actions 下的
                   "Workflow failures"。不开的话保活哪天断了你不会知道。
`);

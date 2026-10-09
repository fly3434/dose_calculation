'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dist = path.resolve(__dirname, '../dist');

test('manifest and Safari icons reference existing assets at declared dimensions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of [...manifest.icons, { src: './icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const bytes = fs.readFileSync(path.join(dist, icon.src));
    assert.equal(bytes.subarray(1,4).toString(), 'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  const html = fs.readFileSync(path.join(dist,'index.html'),'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) {
    if (match[1] !== './') assert.ok(fs.existsSync(path.join(dist,match[1])), match[1]);
  }
});

function workerHarness() {
  const handlers = new Map();
  const stores = new Map([['nsflow-app-obsolete', new Map()], ['other-app', new Map()]]);
  const messages = [];
  const self = {
    registration: { scope: 'https://example.test/planner/' }, location: { origin: 'https://example.test' },
    addEventListener: (type,fn) => handlers.set(type,fn),
    clients: { claim: async () => {} }, skipWaiting: () => { self.didSkip = true; }
  };
  const caches = {
    keys: async () => [...stores.keys()], delete: async key => stores.delete(key),
    open: async name => {
      if (!stores.has(name)) stores.set(name,new Map());
      const entries = stores.get(name);
      return {
        addAll: async urls => { for (const url of urls) entries.set(url,{ url, cached: true }); },
        match: async request => entries.get(typeof request === 'string' ? request : request.url)
      };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(dist,'sw.js'),'utf8'), {
    self, caches, URL, fetch: async () => { throw new Error('Network is offline'); }
  });
  async function dispatch(type, data = {}) {
    let pending;
    handlers.get(type)({ ...data, waitUntil: promise => { pending = promise; }, respondWith: promise => { pending = promise; } });
    return pending ? await pending : undefined;
  }
  return { handlers, stores, messages, self, dispatch };
}

test('service worker caches every local resource including icons and reports readiness', async () => {
  const h = workerHarness();
  await h.dispatch('install');
  const entries = h.stores.get('nsflow-app-v1');
  assert.equal(entries.size, 10);
  for (const url of entries.keys()) {
    const relative = new URL(url).pathname.replace('/planner/','') || 'index.html';
    assert.ok(fs.existsSync(path.join(dist,relative)), relative);
  }
  await h.dispatch('message', { data: { type: 'CHECK_OFFLINE' }, source: { postMessage: message => h.messages.push(message.type) } });
  assert.equal(h.messages[0],'OFFLINE_READY');
  entries.delete('https://example.test/planner/app.js');
  await h.dispatch('message', { data: { type: 'CHECK_OFFLINE' }, source: { postMessage: message => h.messages.push(message.type) } });
  assert.equal(h.messages[1],'OFFLINE_UNAVAILABLE');
});
test('offline navigation and scripts use same-version cache without network', async () => {
  const h = workerHarness();
  await h.dispatch('install');
  for (const [url,mode] of [['https://example.test/planner/','navigate'],['https://example.test/planner/app.js','cors']]) {
    const response = await h.dispatch('fetch', { request: { url, mode, method: 'GET' } });
    assert.equal(response.cached,true);
  }
});
test('worker cleans only owned caches and updates only on explicit request', async () => {
  const h = workerHarness();
  await h.dispatch('install');
  assert.equal(h.self.didSkip,undefined);
  await h.dispatch('activate');
  assert.ok(!h.stores.has('nsflow-app-obsolete'));
  assert.ok(h.stores.has('other-app'));
  await h.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(h.self.didSkip,true);
});

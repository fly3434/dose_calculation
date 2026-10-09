'use strict';
// Live HTTP + Service Worker logic verification, not a real browser test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const origin = 'https://ns-flow-calculator.bloomyiris6.chatgpt.site/';
async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, url);
  return response;
}
(async () => {
  const legacyIndex = await request(new URL('index.html', origin));
  const live = await request(new URL('sw.js', origin));
  const worker = await live.text();
  assert.equal(worker, fs.readFileSync(path.join(__dirname,'../sw.js'), 'utf8'), 'Live worker must match the tested local repair');
  const handlers = new Map();
  const entries = new Map();
  const self = {
    registration: { scope: origin }, location: { origin: new URL(origin).origin },
    addEventListener: (type,fn) => handlers.set(type,fn),
    clients: { claim: async () => {} }, skipWaiting: async () => {}
  };
  const caches = {
    keys: async () => [],
    open: async () => ({
      addAll: async urls => { await Promise.all(urls.map(async url => entries.set(url, await request(url)))); },
      match: async req => entries.get(typeof req === 'string' ? req : req.url)?.clone()
    })
  };
  vm.runInNewContext(worker, { self, caches, URL, Response, fetch: async () => { throw new Error('Simulated offline network'); } });
  let pending;
  handlers.get('install')({ waitUntil: value => { pending = value; } });
  await pending;
  handlers.get('fetch')({ request: { url: origin, mode: 'navigate', redirect: 'manual', method: 'GET' }, respondWith: value => { pending = value; } });
  const response = await pending;
  assert.equal(response.redirected, false);
  assert.ok((await response.text()).includes('current-rate'));
  console.log(JSON.stringify({ legacyIndexRedirected:legacyIndex.redirected, repairPublished:true, cachedAssets:entries.size, offlineNavigationRedirected:response.redirected, offlineHTML:true }));
})().catch(error => { console.error(error.message); process.exit(1); });

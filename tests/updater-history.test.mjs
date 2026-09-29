import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness(invoke) {
  class Element {
    hidden = true;
    children = [];
    style = {};
    classList = { add() {}, remove() {} };
    listeners = {};
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren() { this.children = []; }
    setAttribute() {}
    addEventListener(event, handler) { this.listeners[event] = handler; }
    focus() {}
  }
  const nodes = new Map();
  const get = id => {
    if (!nodes.has(id)) nodes.set(id, new Element());
    return nodes.get(id);
  };
  const source = readFileSync(new URL('../js/updater.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export function initUpdater', 'function initUpdater');
  const context = {
    document: { getElementById: get, createElement: () => new Element(), querySelectorAll: () => [] },
    invokeDesktop: invoke, openExternal: async () => {}, console,
    requestAnimationFrame: callback => callback(), showToast() {},
  };
  runInNewContext(source + '\nthis.history = showPastVersions; this.install = installSelectedVersion;', context);
  return { context, get };
}

test('history loads every page and requires explicit selection before signed downgrade', async () => {
  const calls = [];
  const { context, get } = harness(async (command, args) => {
    calls.push([command, args]);
    if (command === 'list_past_versions') return {
      currentVersion: '3.9.17', hasMore: args.page === 1,
      items: args.page === 1 ? [{ tag: 'v3.9.16', signed: true }] : [{ tag: 'v2.2.11', signed: false }]
    };
  });
  await context.history();
  assert.equal(get('updatePastVersionsList').children.length, 2);
  await context.install();
  assert.equal(calls.length, 2);
  const row = get('updatePastVersionsList').children[0];
  row.children[1].listeners.click();
  assert.equal(get('updateDowngradeConfirm').hidden, false);
  assert.match(get('updateDowngradeQuestion').textContent, /v3.9.16/);
  await context.install();
  assert.equal(calls[2][0], 'downgrade_version');
  assert.equal(calls[2][1].tag, 'v3.9.16');
  assert.equal(calls[3][0], 'restart_app');
});

test('history errors show retry instructions rather than an empty successful list', async () => {
  const { context, get } = harness(async () => { throw new Error('offline'); });
  await context.history();
  assert.match(get('updatePastVersionsStatus').textContent, /offline.*retry/);
});

test('failed downgrade leaves the app running and reports the error', async () => {
  const calls = [];
  const { context, get } = harness(async command => {
    calls.push(command);
    if (command === 'list_past_versions') return {
      currentVersion: '3.9.17', hasMore: false, items: [{ tag: 'v3.9.16', signed: true }]
    };
    throw new Error('No compatible platform');
  });
  await context.history();
  get('updatePastVersionsList').children[0].children[1].listeners.click();
  await context.install();
  assert.match(get('updateModalMsg').textContent, /No compatible platform/);
  assert.ok(!calls.includes('restart_app'));
});

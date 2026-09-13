const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const action = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');

test('Action documentation states server constraints for array clearing', () => {
  assert.match(readme, /mc_versions[\s\S]{0,240}preserve existing/i);
  assert.match(readme, /official_tags[\s\S]{0,240}minimum/i);
  assert.match(readme, /files: \[\][\s\S]{0,160}does not clear/i);
  assert.match(action, /mc_versions[\s\S]{0,180}preserve existing/i);
  assert.match(action, /official_tags[\s\S]{0,180}minimum/i);
});

// premise-drill テストランナー（T0）。
//   node test/run.js            → test/*.test.js 全件（結合担当のみ使う）
//   node test/run.js <module>   → test/<module>.test.js だけ
// 各テストは module.exports = { name, run(assert) } の形。run は同期でも Promise でもよい。
// 終了コード = 失敗数。
'use strict';

var fs = require('fs');
var path = require('path');
var assert = require('assert');

var dir = __dirname;
var arg = process.argv[2];

function toTestFile(a) {
  var base = path.basename(String(a));
  base = base.replace(/\.test\.js$/, '').replace(/\.js$/, '');
  return base + '.test.js';
}

var files;
if (arg) {
  files = [toTestFile(arg)];
} else {
  files = fs.readdirSync(dir).filter(function (f) { return /\.test\.js$/.test(f); }).sort();
}

var pass = 0;
var fail = 0;
var results = [];

function record(ok, name, detail) {
  if (ok) pass++; else fail++;
  results.push((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '\n    ' + detail : ''));
}

async function main() {
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var p = path.join(dir, f);
    if (!fs.existsSync(p)) {
      record(false, f, 'not found');
      continue;
    }
    var mod;
    try {
      mod = require(p);
    } catch (e) {
      record(false, f, 'load error: ' + (e && e.stack || e));
      continue;
    }
    var name = (mod && mod.name) || f;
    if (!mod || typeof mod.run !== 'function') {
      record(false, name, 'module.exports.run is not a function');
      continue;
    }
    try {
      await Promise.resolve(mod.run(assert));
      record(true, name);
    } catch (e) {
      record(false, name, (e && e.stack) || String(e));
    }
  }

  results.forEach(function (line) { console.log(line); });
  console.log('');
  console.log('tests: ' + files.length + '  PASS: ' + pass + '  FAIL: ' + fail);
  process.exitCode = fail;
}

main().catch(function (e) {
  console.error(e && e.stack || e);
  process.exitCode = 1;
});

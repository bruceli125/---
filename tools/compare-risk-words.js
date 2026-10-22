/**
 * 风险词三方比对：云函数（权威） / 小程序副本 / 数据库种子
 */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/2026大挑京师家教';

const cloud = require(path.join(ROOT, 'cloudfunctions/common/riskWords.js'));
const constants = require(path.join(ROOT, 'miniprogram/utils/constants.js'));

const dbList = fs
  .readFileSync(path.join(ROOT, 'database/risk_words.json'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const codeWords = cloud.RISK_WORDS.map((w) => ({
  word: w.word,
  category: w.category || '',
  level: w.level || '',
  tip: w.tip || '',
  scope: w.scope || w.type || ''
}));

console.log('=== 代码词库 RISK_WORDS（' + codeWords.length + ' 条）===');
codeWords.forEach(function (w, i) {
  console.log('  ' + String(i + 1).padStart(2) + '. ' + w.word + '  [' + (w.category || '-') + ']  level=' + (w.level || '-'));
});
console.log('');
console.log('  字段样例: ' + JSON.stringify(cloud.RISK_WORDS[0]));
console.log('  政策类样例: ' + JSON.stringify(cloud.POLICY_RISK_WORDS[0]));

console.log('');
console.log('=== 数据库种子（' + dbList.length + ' 条）===');
dbList.forEach(function (r, i) {
  console.log('  ' + String(i + 1).padStart(2) + '. ' + r.word + '  [' + r.category + ']  level=' + r.level);
});

const codeSet = new Set(codeWords.map((w) => w.word));
const dbSet = new Set(dbList.map((r) => r.word));

const onlyDb = [...dbSet].filter((w) => !codeSet.has(w));
const onlyCode = [...codeSet].filter((w) => !dbSet.has(w));

console.log('');
console.log('=== 差异 ===');
console.log('  仅数据库有（代码里没有，不会生效）: ' + (onlyDb.length ? onlyDb.join(' / ') : '无'));
console.log('  仅代码有（数据库缺种子数据）      : ' + (onlyCode.length ? onlyCode.join(' / ') : '无'));

console.log('');
console.log('=== 小程序 constants.RISK_WORDS（' + constants.RISK_WORDS.length + ' 条）===');
console.log('  ' + JSON.stringify(constants.RISK_WORDS.slice(0, 3)));
const miniWords = constants.RISK_WORDS.map(function (x) {
  return typeof x === 'string' ? x : x.word;
});
const onlyMini = miniWords.filter((w) => !codeSet.has(w));
console.log('  与代码不一致的词: ' + (onlyMini.length ? onlyMini.join(' / ') : '无（完全覆盖）'));
console.log('  覆盖代码 15 条基础词: ' + miniWords.filter((w) => codeSet.has(w)).length + ' / 15');

fs.writeFileSync(
  path.join(ROOT, 'tools/.risk-compare.json'),
  JSON.stringify({ codeWords, dbList, onlyDb, onlyCode, miniWords }, null, 2),
  'utf8'
);

/**
 * 导出风险词库全量内容（供生成 Word 文档）
 */
const fs = require('fs');
const path = require('path');
const ROOT = 'D:/2026大挑京师家教';

const cloud = require(path.join(ROOT, 'cloudfunctions/common/riskWords.js'));
const constants = require(path.join(ROOT, 'miniprogram/utils/constants.js'));

const out = {
  version: (constants.APP_INFO || {}).version || '',
  riskLevel: cloud.RISK_LEVEL,
  riskLevelTheme: cloud.RISK_LEVEL_THEME,
  baseWords: cloud.BASE_RISK_WORDS,
  policyWords: cloud.POLICY_RISK_WORDS,
  allWords: cloud.RISK_WORDS,
  commonTips: cloud.COMMON_TIPS,
  disciplineSubjects: cloud.DISCIPLINE_SUBJECTS,
  qualitySubjects: cloud.QUALITY_SUBJECTS,
  restDayRanges: cloud.REST_DAY_TIME_RANGES,
  restDayKeywords: cloud.REST_DAY_KEYWORDS,
  earlyChildhoodGrades: cloud.EARLY_CHILDHOOD_GRADES,
  earlyChildhoodKeywords: cloud.EARLY_CHILDHOOD_KEYWORDS,
  timeRanges: cloud.TIME_RANGES,
  policy: cloud.POLICY_DOUBLE_REDUCTION,
  platformPosition: constants.PLATFORM_POSITION,
  policyConst: constants.POLICY_DOUBLE_REDUCTION
};

fs.writeFileSync(path.join(ROOT, 'tools/.risk-words-full.json'), JSON.stringify(out, null, 2), 'utf8');

console.log('=== RISK_LEVEL ===');
console.log(JSON.stringify(cloud.RISK_LEVEL, null, 2));
console.log('=== RISK_LEVEL_THEME ===');
console.log(JSON.stringify(cloud.RISK_LEVEL_THEME, null, 2));
console.log('=== COMMON_TIPS ===');
console.log(JSON.stringify(cloud.COMMON_TIPS, null, 2));
console.log('=== POLICY_DOUBLE_REDUCTION ===');
console.log(JSON.stringify(cloud.POLICY_DOUBLE_REDUCTION, null, 2));
console.log('=== 规则维度 ===');
console.log('  学科类科目: ' + JSON.stringify(cloud.DISCIPLINE_SUBJECTS));
console.log('  素质类科目: ' + JSON.stringify(cloud.QUALITY_SUBJECTS));
console.log('  休息日时段: ' + JSON.stringify(cloud.REST_DAY_TIME_RANGES));
console.log('  休息日关键词: ' + JSON.stringify(cloud.REST_DAY_KEYWORDS));
console.log('  学前年级: ' + JSON.stringify(cloud.EARLY_CHILDHOOD_GRADES));
console.log('  学前关键词: ' + JSON.stringify(cloud.EARLY_CHILDHOOD_KEYWORDS));
console.log('  时段枚举: ' + JSON.stringify(cloud.TIME_RANGES));
console.log('');
console.log('=== 21 条全字段 ===');
cloud.RISK_WORDS.forEach(function (w, i) {
  console.log('  ' + (i + 1) + '. ' + JSON.stringify(w));
});

/**
 * 通用格式化 / 脱敏 / 字典辅助工具
 * 约定：所有脱敏函数只做展示层脱敏，存储层同样按脱敏后写入（见 services/api.js）。
 */
const { STAGES, DISTRICTS, SUBJECTS, TIME_RANGES, FREQUENCIES, TEACH_MODES } = require('./constants.js');

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/**
 * 安全解析时间
 * 兼容：时间戳(number)、Date、'2026-01-08 19:24'、'2026-01-08T19:24:00.000Z'、'2026/01/08'
 * 说明：iOS 与部分安卓内核对 'YYYY-MM-DD HH:mm' 这种非标准格式会返回 Invalid Date，
 *       因此这里手动按正则拆解，保证 mock 数据里的字符串时间在真机上也能正确展示。
 */
function parseDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (!s) return null;
  // 纯数字字符串按时间戳处理
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
  if (/^\d{13}$/.test(s)) return new Date(Number(s));
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    );
    return isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(s.replace(/-/g, '/'));
  return isNaN(fallback.getTime()) ? null : fallback;
}

/** 任意时间表示 -> 毫秒时间戳（无法解析返回 0，便于排序） */
function toTimestamp(value) {
  const d = parseDate(value);
  return d ? d.getTime() : 0;
}

/** 时间戳 -> 'YYYY-MM-DD HH:mm' */
function formatDateTime(ts, pattern) {
  if (!ts && ts !== 0) return '';
  const d = parseDate(ts);
  if (!d) return typeof ts === 'string' ? ts : '';
  const p = pattern || 'YYYY-MM-DD HH:mm';
  return p
    .replace('YYYY', d.getFullYear())
    .replace('MM', pad2(d.getMonth() + 1))
    .replace('DD', pad2(d.getDate()))
    .replace('HH', pad2(d.getHours()))
    .replace('mm', pad2(d.getMinutes()))
    .replace('ss', pad2(d.getSeconds()));
}

/** 时间戳 -> '3分钟前' / '昨天 10:20'；超过 30 天直接展示日期 */
function timeAgo(ts) {
  if (!ts && ts !== 0) return '';
  const parsed = parseDate(ts);
  if (!parsed) return typeof ts === 'string' ? ts : '';
  const diff = Date.now() - parsed.getTime();
  if (diff < 0) return formatDateTime(ts, 'MM-DD HH:mm');
  if (diff > 30 * 24 * 3600 * 1000) return formatDateTime(ts, 'YYYY-MM-DD');
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return min + '分钟前';
  const hour = Math.floor(min / 60);
  if (hour < 24) return hour + '小时前';
  const day = Math.floor(hour / 24);
  if (day === 1) return '昨天 ' + formatDateTime(ts, 'HH:mm');
  if (day < 7) return day + '天前';
  return formatDateTime(ts, 'YYYY-MM-DD');
}

/** 手机号脱敏：138****8888 */
function maskPhone(phone) {
  const s = String(phone || '').replace(/\s/g, '');
  if (s.length < 7) return s ? s.slice(0, 1) + '***' : '';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/** 学号脱敏：2021****1234 */
function maskStudentNo(no) {
  const s = String(no || '');
  if (s.length <= 4) return s ? '****' : '';
  if (s.length <= 8) return s.slice(0, 2) + '****';
  return s.slice(0, 4) + '****' + s.slice(-4);
}

/** 邮箱脱敏：ab****@cnu.edu.cn */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.indexOf('@');
  if (at <= 0) return s;
  const name = s.slice(0, at);
  const domain = s.slice(at);
  if (name.length <= 2) return name.slice(0, 1) + '****' + domain;
  return name.slice(0, 2) + '****' + domain;
}

/** 姓名脱敏：王小明 -> 王** */
function maskName(name) {
  const s = String(name || '');
  if (!s) return '';
  return s.slice(0, 1) + '*'.repeat(Math.max(s.length - 1, 1));
}

/** 金额展示：120 -> '120元/小时' */
function formatPrice(price, unit) {
  if (price === 0 || price) {
    return price + '元/' + (unit || '小时');
  }
  return '面议';
}

/** 预算区间展示 */
function formatBudget(min, max) {
  if (!min && !max) return '面议';
  if (min && max) return min + '-' + max + '元/小时';
  if (min) return min + '元/小时起';
  return '不超过' + max + '元/小时';
}

/** 距离展示：3.24 -> '3.2km' */
function formatDistance(km) {
  if (km === null || km === undefined || isNaN(km)) return '距离未知';
  const n = Number(km);
  if (n < 1) return Math.round(n * 1000) + 'm';
  return n.toFixed(1) + 'km';
}

/** 根据年级取学段对象 */
function getStageByGrade(grade) {
  if (!grade) return null;
  for (let i = 0; i < STAGES.length; i++) {
    if (STAGES[i].grades.indexOf(grade) > -1) return STAGES[i];
  }
  return null;
}

/** 根据年级取学段 label */
function getStageLabel(grade) {
  const stage = getStageByGrade(grade);
  return stage ? stage.label : '';
}

/** 字典取值：pickBy(list, value, 'value', 'label') */
function pickBy(list, value, valueKey, labelKey) {
  const vk = valueKey || 'value';
  const lk = labelKey || 'label';
  const arr = list || [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i][vk] === value) return arr[i][lk];
  }
  return value || '';
}

/** 常用字典快捷取值 */
function subjectLabel(v) { return pickBy(SUBJECTS, v) || v || '不限'; }
function timeRangeLabel(v) { return pickBy(TIME_RANGES, v) || v || '时间面议'; }
function frequencyLabel(v) { return pickBy(FREQUENCIES, v) || v || '频次面议'; }
function teachModeLabel(v) { return pickBy(TEACH_MODES, v) || v || '方式面议'; }
function districtLabel(v) { return pickBy(DISTRICTS, v) || v || '地点面议'; }

/** 数组安全拼接展示 */
function joinText(arr, sep) {
  if (!arr) return '';
  if (typeof arr === 'string') return arr;
  return arr.filter(Boolean).join(sep || '、');
}

/** 截断文本 */
function truncate(str, max) {
  const s = String(str || '');
  const n = max || 30;
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 数字保留 n 位小数（返回 number） */
function round(num, digits) {
  const d = digits === undefined ? 1 : digits;
  const f = Math.pow(10, d);
  return Math.round(Number(num || 0) * f) / f;
}

/** 百分比字符串 */
function percent(score, total) {
  const t = total || 100;
  return round((Number(score || 0) / t) * 100, 0) + '%';
}

/** 安全取值：safeGet(obj, 'a.b.c', default) */
function safeGet(obj, path, def) {
  if (!obj || !path) return def;
  const keys = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < keys.length; i++) {
    if (cur === null || cur === undefined) return def;
    cur = cur[keys[i]];
  }
  return cur === undefined ? def : cur;
}

/** 深拷贝（mock 层用，避免引用共享） */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}

/** 生成简易唯一 id（mock 层用，真实环境由云数据库生成 _id） */
function genId(prefix) {
  const p = prefix || 'id';
  return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 生成认证徽章编号：JS-2026-000123 */
function genBadgeNo(seq) {
  const n = String(seq || Math.floor(Math.random() * 999999) + 1).padStart(6, '0');
  return 'JS-' + new Date().getFullYear() + '-' + n;
}

module.exports = {
  pad2,
  parseDate,
  toTimestamp,
  formatDateTime,
  timeAgo,
  maskPhone,
  maskStudentNo,
  maskEmail,
  maskName,
  formatPrice,
  formatBudget,
  formatDistance,
  getStageByGrade,
  getStageLabel,
  pickBy,
  subjectLabel,
  timeRangeLabel,
  frequencyLabel,
  teachModeLabel,
  districtLabel,
  joinText,
  truncate,
  round,
  percent,
  safeGet,
  deepClone,
  genId,
  genBadgeNo
};

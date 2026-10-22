/**
 * 全局报名状态（已报名订单 ID 数组）
 * ---------------------------------------------------------------------------
 * 【为什么需要它】
 * 接单池列表页和需求详情页各自从 services 层重算 applied，一旦某一页用 setTimeout /
 * 异步回调里的旧快照渲染，就会出现"列表已报名、详情仍显示长按报名"的错位。
 *
 * 解决：把"我报了哪些单"抽成**唯一缓存**，两页 onShow 都先读它再渲染；
 * 报名/取消后**同步写缓存**，然后才发请求/跳转。
 *
 * Storage key 按需求约定为 'appliedDemands'（数组，元素是 demandId）。
 * 与后端（applications 集合）的关系：缓存是"乐观视图"，冷启动或切换身份时用
 * syncFromServer() 以服务端为准做一次校正，避免本地脏数据。
 */
const KEY = 'appliedDemands';

/** 读取已报名 demandId 数组 */
function getIds() {
  try {
    const v = wx.getStorageSync(KEY);
    return Array.isArray(v) ? v : [];
  } catch (err) {
    console.warn('[applied] 读取失败：', err);
    return [];
  }
}

/** 覆盖写 */
function setIds(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  try {
    wx.setStorageSync(KEY, list);
  } catch (err) {
    console.warn('[applied] 写入失败：', err);
  }
  return list;
}

/** 是否已报名 */
function has(demandId) {
  if (!demandId) return false;
  return getIds().indexOf(demandId) > -1;
}

/** 标记已报名（幂等） */
function add(demandId) {
  if (!demandId) return getIds();
  const ids = getIds();
  if (ids.indexOf(demandId) === -1) {
    ids.push(demandId);
    setIds(ids);
  }
  return getIds();
}

/** 取消报名（幂等） */
function remove(demandId) {
  const ids = getIds().filter(function (id) {
    return id !== demandId;
  });
  setIds(ids);
  return ids;
}

/** 统一入口：applied=true 报名，false 取消 */
function mark(demandId, applied) {
  return applied ? add(demandId) : remove(demandId);
}

/**
 * 以服务端为准校正缓存
 * @param {string} tutorId
 * @returns {Promise<string[]>}
 */
function syncFromServer(tutorId) {
  const api = require('../services/api.js');
  return api
    .getMyApplications(tutorId)
    .then(function (res) {
      if (res && res.code === 0) {
        return setIds(
          (res.data || []).map(function (a) {
            return a.demandId;
          })
        );
      }
      return getIds();
    })
    .catch(function () {
      return getIds();
    });
}

module.exports = {
  KEY: KEY,
  getIds: getIds,
  setIds: setIds,
  has: has,
  add: add,
  remove: remove,
  mark: mark,
  syncFromServer: syncFromServer
};

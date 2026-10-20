/**
 * 云函数：login —— 获取 openid，创建或查询用户
 * ------------------------------------------------------------------
 * 入参：{ role?: 'parent' | 'tutor' }
 * 返回：{ code, data: { openid, user, tutorProfileId, parentId }, message }
 *   user          users 集合文档（含 _id / id / openid / role / nickname / phone / createdAt）
 *   tutorProfileId 师范生档案 tutors._id（role=tutor 时查询；查不到返回空串）
 *   parentId       家长侧标识（MVP 直接复用 users._id 或 openid）
 * 依赖集合：users、tutors
 * 前端调用点：miniprogram/services/api.js -> login()（app.js onLaunch/ensureLogin 会调用）
 *
 * TODO(二期)：接入手机号快捷登录 / 校园邮箱验证码，并按 role 做权限分组（RBAC）。
 */

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/** 集合名常量（避免散落的魔法字符串） */
const COLLECTIONS = {
  USERS: 'users',
  TUTORS: 'tutors'
};

/** 角色枚举（与 miniprogram/utils/constants.js ROLES 一致） */
const ROLES = {
  PARENT: 'parent',
  TUTOR: 'tutor'
};

/** 统一成功返回 */
function ok(data, message) {
  return { code: 0, data: data === undefined ? null : data, message: message || 'success' };
}

/** 统一失败返回（code 1 = 参数错误，2 = 需二次确认，-1 = 服务端异常） */
function fail(message, code, data) {
  return {
    code: typeof code === 'number' ? code : -1,
    data: data === undefined ? null : data,
    message: message || '操作失败'
  };
}

/** 文档补一个 id 字段，方便前端统一用 id 访问（云数据库主键是 _id） */
function withId(doc) {
  if (!doc) return doc;
  const out = Object.assign({}, doc);
  out.id = doc._id;
  return out;
}

exports.main = async (event, context) => {
  try {
    // ---------- 1. 参数校验 ----------
    const role = (event && event.role) || ROLES.PARENT;
    if (role !== ROLES.PARENT && role !== ROLES.TUTOR) {
      return fail('参数错误：role 只能是 parent 或 tutor', 1);
    }

    // ---------- 2. 获取 openid ----------
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) {
      console.error('[login] 未能获取 OPENID，wxContext =', wxContext);
      return fail('参数错误：未能获取用户 openid，请在真机或开发者工具登录后重试', 1);
    }

    // ---------- 3. 查询 users 集合 ----------
    let user = null;
    try {
      const res = await db
        .collection(COLLECTIONS.USERS)
        .where({ openid: openid })
        .limit(1)
        .get();
      const list = (res && res.data) || [];
      if (list.length) user = list[0];
    } catch (err) {
      console.error('[login] 查询 users 失败：', err);
      return fail('登录失败：用户查询异常（' + err.message + '）');
    }

    // ---------- 4. 不存在则创建 ----------
    if (!user) {
      const newUser = {
        openid: openid,
        role: role,
        nickname: '微信用户',
        phone: '',
        createdAt: db.serverDate()
      };
      try {
        const addRes = await db.collection(COLLECTIONS.USERS).add({ data: newUser });
        user = Object.assign({}, newUser, { _id: addRes._id });
      } catch (err) {
        console.error('[login] 创建用户失败：', err);
        return fail('登录失败：创建用户异常（' + err.message + '）');
      }
    } else if (user.role !== role) {
      // 用户在两端切换角色时同步一次（MVP 允许单账号切换角色便于演示）
      try {
        await db.collection(COLLECTIONS.USERS).doc(user._id).update({ data: { role: role } });
        user.role = role;
      } catch (err) {
        console.warn('[login] 更新用户角色失败（可忽略）：', err);
      }
    }

    // ---------- 5. 师范生档案 ----------
    let tutorProfileId = '';
    if (user.role === ROLES.TUTOR) {
      try {
        const tutorRes = await db
          .collection(COLLECTIONS.TUTORS)
          .where({ userId: user._id })
          .limit(1)
          .get();
        const tutors = (tutorRes && tutorRes.data) || [];
        if (tutors.length) {
          tutorProfileId = tutors[0]._id;
        } else {
          // TODO(二期)：新增 createTutorProfile 云函数，引导师范生首次填写档案（当前返回空串，前端走「我的认证」时提示先完善档案）
          console.warn('[login] 该师范生尚无 tutors 档案，userId =', user._id);
        }
      } catch (err) {
        // 档案查询失败不阻断登录
        console.error('[login] 查询 tutors 失败（不阻断登录）：', err);
      }
    }

    // 家长侧标识：MVP 直接复用用户主键，便于 demands.parentId 关联
    const parentId = user._id || openid;

    return ok(
      {
        openid: openid,
        user: withId(user),
        tutorProfileId: tutorProfileId,
        parentId: parentId
      },
      '登录成功'
    );
  } catch (err) {
    console.error('[login] 执行失败：', err);
    return fail('登录失败：' + (err && err.message ? err.message : '未知异常'));
  }
};

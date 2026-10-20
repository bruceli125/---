/**
 * HoldButton —— 长按确认按钮（接单专用）
 * ---------------------------------------------------------------------------
 * 交互：按住 → 左侧环形进度条从 0 增长到 100%（默认 1.2s）→ 松手完成；
 *      中途松手 / 手指移动超过阈值 / 页面滚动 → 立即取消并复位。
 * 为什么这样设计：接单是不可撤销的动作，单击误触代价高，长按能显著降低误操作。
 * 实现要点：
 *   - 进度用 conic-gradient + setInterval 每 40ms 更新一次（约 30 次 setData，
 *     比逐帧 requestAnimationFrame 更省，也避免小程序逐帧渲染掉帧）；
 *   - 不拦截 touchmove：手指滑动即取消，保证列表仍可正常滚动；
 *   - 完成后由父组件通过 done 属性回填终态，按钮自身不持有业务状态。
 */
Component({
  options: { multipleSlots: false },

  properties: {
    /** 常态文案 */
    label: { type: String, value: '申请接单' },
    /** 完成态文案 */
    doneLabel: { type: String, value: '已接单' },
    /** 按住时长（毫秒） */
    duration: { type: Number, value: 1200 },
    /** 禁用（例如已投递过） */
    disabled: { type: Boolean, value: false },
    /** 已完成（父组件回填） */
    done: { type: Boolean, value: false }
  },

  data: {
    holding: false,
    isDone: false,
    text: '申请接单',
    ringStyle: 'background: conic-gradient(#0A0A0C 0%, #E6E8EF 0)'
  },

  observers: {
    'label, doneLabel, done, disabled': function () {
      this.refresh();
    }
  },

  lifetimes: {
    attached() {
      this.refresh();
      this.paint(0);
    },
    detached() {
      this.clear();
    }
  },

  methods: {
    refresh() {
      const isDone = !!this.data.done;
      this.setData({
        isDone: isDone,
        text: isDone ? this.data.doneLabel : this.data.holding ? '按住…' : this.data.label
      });
      if (isDone) this.paint(100);
    },

    /** 绘制环形进度（0~100） */
    paint(p) {
      const v = Math.max(0, Math.min(100, Math.round(p)));
      if (v >= 100) {
        this.setData({ ringStyle: 'background: linear-gradient(135deg, #FFB27A, #FFD166, #6FE3E1, #A78BFA, #FF9EC4)' });
        return;
      }
      this.setData({
        ringStyle: 'background: conic-gradient(#0A0A0C ' + v + '%, #E6E8EF 0)'
      });
    },

    clear() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    },

    onStart(e) {
      if (this.data.disabled || this.data.isDone || this.data.holding) return;
      this._startAt = Date.now();
      this._fired = false;
      const t = e.touches && e.touches[0];
      this._startY = t ? t.clientY : 0;
      this._startX = t ? t.clientX : 0;

      this.setData({ holding: true, text: '按住…' });
      this.paint(0);
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });

      const self = this;
      const dur = Math.max(400, this.data.duration);
      this.clear();
      this._timer = setInterval(function () {
        const elapsed = Date.now() - self._startAt;
        const p = Math.min(100, (elapsed / dur) * 100);
        self.paint(p);
        if (p >= 100) {
          self.clear();
          self.complete();
        }
      }, 40);
    },

    /** 手指移动超过 10px 视为取消（避免想滚动列表时误接单） */
    onMove(e) {
      if (!this.data.holding) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - (this._startX || 0));
      const dy = Math.abs(t.clientY - (this._startY || 0));
      if (dx > 10 || dy > 10) this.cancel('moved');
    },

    onEnd() {
      if (!this.data.holding || this.data.isDone) return;
      this.cancel('released');
    },

    cancel(reason) {
      const wasHolding = this.data.holding;
      this.clear();
      this.setData({ holding: false, text: this.data.isDone ? this.data.doneLabel : this.data.label });
      this.paint(this.data.isDone ? 100 : 0);
      if (wasHolding && reason === 'released') {
        wx.showToast({ title: '已取消，请长按 1.2 秒完成接单', icon: 'none' });
      }
    },

    complete() {
      if (this._fired) return;
      this._fired = true;
      this.setData({ holding: false, isDone: true, text: this.data.doneLabel });
      this.paint(100);
      if (wx.vibrateShort) wx.vibrateShort({ type: 'medium' });
      this.triggerEvent('confirm', { at: Date.now() });
    },

    /** 阻止 tap 冒泡到卡片（catchtap 需要同名空函数） */
    noop() {}
  }
});

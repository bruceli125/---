/**
 * HoldButton —— 长按确认按钮（接单专用）
 * ---------------------------------------------------------------------------
 * 交互：按住 → 左侧环形进度 0→100%（默认 1.2s）→ 松手完成；
 *      中途松手 / 手指滑动超过阈值 / touchcancel → 立即取消并复位。
 *
 * 【为什么这样设计】接单是不可撤销动作，单击误触代价高，长按能显著降低误操作。
 *
 * 【防抖动（踩过的坑，改这里之前先读）】
 * 1. 按钮宽度必须固定：文案在「申请接单 / 按住… / 已接单」之间切换，
 *    宽度自适应会把整行撑动 —— 见 wxss 里固定的 width。
 * 2. 不做 transform: scale()：哪怕 0.985，配合列表重绘也会被感知为"抖"。
 * 3. 环形进度不加 transition：conic-gradient 不可插值，过渡会让环每帧闪烁。
 * 4. 进度更新节流到 40ms（约 30 次 setData），比逐帧 rAF 更稳。
 */
Component({
  options: { multipleSlots: false },

  properties: {
    label: { type: String, value: '申请接单' },
    doneLabel: { type: String, value: '已接单' },
    /** 按住时长（毫秒） */
    duration: { type: Number, value: 1200 },
    disabled: { type: Boolean, value: false },
    done: { type: Boolean, value: false }
  },

  data: {
    holding: false,
    isDone: false,
    off: false,
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
        // 已完成时不再叠加"禁用"淡化，否则墨色按钮会被削成半透明
        off: !!this.data.disabled && !isDone,
        text: isDone ? this.data.doneLabel : this.data.holding ? '按住…' : this.data.label
      });
      if (!this.data.holding) this.paint(isDone ? 100 : 0);
    },

    /** 绘制环形进度（0~100） */
    paint(p) {
      const v = Math.max(0, Math.min(100, Math.round(p)));
      if (v >= 100) {
        this.setData({
          ringStyle:
            'background: linear-gradient(135deg, #FFB27A, #FFD166, #6FE3E1, #A78BFA, #FF9EC4)'
        });
        return;
      }
      this.setData({ ringStyle: 'background: conic-gradient(#0A0A0C ' + v + '%, #E6E8EF 0)' });
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
      this._startX = t ? t.clientX : 0;
      this._startY = t ? t.clientY : 0;

      this.setData({ holding: true, text: '按住…' });
      this.paint(0);
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });

      const self = this;
      const dur = Math.max(400, this.data.duration);
      this.clear();
      this._timer = setInterval(function () {
        const p = Math.min(100, ((Date.now() - self._startAt) / dur) * 100);
        self.paint(p);
        if (p >= 100) {
          self.clear();
          self.complete();
        }
      }, 40);
    },

    /**
     * 原生长按事件（约 350ms 触发）
     * 微信的 bindlongpress 阈值不可配置，无法表达"按住 2 秒"，
     * 所以它只负责给一次触感反馈，真正的报名判定仍是下面的 2 秒计时器。
     */
    onLongPress() {
      if (this.data.disabled || this.data.isDone) return;
      if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
    },

    /** 手指移动超过 10px 视为取消（避免想滚列表时误接单） */
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
      this.setData({
        holding: false,
        text: this.data.isDone ? this.data.doneLabel : this.data.label
      });
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

    noop() {}
  }
});

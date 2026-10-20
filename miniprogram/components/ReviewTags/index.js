/**
 * ReviewTags —— 双向盲评的印象标签多选组（二期）
 *
 * 纯受控组件：选中态完全由页面传入的 `selected` 决定，点击只抛 change 事件，
 * 不自持内部选中状态，避免「页面状态与组件状态不一致」这类经典 bug。
 *
 * 对外契约：
 *   properties: tags(Array 可选标签) / selected(Array 已选) / readonly(Boolean) / theme('green'|'blue')
 *   events:     change({selected})
 *
 * 标签集合由 api.getReviewState() 返回（家长评老师 5 个 / 老师评家长 4 个），
 * 组件不含任何写死的标签，避免与 constants.REVIEW_TAGS 出现两份口径。
 * 说明：本项目不引入 Vant / TDesign，组件自研，保证「导入开发者工具即可运行」。
 */
Component({
  options: {
    multipleSlots: false
  },

  properties: {
    /** 可选标签（字符串数组） */
    tags: { type: Array, value: [] },
    /** 已选标签（字符串数组，由页面维护） */
    selected: { type: Array, value: [] },
    /** 只读展示（已揭晓的评价内容用） */
    readonly: { type: Boolean, value: false },
    /** 选中态配色：green（默认，老师侧）| blue（家长侧） */
    theme: { type: String, value: 'green' }
  },

  data: {
    items: []
  },

  observers: {
    'tags, selected': function () {
      this.refresh();
    }
  },

  lifetimes: {
    attached() {
      this.refresh();
    }
  },

  methods: {
    /** 把「可选标签 + 已选集合」摊平成可渲染的列表（WXML 里不做计算） */
    refresh() {
      const all = this.data.tags || [];
      const selected = this.data.selected || [];
      const items = all.map(function (label) {
        return {
          label: label,
          active: selected.indexOf(label) > -1
        };
      });
      this.setData({ items: items });
    },

    /** 点击标签：切换并抛出新数组，由页面 setData 回传 */
    onTap(e) {
      if (this.data.readonly) return;
      const label = e.currentTarget.dataset.label;
      if (!label) return;
      // 只允许选择 tags 中存在的标签（防止页面传来脏数据）
      if ((this.data.tags || []).indexOf(label) === -1) return;

      const next = (this.data.selected || []).slice();
      const index = next.indexOf(label);
      if (index > -1) {
        next.splice(index, 1);
      } else {
        next.push(label);
      }
      this.triggerEvent('change', { selected: next });
    }
  }
});

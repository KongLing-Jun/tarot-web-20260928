# 月相星轨 · 牌阵选择素材

仅供手动占卜的选择牌阵页面使用。文字、操作按钮和牌位标签由真实 HTML 渲染；SVG 只负责按现有牌位数据排列卡背图片。

| 文件 | 用途 |
| --- | --- |
| sky.webp | 黑紫背景、外围细星轨与紫雾 |
| moon-crown.webp | 顶部七个月相，真实透明 |
| card-frame.webp | 金色双线卡框，黑底；用 border-image 九宫格和 screen 混合，避免拉伸角部 |
| card-back.webp | 牌阵示意用月亮卡背；不代表抽取结果 |
| orbit.webp | 卡面内的透明星轨 |
| star.webp | 从同一星轨素材裁出的透明星芒 |

图像使用内置 Image Gen，以用户选定的“月相星轨”修正版为参照独立生成。随后只做裁切、尺寸调整与 WebP 压缩；没有把整张效果图作为可点击页面使用。生成素材的纹理与确认稿有细微差异。

字体为官方 Noto Serif CJK SC 的 Regular / Light 子集，内部名称为 Miying Spread Serif，分别绑定 400 / 300 字重。来源固定为 notofonts/noto-cjk 的 f8d157532fbfaeda587e826d4cd5b21a49186f7c 修订；完整许可见 FONT-LICENSE.txt。当前可见页面文案、六种牌阵的名称与牌位名均已覆盖。新增中文文案时需要重新生成子集并检查 cmap，系统宋体作为回退。

验收记录见项目根目录 design-qa.md。

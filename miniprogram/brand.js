// 前端品牌的唯一配置源；网页与小程序共用。这里只能放公开展示文案。
// 修改后运行 npm run brand:sync，同步小程序静态导航栏标题。
const englishName = 'moonlit';

module.exports = Object.freeze({
  name: '月映卡语',
  englishName,
  englishTitle: englishName.charAt(0).toUpperCase() + englishName.slice(1),
  englishWordmark: englishName.toUpperCase(),
  tagline: '给自己一个新的观察角度',
  description: '借助塔罗牌与 AI 解读，梳理问题，探索自己的想法。',
});

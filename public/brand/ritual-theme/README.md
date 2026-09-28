# 洗牌 / 抽牌阶段素材

仅在 `RitualScene`、`CardDeck`、`FanDeck` 阶段使用；文字和交互由真实 HTML 控件承担。

| 文件 | 来源与用途 |
| --- | --- |
| `table.webp` | ImageGen 独立牌桌背景，详见 [table-source.md](table-source.md) |
| `gold-foil.webp` | ImageGen 纯烫金纹理，详见 [gold-foil-source.md](gold-foil-source.md) |
| `ritual-light.woff2` | Noto Serif CJK SC Light，300 字重，SIL Open Font License 1.1；许可证见 [FONT-LICENSE.txt](FONT-LICENSE.txt) |
| `icons/*.svg` | Tabler Icons v3.34.1 outline，MIT；许可证见 [icons/LICENSE](icons/LICENSE) |

字体原文件：[NotoSerifCJKsc-Light.otf](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Light.otf)。从官方固定修订提取当前页面文字子集，非完整中文字库；任意用户输入缺字按 CSS 中宋体及系统 serif 回退。没有将文字烘焙进图片。子集脚本：`scripts/build-ritual-font.py`，传入本地官方源字体及输出路径；依赖 fonttools、brotli，仅为素材构建工具，未新增运行时依赖。

图标官方来源模板：`https://raw.githubusercontent.com/tabler/tabler-icons/v3.34.1/icons/outline/{name}.svg`。辅助操作优化新增 `feather.svg`、`cards.svg`，不通过第三方网络加载；原图标文件保留。

辅助操作的细金边复用 `public/brand/spread-theme/card-frame.webp`，通过 border-image 九宫格保留角部比例，并以 screen 混合滤去黑底；星点复用 `star.webp`。文字、图标、禁用状态和点击范围均独立于装饰图片。

复用素材未修改：狐狸 `public/brand/miying-fox.webp`；卡背 `public/brand/spread-theme/card-back.webp`；洗牌轨道 `public/brand/spread-theme/orbit.webp`。默认 CardBack 外观保持原实现，阶段外观需要显式传入 `appearance="ritual"`。

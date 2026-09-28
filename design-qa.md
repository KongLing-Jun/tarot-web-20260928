# Product Tour · 按账号首次展示

日期：2026-09-24。用户确认新老账号没有记录都展示一次，并选择用户表字段方案。

实现：`tarot_users.product_tour_version`（默认 0）与 `product_tour_status`（默认 NULL），不新增表。首页登录就绪且有效 GET 确认尚未看过才自动启动；主动完成/跳过保存，页面隐藏、卸载、目标异常不保存。保留首页手动入口与个人页 replay。专用账号绑定阻止换账号后的旧结果串写，版本与完成状态只能前进。读取失败不视为未看过，保存失败会明确提示。

Pro：同一审阅会话显式选择 Latest 并确认 Pro，完成首次自动展示审阅及两字段替代方案复核（后者思考 3m 6s）。采纳成对约束、同版本完成优先、未来版本不可降级、Cookie 账号所有权、缺失用户不视为未看过、限时迁移和隔离测试。用户明确只需单一引导的最新确认状态，因此不保留独立历史表。

验证：85 项前端/API/页面回归、7 项真实 PostgreSQL 集成测试通过；TypeScript、定向 ESLint、品牌检查与生产构建通过（108 页面）。覆盖新旧用户默认、跨会话、并发完成/跳过、未来版本不降级、迁移重跑、非法字段组合、同名异表约束、资料/登录不覆盖状态与账号隔离。原有五步、StrictMode、手动优先、后台中断和焦点测试继续通过。

开发库：用户明确授权后，仅执行 `020_product_tours.sql`。确认 PostgreSQL 16、public schema 无原方案表/字段和用户表自定义触发器；执行后核对 integer/text 类型、默认值、非空标记及已验证的成对 CHECK。未执行其他迁移或部署生产。

浏览器：无查询参数首页自动打开；主动跳过后刷新不再弹出；首页手动入口和个人页「再看一次」均可重看，replay 参数被清理；五步走完及完成退出正常，再次进入首页不自动启动。390×844 下提示卡宽 340px、处于视口内，按钮高 44px、text-align:center；暖黑配色与批准的几何保持。控制台无 error/warn。截图 `docs/verification/product-tour/first-use-auto.png`。通过浏览器直接导航 API 被客户端阻止，状态语义由真实数据库集成测试及页面行为验证，未绕过限制。

剩余边界：微信 iOS/Android 真机仍待发布前验证。网络保存失败后下次可能重现；并发页面在任一保存前均可能启动。浏览器测试已确认当前预览游客账号，不重置其状态；如需再次查看可用手动入口。

final result: passed (development database + browser preview)

---

# Product Tour · 按钮文字居中修正

日期：2026-09-24。用户截图反馈主按钮文字位置不协调。

根因：Driver.js 1.8.0 在前后按钮上写入内联 `display: block`，覆盖自定义 `inline-flex`；按钮文字继承 vendor footer 的 `text-align: right`。实测「下一步」水平偏右 5.86 CSS px，「完成」偏右 12.98px；纵向中心误差仅 -0.1px。

实现：只在现有 scoped footer-button 规则添加 `text-align: center`，删除该规则三条失效的 Flex 声明。保留字体、行高、尺寸、颜色和 Driver.js 的显示/隐藏控制。

Pro：同一审阅会话中重新明确选择 Latest + Pro，等待完整答复后实施；采纳局部文本居中、避免强制 display 与逐按钮偏移补丁的建议。没有采纳会改变字体或几何的处理，因为测量已经定位到水平继承问题。

验证：390×844 与 320×568，各走完整五步，Next/Previous/Done 的 computed text-align 均为 center，文字 Range 水平中心最大误差小于 0.001px，纵向仍为 -0.1px，按钮高度均为 44px。返回、完成、跳过及焦点恢复正常，退出后遮罩和弹层归零。现有 ProductTour 7 项测试、品牌检查、Prettier 与 diff 检查通过。无需新增模拟布局的 jsdom 测试。

已打开同视口、同首步的前后并排截图 `docs/verification/product-tour/button-align-comparison.png`：两侧留白对称，按钮文字居中，其他排版保持。原图 `button-align-before.png`、`button-align-after.png`；末步和窄屏截图 `button-align-done.png`、`button-align-small.png`；测量 `button-alignment.json`。原生微信字体渲染仍待真机复查。

final result: passed (browser preview)

---
# Product Tour · 柔和版视觉 QA

日期：2026-09-24。用户认可原文案，要求减弱方正、硬朗感，面向主要女性用户提升亲和与精致感。

## 设计与对照

采用 22px 圆角、低对比细边、暖黑底与轻微暖光明暗、暖米金标题和香槟色胶囊主按钮；移除底部分隔线，以留白分组。保留 23px 衬线标题、15px/1.85 正文、五步文案、原页面资产与交互。高亮轮廓半径由 3px 调整为 8px。

已打开 `docs/verification/product-tour/v3-visual-comparison.png`，将原 MIYING 参考、旧首步和新首步放在同一张图检查。旧/新截图 CSS viewport 均为 390×844，原模板只比较视觉语言。新版卡片更圆润、边框更轻，按钮主次清晰；首步高度约 281px，未通过压缩字号获得空间。用户要求的柔化优先于模板原有硬边框，原参考文件未改。

## 实际验证

- 390×844、320×568、844×390、667×375，各检查全部五步：提示层未覆盖当前入口、未越出视口，按钮无裁切、点击区域至少 44px，无页面横向溢出。几何证据：`docs/verification/product-tour/v2-geometry.json`。
- 横屏复查发现原可滚动容器中的外伸箭头制造内部横向滚动条；仅在短屏隐藏装饰箭头，保留高亮与提示位置，复查十个横屏状态均为 scrollWidth = clientWidth = 338。图片：`v2-step-2-844.png`、`v2-step-2-667.png`。
- 可见文字按最亮面板背景 #1c1a18 保守计算：正文 13.67:1、标题 13.28:1、眉题/进度 8.85:1、跳过 6.27:1；主按钮文字 13.51:1。
- 实际检查返回、完成、Tab 焦点、Escape 退出；退出后焦点回到启动按钮，遮罩及提示层为零，滚动锁释放。控制台无 error/warn。
- 现有 ProductTour 测试 7/7 通过；品牌检查、定向 ESLint、Prettier 和 diff 检查通过。本次未重复生产构建，未增加依赖或调整组件加载。

用户随后明确不喜欢紫底，最终仅将提示卡表面、眉题/进度、箭头与悬停色改为暖黑/米金中性色；保持已验证几何尺寸。重新截图检查首步与第三步、计算对比度，最终截图为 v3；v2 几何证据仍对应相同尺寸和行为。此调整沿用 Pro 已审阅的暖色表面方案，并按用户偏好去除雾紫。

## 交付与边界

本地预览：`http://localhost:3001/?tour=welcome`。截图：`v3-tour-preview.png`，窄屏截图 `v2-step-3-small.png`。文件保留在已有忽略目录中。

Pro（Latest + Pro）完整审阅后实施，采纳小范围 CSS 调整、22px 圆角、8px 高亮圆角、44px 操作区与对比度要求；未把女性市场等同于粉色。短屏装饰箭头隐藏是根据实际滚动条证据做的局部取舍。

已检查尺寸无已知未解决视觉问题。真实微信 iOS/Android、系统大字体/200% 文本与读屏仍待发布前验证；本地预览不等于真机验收。

final result: passed (local preview)

---
# Product Tour · 视觉 QA

日期：2026-09-24。

## 对照范围

- 风格源：`C:/Users/admin/.codex/skills/artifact-template-miying/assets/reference.png`，315×605 PNG；原文件未修改。
- 当前页面源：`docs/verification/product-tour/home-before.png`，388×839 PNG，CSS viewport 390×844。
- 实现：`http://localhost:3001/?tour=welcome`。
- 实现截图：`docs/verification/product-tour/step-1-mobile.png`、`step-3-mobile.png`，均为 390×843 PNG，CSS viewport 390×844，报告 DPR 约 1。
- 并排比较：`docs/verification/product-tour/visual-comparison.png`。各列在 390×844 框中保持原比例缩放；截图与 CSS 视口的少量像素差不作为布局问题。
- 用户批准跳过三张生图方案，直接依据模板与现有页面制作可交互引导。

模板是轨迹页面，实作为首页引导，状态与内容不同：只比较视觉语言，不把模板中的记录、月相排版或列表位置当作首页的像素级目标。首页前后截图用于确认已有布局与资产得到保留；第三步因导航定位发生滚动，按相同元素比较，不按绝对页面纵坐标比较。

## 可见结果

已实际打开并排对照图：墨黑底、暖白正文、古金标题与细边框一致；六项导航保留，现有狐狸、星空、入口按钮未被重绘。提示卡区分眉题、标题、正文与底部操作，未加入套层卡片。首步高亮提问入口，第三步高亮「今日」；提示卡未遮挡当前目标。局部检查覆盖标题、分隔线、进度及按钮，关闭按钮实测 60×44，前后按钮约 68×44 CSS px。

## 修正与复查

1. P2：Driver.js 自带 aria-labelledby 优先于自定义标签，使读屏遗漏步数。删除冲突属性后，浏览器可访问树与自动化测试均显示「第 N 步，共 5 步」。
2. P2：667×375 横屏中第二步默认提示卡覆盖「自己选择牌阵」。修正为短屏下先把主入口滚至顶部约 24px；复查目标 bottom≈75.6、提示卡 top≈94.8，两者无重叠。修正证据：`docs/verification/product-tour/step-2-small-landscape.png`。
3. 复查：320×568 中首步自动位于目标上方，第三步位于底栏上方；844×390 中首步位于按钮右侧。证据：`step-3-small.png`、`step-1-landscape.png`。
4. 初始 replay 的锚点仍有入场位移动画，加入有限入场动画等待，回归测试验证动画完成前不出现遮罩。普通开启无额外固定延迟。

## 交互验证

首页主动开启；下一步、上一步、跳过、完成；「我的」重看后从首步开始且 replay 参数被消费；结束后焦点回到按钮，遮罩数量归零，滚动锁释放。真实 Driver.js 测试另覆盖 Strict Mode、异步启动取消、页面隐藏、背景隔离与缺失目标。内置浏览器 error/warn 日志为空。

## 剩余验证范围

无已知 P0/P1/P2 视觉问题留在已检查的预览尺寸中。微信 iOS/Android 真机、系统大字体/200% 缩放、原生返回与读屏尚未实测；必须在发布前补做。这份 QA 仅对本地浏览器预览负责，不等同于微信上线验收。

final result: passed


---

# 首页品牌：第二版双行排版 — 2026-09-18

final result: passed

- 本次范围：主页品牌名称与排版，顶部 `Tarot & AI Reflection`、双行“月映 / 卡语”、下方 `Moonlit Tarot`。主页页脚和入口可访问名称同步更新。
- 参考：`C:/Users/admin/.codex/generated_images/01a0afb6-514e-7a10-8914-76316e74e508/exec-9fac7501-275f-400b-9b1b-de733d3270e1.png`（853×1844）；等比归一到 390×844，与实际首页并排检查。
- 证据目录：`C:/Users/admin/.codex/visualizations/2026/09/17/01a0afb6-514e-7a10-8914-76316e74e508/`，`home-brand-comparison.png` 为最终并排对比；`home-brand-390.png`、`home-brand-320.png` 为实际浏览器截图；`wechat-home-brand-final.jpg` 为微信开发者工具截图，非真机。
- 字体：原首页标题字体仅含“觅映”，从同源 ZCOOL XiaoWei Regular 制作四字子集 `home-title-yueying.woff2`，沿用 `home-title-OFL.txt` 许可。英文沿用原首页斜体。实际字体与生成图存在细微笔形差异，保留原站字体体系。
- 布局：首次对比发现顶部留白偏少，增加移动端顶部空间 24px 后重新截图比对。中文双行、英文完整、狐狸无重叠；320/390/1280px 无横向溢出。保留现有桌面双按钮布局。
- 色彩与素材：复用原首页金色渐变、狐狸及眨眼效果、星光、角饰、按钮、分隔图。生成图的星光分布、狐狸细节和第二按钮亮度与原站素材不同，本次未替换这些既有素材或交互层级。
- 文案与功能：两段英文均保留，中文标题可访问名称为完整“月映卡语”；牌阵入口实际点击进入 `/reading`，新对话入口保留 `/agent?new=1`。每日牌使用当前实际数据。
- 验证：页面资源加载成功，浏览器未捕获 error；首页 ESLint、TypeScript、git diff --check 通过。本轮无未解决的排版或缺字问题，真机视觉验收仍由用户确认。

---

# 今日一牌：第二张设计稿 — 2026-09-17

final result: passed

## 对比目标与证据
- 用户选择第二张，源图：`C:/Users/xiaox/.codex/generated_images/01a0ad8e-e3ed-78d3-82ab-ed0bb4ce9b8f/exec-2b96ceba-6e86-4859-a461-ac7945325abc.png`，853×1844。
- 最终截图：`docs/verification/daily-redesign/daily-mobile.png`，390×844 CSS px，DPR 1。源图等比归一到390×844，去除尺寸差异后生成 `comparison.png` 并实际打开检查，左源图、右正式构建。
- 状态：2026-09-17，星币7正位，尚未生成解读。页面使用真实日期抽牌逻辑和牌面；登录、札记API通过隔离内存fixture，未写真实账号。fixture代理本地3000生产构建。
- 完整并排图已能清楚辨认标题、关键词、正文、按钮及底栏；本次无需额外放大局部图。
- 补充截图：`daily-history-320.png`（320px，宝剑王牌、五关键词）、`daily-desktop.png`（1024×900）。两者为同一最终源码的开发预览。

## 发现与修复
- 已修复 P2：第一轮标题区及段落间距过大，札记入口被底部导航遮挡。收紧标题、牌义、解读区域间距及札记行高度，保留15px牌义和44px以上控件点击区。最终390×844正式构建中生成按钮、札记整行都完整可见，见最终comparison.png。
- 最终没有未解决的P0/P1/P2问题。
- 可接受差异：保留项目真实牌面及“星币7 / 7 of Pentacles”数据，不用生成图中的“星币七 / Seven of Pentacles”替换业务数据。沿用已有羽毛和导航图标、古书边框、品牌字体；源图更粗的展示字体没有另加网络字体。
- P3：生成的细金植物比源图略暗；不遮挡关键词。后续可按审美反馈微调。

## 五项视觉检查
- 字体：复用牌典中文衬线字体及首页英文斜体。牌名、日期、关键词、辅助文字层级明确；320px长牌名与五关键词可换行，无横向溢出。
- 间距：左牌右文，牌义左对齐，下接解读和札记。390px首屏两入口完整，短屏正常纵向滚动，桌面保留侧边导航。
- 色彩：复用ink-deep、bone、gold-warm、gold-pale等token；星空、月云复用品牌图片，与现有页面统一。
- 图片：保留真实牌面、正逆位、图片加载重试；新增180×200透明细金植物，无不透明黑底，无拉伸。源图的布局与实际并排检查过。
- 内容：日期、牌名、关键词、牌义来自既有逻辑。每日札记入口链接到原编辑区，保留14日记录、AI流式输出与错误重试；没有把设计说明放进页面。

## 验证和限制
- 5个相关测试文件、30项测试全部通过：DailyPage、DailyCardPreview、useDailyNote、daily、dailyStorage。
- ESLint及生产构建（含TypeScript）通过。
- 浏览器隔离验证：点击札记锚点、编辑并保存内存札记、切换日期并返回今日恢复内容、模拟503显示错误与重试入口。没有调用真实模型或写入真实账户。
- 正式构建重新截图后控制台error列表为空。320px与1024px无横向溢出。
- 3000已启动更新后的生产预览。无登录态的直接访问按原逻辑展示微信登录提示；4113提供隔离登录态预览，便于查看设计，不代表真实账户数据或线上部署。
- 微信真机未实测，真实模型请求未在本轮执行。设计实现阶段未发布线上；后续Git集成记录见下文。

## Git 集成验证 — 2026-09-17
- 已合并远端main `45dc55c`，业务代码无冲突，保留远端最新聊天归档、导航与小程序更新。
- 合并后全量测试732项通过、75项跳过（73个文件通过、3个文件跳过）。存在React测试act提示，无失败。
- 合并后ESLint、生产构建（含TypeScript）及diff空白检查通过。
- 本机小程序develop联调地址和videos目录继续仅保留本地，不纳入PR。
- 本轮PR范围仅今日页面、植物素材、测试与此验证记录；未部署线上。

## 实施检查
- [x] 按第二张重排今日页面并放置全部资产。
- [x] 保留日期、抽牌、解读、札记和轨迹业务逻辑。
- [x] 手机与桌面检查，修复首屏遮挡后重新对比。
- [x] 相关测试、lint和生产构建通过。

---

# 古书页签：第二种小按钮方案 — 2026-09-17

final result: passed

本记录取代下方上一轮圆角填充小按钮的外观方案；历史验证记录保留。

## 对比目标与证据
- 用户选择第二张展示图，源文件：`C:/Users/xiaox/.codex/generated_images/01a0ad8e-e3ed-78d3-82ab-ed0bb4ce9b8f/exec-ef4213e3-9416-49ce-8e45-0b1ae57c4f7f.png`，1024×1536。
- 源图为 12 个页面的局部概念板，不是 12 个完整页面的等比例截图。本次范围是小按钮，保留真实页面布局、大 CTA、内容、底栏及现有交互；不将概念板横向分栏强行应用到移动页面。
- 实际截图：`docs/verification/manuscript-actions/library-production-390.png`、`detail-production-390.png`、`profile-390.png`、`history-390.png`、`profile-320.png`、`credits-320.png`、`feelings-320.png`。
- CSS viewport 390×844 / 320×740，DPR 1。正式构建的列表和详情截图显式裁剪为 390×844。列表状态为大阿卡纳选中、访客收藏数 0；详情为愚者。个人页及感受弹窗使用隔离 preview harness 的测试账户数据，未修改真实账户。
- 已打开检查完整并排图 `comparison-full.png`：左为源图等比缩到高 844，其后为实际列表、详情、个人页。局部并排 `comparison-controls.png` 对照分类、收藏与个人资料按钮，按控件区域等宽显示；源板和真实页面布局差异不作为逐像素误差衡量。

## 发现与修复
- 已修复 P2：初次渲染中 CSS 处理器省略 `border-image: none`，未选中分类和独立收藏图标仍继承装饰框。改用 `border-image-source: none`。修改后浏览器 computed style 确认普通分类和收藏为 none，选中分类为 manuscript-frame；正式构建再次检查结果相同。
- 已修复 P2：原生按钮按压态曾额外设置实色 border-color，可能叠出直角实框。删除该覆盖，按压只改变底色。
- 最终对比未发现未解决的 P0/P1/P2。详情返回保留用户此前要求的纯箭头和 44px 点击区，使用同款古金折角框；概念板“返回”文案不是本次要求新增的文案。

## 五项视觉检查
- 字体：复用各页现有宋体风格和正文字体，辅助文字 14px，头像/昵称提示 12px；没有引入新字体下载。窄屏按钮文案可读，无裁切。
- 间距：普通文字操作保留 44px 最小高度，图标 44×44；页签边角使用同一九宫格图片。布局和大按钮保持原有层级。320px 个人页和充值页检查无横向溢出。
- 色彩：复用 ink-deep、ink-surface、gold-warm、gold-pale 等主题变量；深底细金线，普通分类透明、选中才加框。关闭、发送及书签图标无外圈；昵称为羽毛及下细线。
- 图片：新生成的透明 PNG 256×96，slice 12 / width 8px；完整并排及局部图中边角清晰、无黑色不透明底。图标沿用现有官方图标资源，未替换牌面、背景和品牌插画。
- 文案：保留现有业务文案、可访问名称、选中语义、禁用态及焦点提示；没有把设计说明写入产品页面。

## 验证与范围
- PR 提交前复核：远端 main 为 d75bd23，当前分支已包含该版本，无合并冲突。全量测试 727 项通过、75 项跳过；最终 ESLint 和生产构建通过。
- 复核修正：轨迹管理中的整条记录选择区域沿用原有整行点击样式，避免 44px 小图标规则缩小选择范围；修正后 HistoryArchive 的 5 项交互测试全部通过。
- 71 项相关测试通过（MobilePages、LibraryDesign、favorites-ui、profile-ui、miniapp，5 文件）。ESLint 通过；生产构建（含 TypeScript）通过；git diff --check 通过，仅现有行尾转换提示。
- 浏览器操作：分类切换、打开完整牌义、返回牌典、感受勾选和关闭均正常；关闭后 dialog 数量为 0。正式预览控制台 error 列表为空。
- 本地 3000 正式预览和 3001 开发服务已更新。生产预览核实新边框资源加载及分类/书签样式。
- 微信真机、原生 WXML/WXSS 的 border-image 最终渲染尚未实测；已调整两个原生提示/支付返回页的共享样式，需开发者工具重新编译及真机确认。未部署线上。

---
# 全站辅助按钮主题统一 — 2026-09-17

final result: passed

- 按用户要求统一小按钮，大 CTA、牌面本体、整行内容卡片和底部导航保留原有设计。采用显式 `data-small-action` 标记，避免全局覆盖所有 button；共享样式位于 `app/_styles/small-actions.css`，从根 layout 导入。
- 图标按钮延续已确认的 44px 金边圆形样式；文字按钮采用相同金色、边线和底色，圆角 8px；菜单项保留行式布局，分类/收藏/感受保留选中语义及视觉状态。头像和昵称的辅助提示只调整提示外观，保留原控件点击范围。
- 覆盖牌典/详情、提问/对话、解读报告、选阵/抽牌辅助操作、今日、轨迹/历史、我的/头像/充值，以及原生小程序错误页和支付返回页。没有调整点击处理、数据源、支付或登录流程。
- 390×844 实际查看牌典、提问页、感受弹窗、轨迹；320×740 实际查看个人页、充值、选阵、提问及选项。截图在 `docs/verification/small-actions/`。确认个人页和充值无横向溢出；感受选中值与 data-selected 均为 true，关闭后 dialog 数量为 0。
- 最终生产预览检查圆形按钮实际为 44×44px，颜色 rgb(219,191,122)，详情返回操作正常。3000 生产预览及 3001 开发服务均使用新主题。
- 验证：全量 727 项通过、75 项跳过；ESLint、包含 TypeScript 的正式构建、diff 空白检查通过。最后少量纯样式/标记补齐后重新完成构建及 ESLint，未重复全量测试。
- 登录态页面用现有 preview harness 的隔离内存数据验证，未写入真实账户；微信真机与原生 WXML/WXSS 渲染未实测，需重新编译小程序查看两个原生页。线上未发布。

---

# 牌义详情返回按钮 — 2026-09-17

final result: passed

- 用户要求将右上角关闭图标改成符合当前主题的返回标志。采用已有箭头图标旋转为左箭头，复用 gold-warm/gold-dim/gold-faint，增加细圆环；点击区域保持 44px。
- 390×844 浏览器实际检查并截图：`C:/Users/xiaox/.codex/visualizations/2026/09/17/library-redesign/detail-back-button.png`（390×100 顶栏裁剪）。已确认金色返回箭头、布局及点击后焦点返回原牌。可访问名称更新为“返回牌典”。
- 17 项相关测试最终通过：其中收藏 2 项在并行构建时超时，构建结束后独立运行收藏测试 4/4 通过，未调整超时阈值。ESLint 和生产构建通过；3000 正式预览与 3001 开发服务均已更新。微信真机未实测。

---

# 牌典第二版与完整牌义详情 — 2026-09-17

final result: passed

## Findings and comparison history
- 已修复 P2：首轮列表的标题与行间距偏大，首屏信息密度低于选中的第二版。收紧 header、sectionHeading、entryMain 与摘要行高；重新截取同一大阿卡纳状态后，390×844 首屏可见三张牌及底部导航。证据：library-first.png、comparison.png、comparison-rows.png。
- 已修复 P2：320px 下月亮装饰超出页面约 3px。窄屏将装饰右偏移与页面内边距对齐；最终浏览器检查无横向溢出。证据：library-320.png。
- 已修复字体覆盖问题：既有中文子集缺少部分牌名汉字。使用本机官方 Noto Serif SC 字体生成包含牌典真实内容的 1111 字符子集，附许可证及可复现脚本，避免标题混用回退字体。
- 最终完整对比和局部对比均已打开检查，无未解决的 P0/P1/P2。详情页延续选定方向，用户提供的旧详情截图用于确认改造范围，并非需要复刻的目标。

## Source, state and evidence
- 视觉目标：用户选择的第二版，原文件 `C:/Users/xiaox/.codex/generated_images/01a0ad8e-e3ed-78d3-82ab-ed0bb4ce9b8f/exec-a3a683c5-8fe1-4702-95d5-ec0ef9b73528.png`，证据副本 `docs/verification/library-redesign/selected-v2.png`。
- 本地生产构建： http://localhost:3000/library 。列表状态为访客、大阿卡纳选中、收藏数 0；详情状态为愚者，另检查圣杯王牌。
- 原设计图 853×1844；CSS viewport 390×844，devicePixelRatio 1；最终显式裁剪的列表与详情截图均为 390×844。目标图等比缩放到该尺寸，极小宽高比差由背景补齐，不宣称逐像素一致。其他截图有浏览器捕获舍入，不用于精确坐标差判断。
- 最终实现：`docs/verification/library-redesign/library-mobile.png`、`detail-mobile.png`。
- 全景并排：`comparison.png`，左为目标、中为最终列表、右为新详情；局部：`comparison-rows.png`，用于检查牌面、字体、摘要、书签与牌义排版。以上证据文件均在 `docs/verification/library-redesign/`（本地验证目录，按仓库规则忽略提交）。
- 其他状态：library-320.png、detail-320-bottom.png、detail-cups.png、favorites-empty.png、library-768.png、library-1024.png、library-1440.png。

## Required fidelity surfaces
- 字体：中文标题及牌名使用宋体风格，英文使用项目既有斜体，正文保留易读的系统正文字体。检查真实长牌名及关键词换行；列表摘要限制两行，详情完整显示。字号层级、金色英文与标题的关系符合第二版。
- 间距与排布：保留单列图文索引、左牌右文、独立书签、细分隔线及六分类。390 首屏密度经调整后接近目标。详情采用牌面与身份并排、正逆位上下分区，窄屏独立滚动；桌面使用居中详情面板。
- 色彩：使用项目 ink、bone、gold、celestial tokens；深蓝星空、金色正位、月蓝逆位。复用现有导航及焦点样式，没有引入新主题系统。
- 图像与图标：复用项目真实牌面、profile 月亮云朵与星空、品牌分隔图，不使用生成图中变形的牌面。图片 contain 保持比例；标准图标来自官方 Tabler。背景装饰密度与生成稿略有差异，属于与首页/轨迹/我的统一的有意取舍。
- 文案与数据：分类数量源于真实牌库；关键词、摘要、正逆位内容源于现有 cards.ts。没有采纳生成稿中的虚构牌义。保留真实收藏数、登录/错误/空态文案，页面不包含设计需求或实现说明。

## Behavior, validation and limits
- 浏览器实测：全部 78、大阿卡纳 22、四花色各 14；收藏空态、访客收藏提示、详情打开与关闭、Tab 焦点循环和 Escape 后焦点恢复。
- 320×740 圣杯详情原生滚动到 scrollTop 97（scrollHeight 776，clientHeight 679），底部内容可达；关闭按钮保持 top 8px。390 与 320 无横向溢出；768/1024/1440 桌面与平板布局已检查。
- 最终生产预览控制台 error/warn 列表为空。图片失败时保留名称及完整牌义的回归测试通过。
- 全量测试：72 文件通过、3 文件跳过；727 项通过、75 项跳过。最终相关 17 项复测通过；TypeScript、ESLint、production build、git diff --check 通过。
- 测试覆盖收藏成功/取消/失败/账号同步；没有通过浏览器向真实账号写入收藏。微信真机 WebView、真实安全区与旧系统字体栅格化尚未验证。线上未部署。

## Implementation checklist
- [x] 第二版图文索引与响应式布局。
- [x] 完整牌义详情的视觉重设计与原有行为保留。
- [x] 同尺寸全景、局部对比与可复现证据。
- [x] 单元测试、类型检查、lint、正式构建与浏览器交互检查。
- [ ] 后续发布前，在微信真机验证 WebView、安全区与真实账号收藏。

---

# Native mobile scroll allowance — journal

final result: passed

## Request and smallest change
User explicitly approves the current composition but wants to be able to scroll even when it fits the screen. This supersedes the earlier zero-scroll goal. Latest + Pro approved24px mobile-only padding on the existing outer surface before implementation, in the same review conversation: https://chatgpt.com/c/6aaa58ba-76c8-83e8-a6e3-2f889642aa29 . Applied that advice with no changes to main sizing, cards, native scrolling behavior, editor, safe-area reservation or shared navigation. No bounce simulation, scroll snapping or touch handler.

## Source and comparison
- Source of truth is the user-approved current production composition: docs/verification/profile-journal/scroll-before.png (390x762 pixels at390x762 CSS viewport). Original selected artwork/reference remains recorded in prior sections.
- New production screenshots: scroll-after.png and scroll-bottom.png,388x758 pixels for the same390x762 CSS viewport due browser capture density rounding. Combined panels normalize to390x762 with approximately1.005 scale and less than1px rounding; no pixel-identical claim.
- Opened full combined comparison: scroll-comparison.png. Opened focused last-card/footer/navigation comparison: scroll-details.png. The bottom panel includes native pointer-hover shading on a journey row, not a style change.
- Fixture state: signed in, nickname123, statistics18/7/16, credit balance300, same dark theme.

## Findings and fidelity
- P2 interaction issue: previously fitting screens had no scroll travel despite the user's preference. Mobile outer padding adds24px of actual document scroll while preserving approved content geometry.
- At390x762, before/after measured positions and dimensions for heading, avatar, balance strip, all four links and footer have maximum difference0 CSS px at scrollY0. Background composition remains visually unchanged because its sizing depends on width, not added height.
- Actual native wheel scrolling moved scrollY0 ->24; reverse wheel returned to0. At the settled bottom, the full last card and footer clear fixed navigation; footer clearance is34px vs10px at the top.
- Typography, colors, imagery, copy and layout rhythm remain unchanged in the opened comparison. No actionable P0/P1/P2 findings remain.

## Validation and limits
- Matched before/after production checks:320x600 (scroll range46->70),320x683 (0->24),390x844 (0->24),430x762 (0->24), desktop1440x900 (33 unchanged). Main/footer geometry delta0 in all five cases; no horizontal overflow. Detailed data: scroll-before.json, scroll-after.json, scroll-baseline-matrix.json, scroll-matrix.json.
- Mobile/desktop boundary: actual766.4px viewport has24px outer padding;768 has0. The browser rounds requested767 to a width above the767px CSS breakpoint; no breakpoint rule changed.
- Scrolling then editing and cancelling nickname restored the original nickname and focus correctly. Production console had no errors.
-82 focused profile UI/session/model/MobilePages regression tests passed; ESLint and final production webpack build including TypeScript passed. No implementation-mirroring unit tests added for the CSS-only change.
- Physical WeChat touch/keyboard, nonzero safe areas and old WebView runtime not independently automated. Native momentum/elasticity depends on the host; this is real document scroll, not a promise of identical bounce physics. Short screens retain their existing natural overflow plus24px. Existing focus restoration may scroll an editor into view.
- Grid and private configuration untouched; only local miniapp develop override remains uncommitted. Prior no-scroll language below describes historical iterations and is superseded.

---

# Previous revision (historical)

# Merge latest main and preserve credit purchases — journal

final result: passed

## Integration and architecture review
Merged main commit2a31ddb into codex/profile-journal for PR36. Latest + Pro reviewed the sanitized integration before code changes in the existing conversation: https://chatgpt.com/c/6aaa58ba-76c8-83e8-a6e3-2f889642aa29 . Adopted a separate compact balance/purchase strip, union of both branches' behavioral tests, measured viewport limits, and committing upstream configuration before reapplying the local development override. The upstream bigint balance is serialized as Number; missing credit rows are explicitly zero via COALESCE. This merge does not change that numeric contract or payment/backend behavior.

## Findings and resolution
- Textual conflicts in profile page and profile UI tests resolved semantically: retain journal structure and compact editor, add upstream balance plus /profile/credits link, retain zero/refresh/rename balance assertions.
- P2 found in initial combined build: the added53px strip overflowed683px by16px. Extended the existing compact rules to720px. Kept44px purchase target and existing text sizes/identity anchors.
- P2 found at740px: earlier illustration enlargement reintroduced23px overflow. Moved large-art threshold to800px. Final breakpoint checks pass.
- Four journey destinations remain separate from the purchase link. The new strip may wrap for long balances. No stats, descriptions, edit hints or footer copy removed.

## Evidence and visual verdict
- Source: C:/Users/admin/.codex/visualizations/2026/09/16/01a0a941-e49f-76b1-b90e-4c3b0b11dc44/output/imagegen/miying-private-journal-v2.png (948x1659).
- State: signed-in fixture, nickname123, stats18/7/16; merged state additionally has300 available draws. The source and baseline have no credit strip: this is an intentional functional addition from main, not an exact-match claim.
- CSS viewport390x683; before and final screenshots390x683, approximatelyDPR1. Source uniformly normalized to390x683 (rounding below1px).
- Opened full combined comparison: docs/verification/profile-journal/merge-comparison.png; focused statistics/purchase/journey comparison: merge-details.png.
- Final production screenshot: merge-production-390x683.png. Additional production evidence: merge-zero-390x762.png, merge-large-balance.png, merge-desktop.png. Local screenshots/JSON are ignored verification artifacts.
- Typography: existing serif headings and body sans unchanged, added balance uses existing numeral face. Layout: compact53px strip with readable labels and44px purchase target; avatar6px/8px gaps retained. Colors: existing night-sky/gold tokens reused. Imagery: existing assets load and remain proportionate. Content: all four titles/descriptions, three stats, identity actions, footer/nav preserved, purchase labels match main. No actionable P0/P1/P2 findings remain for the integration.

## Verification and changed height contract
- 131 tests passed in8 suites: profile UI/session/model, MobilePages, credit purchase UI, miniapp payment bridge/native route and miniapp shell. Added2 regressions proving a session balance refresh during editing survives nickname save success/failure, and PATCH sends only nickname.
- ESLint passed; final Next webpack production build and TypeScript passed.
- Internal browser checked44 combinations: widths320/375/390/430 and heights600/660/683/720/721/739/740/762/799/800/844. Renderer rounds721 to722. All40 cases at660px and above passed: no page overflow, four complete journeys and footer visible,10px footer/navigation gap.600px intentionally scrolls46px at320 width and52px atother widths; no horizontal overflow. These are measured samples, not universal continuous/device guarantees. See merge-matrix.json.
- Production rechecked390x683,390x762 and desktop1440x900; zero, positive300 and large safe-integer9007199254740991 display without horizontal overflow (large value wraps at320px). Balance bigint values beyond JavaScript's safe integer range remain an upstream limitation.
- Purchase link navigates to /profile/credits and return link restores /profile. Isolated wallet uses consistent balance, no plans, disabled payments and empty order/refund lists. Production browser console had no errors; no live charges or migrations were performed.
- Actual WeChat keyboard/safe-area and old WebView runtime were not independently revalidated. Enlarged text, error messages, long balances and very short screens may scroll naturally. Previous600px no-scroll claims below are historical and superseded for journal by this integration.
- Grid branch untouched. Upstream backend, payment UI, session, dependency and tracked miniapp config match main. Local development override remains excluded from commits.

---

# Previous revision (historical)

# Adaptive profile spacing — journal

final result: passed

## Scope and review
Latest request: give 更换头像 breathing room and distribute unused height so all four destinations fit the initial mobile screen. Consulted ChatGPT Latest + Pro before implementation, complete response received: https://chatgpt.com/c/6aaa58ba-76c8-83e8-a6e3-2f889642aa29 . Adopted page-local min-height viewport sizing, flex growth through intermediate containers, equal intrinsic-safe rows, one existing navigation/safe-area reservation, and natural overflow for exceptional content. No runtime, authentication, nickname-limit, shared navigation or private-config change.

## Source and rendered evidence
- User screenshot: C:/Users/admin/AppData/Local/Temp/codex-clipboard-75e6c060-7bf6-4777-8206-4383f939d0cd.png (482 x 1015). App-area crop (15,103)-(469,990), 454 x 887, uniformly normalized to approximately390 x 762. Native top chrome excluded; the source includes a bottom home-indicator/safe-area difference that is not recreated or used for pixel-equality claims.
- The screenshot depicts journal; grid adopts the same requested spacing behavior while preserving its selected two-column composition. Original selected references and prior comparisons are recorded below.
- Same fixture state: signed in, nickname123, stats18/7/16, dark theme. Baseline and final browser screenshots390 x 762 pixels at390 x 762 CSS viewport, approximately1x density.
- Opened combined source/baseline/production image: docs/verification/profile-journal/adaptive-comparison.png.
- Opened focused identity comparison (2x uniform enlargement): docs/verification/profile-journal/adaptive-details.png.
- Final production capture: docs/verification/profile-journal/adaptive-390x762.png; narrow capture: adaptive-320x600.png. Responsive measurements: adaptive-matrix.json. These local verification artifacts are ignored by Git.

## Findings and correction history
- P2: avatar label was2px below its frame and crowded against the statistics border. Set6px internal gap and8px separation before statistics. Final focused comparison confirms comfortable separation with the same font and clickable control.
- P2: tall screens left unused space under the footer (journal baseline about82px at762px height). Main now uses viewport min-height and the four entries share remaining space. Production footer ends10px above navigation.
- P2 found during600px-height checks: stacked footer exceeded available height; below681px its brand and tagline share a row. No copy or text size removed. Grid below340px retains its single-column fallback; measured6.6px excess was removed with2px vertical inner padding and50px minimum rows. Recapture confirms320 x 600 fits.
- Final full-view and focused comparisons show no actionable P0/P1/P2 findings for this requested refinement. Taller cards intentionally differ from the old fixed-density mock.

## Required fidelity surfaces
- Typography: existing licensed headings, nickname fallback stack and body type retained; no reduced font sizes. Text remains centered within its existing group and wrapping remains readable.
- Spacing: fixed identity anchors, explicit6px/8px avatar spacing, equal flexible rows and10px footer clearance. Mobile geometry above the nickname editor does not depend on viewport height.
- Colors: existing gold and night-sky tokens unchanged; contrast and focus cues preserved.
- Images: existing raster assets retained, loaded in production; illustrations scale within contain bounds at short/tall heights. No fabricated icon or placeholder replacement.
- Copy: all four entry titles/descriptions, edit hints, statistics, footer and six navigation items retained.

## Validation and limits
- Both variants:16 combinations of widths320/375/390/430 and heights600/683/762/844. Every case has all four links visible, no vertical or horizontal overflow, and10px footer/nav gap in default fixture state. Production rechecked320 x 600 and390 x 762. Desktop1440 x 900 retains four links without horizontal overflow.
- Both worktrees:79 regression tests passed in profile UI/session/model and MobilePages suites; ESLint passed; production webpack build including TypeScript passed.
- Journal rename save, injected failure and Escape cancellation checked in browser. Input/idle trigger both x100,y82.8,w266,h44 at390px width; height762 ->600 leaves avatar/input unchanged. Failure text remains visible and naturally adds scrolling (612px document in600px viewport). Grid production cancel restores original nickname; extreme390 x 400 naturally scrolls, with all four destinations retained.
- Production images loaded. Development HMR emitted a mini-css-extract-plugin removeChild error during a CSS refresh; no new error appeared after production navigation/checks. Fixture failure was deliberate; no real account data changed.
- Actual WeChat keyboard, safe-area inset and enlarged OS text were not independently automated. Existing safe-area token remains counted once. vh/svh/dvh declaration fallback is present; this does not certify the whole Next16 runtime on Chromium91. Exception states, very short screens and enlarged text may scroll rather than clip.

## Implementation checklist
- [x] Page-local responsive CSS only.
- [x] Source/before/after full and focused comparisons opened.
- [x] Responsive, interaction, regression and production checks complete.
- [x] Preserve private config and running miniapp dev service.

---

# Previous revision (historical; superseded where noted above)

# Identity editing refinement — journal

final result: passed

## Latest request and intentional design adjustment
The user asks for better avatar-change styling, consistent type, and a visible nickname-edit affordance. The selected source remains C:\Users\admin\.codex\visualizations\2026\09\16\01a0a941-e49f-76b1-b90e-4c3b0b11dc44\output\imagegen\miying-private-journal-v2.png; this request deliberately adjusts its identity controls. All four destinations and their prior layout/artwork remain intact.

## Evidence and comparison
- Browser: Codex internal browser; final production preview http://127.0.0.1:4112/profile.
- State: signed-in isolated fixture, nickname 123, values 18 / 7 / 16, dark theme.
- CSS viewport: 390 x 683; source 948 x 1659. Browser captures may round to 388 x 679; all comparison panels normalize to 390 x 683 at approximately DPR 1. Header crops use uniform 2x enlargement, never anisotropic stretching.
- Baseline: docs/verification/profile-journal/identity-before.png.
- Final rendered screenshot: docs/verification/profile-journal/identity-production.png.
- Opened full source/baseline/final comparison: docs/verification/profile-journal/identity-comparison.png.
- Opened focused identity comparison: docs/verification/profile-journal/identity-details.png.
- Responsive/interaction captures in the same directory: identity-430.png, identity-desktop.png, identity-landscape.png; journal identity-320-focus.png and identity-error.png; grid identity-long-320.png.

## Findings, fixes, and final visual judgement
- P2, discoverability: nickname editing lacked visible explanation while avatar editing stood alone at right. Replaced this with one left avatar target including a persistent 更换头像 label, plus 修改昵称 within the existing nickname trigger. No nested controls or duplicate editor; accessible names match visible labels.
- P2, type mismatch: compact nickname previously mixed Marcellus with system Chinese fallback. Display/input now share one regular system serif stack; action labels share body sans at 12px/16px and the existing warm-gold token. Fixed-heading licensed font remains unchanged; no extra font request.
- P2, focus polish found during small-screen inspection: the outward nickname focus outline crossed the login badge. Moved only compact-mode focus outline inward; recaptured and verified production computed offset and stable badge visibility.
- Final comparison has no actionable P0/P1/P2 issues within this identity refinement. Avatar is intentionally 56px instead of 64px, with a 74px total action. The two new edit labels intentionally differ from the original generated mock to satisfy the latest user instruction.

## Required fidelity surfaces
- Fonts/type: input and nickname both 24px regular serif with identical metrics; action labels both 12px/16px body sans. Long names ellipsize only in the name span; hint remains complete. Existing heading/body hierarchy unchanged. System fallback varies by device and cannot promise every Unicode glyph.
- Layout/rhythm: recovered the extra avatar-label height from adjacent identity gaps. Journal stats y162.8, journey heading y248.6, footer bottom y608.75/nav top y611.2; grid stats y179.4, footer bottom y598.15/nav top y611.2. No downward drift in default mobile composition, all four entries remain visible. Avatar target 64x74 and nickname trigger/input 266x44 at390px; at320px they remain at least44px and separated by10px.
- Colors: both labels use --gold-warm (#DBBF7A) over existing dark navy, maintaining readable emphasis; no decorative-border color used for text. Hover/pressed/focus cues preserve geometry.
- Images: original avatar and all existing decorative illustrations remain real assets; final production images loaded. No new raster assets or fabricated icon drawings.
- Copy/content: explicit 更换头像 and 修改昵称; nickname value retained in full, displayed visually with ellipsis only. Data derivations, four routes, login/error text, footer and six-item navigation unchanged.

## Validation
- Both worktrees: 79 tests passed in profile UI/session/model and MobilePages suites. Added behavior checks for activating the visible hint, default-editor compatibility, and compact loading state. Updated only changed accessible labels; existing IME/save/cancel/error/focus checks retained.
- ESLint passed for page/editor and affected tests. Final production build including TypeScript passed after focus fix.
- Internal browser: 320/390/430,1440x900,844x390 inspected without horizontal overflow. Forty-character CJK and unbroken Latin names (grid), forty-code-point mixed name (journal), short uncommon CJK/emoji/Latin name tested. Rename hint remained48px wide at320px. Journal save/cancel/failure/retry and avatar-page navigation worked; production grid cancel restored focus and inset outline; production images and console checked successfully.
- Journal failure input retained x100,y88.8,w266,h44, equal to idle control; errors expand downstream only. Default editor behavior remains covered by tests.
- Standalone external Playwright script was updated/linted but not executed; browser evidence comes from the internal browser. Physical WeChat keyboard/safe area and OS text enlargement were not repeated in this desktop pass.
- Previews use in-memory fixtures; live login/upload/backend persistence was not revalidated.

## Pro review and evidence-based deviation
Consulted the same ChatGPT conversation with Latest + Pro before changes: https://chatgpt.com/c/6aaa58ba-76c8-83e8-a6e3-2f889642aa29 . Adopted 56px avatar with external label, compact-only rename hint, matching display/input metrics, no new font download, fixed density, and regression checks. Kept the existing avatar button/router handler instead of changing it to an anchor: it already owns native disabled semantics for missing sessions and is covered by blur/focus/navigation tests. Preserving that established behavior keeps this visual request small; no new navigation abstraction was introduced.

## Remaining polish / limits
Not a claim of pixel-identical generated typography: nickname serif fallback depends on device; existing avatar/nav, decorative details and the prior distinct encyclopedia artwork remain accepted differences. Journal default footer still has only about2.5px clearance; content scrolls naturally for errors and smaller heights. No clipping was added.

---

# Prior fidelity correction (historical evidence)

# Corrective profile fidelity QA — journal

final result: passed

## Reference and reproducible evidence
- Source: C:/Users/admin/.codex/visualizations/2026/09/16/01a0a941-e49f-76b1-b90e-4c3b0b11dc44/output/imagegen/miying-private-journal-v2.png, 948 x 1659.
- Runtime: http://127.0.0.1:4112/profile, final production build.
- Matched viewport/state: 390 x 683 CSS px, DPR approximately 1, dark mode, fixture nickname 123 and real UI displaying fixture values 18 / 7 / 16.
- Comparison: docs/verification/profile-journal/revision-comparison.png.
- Actual-size overlay: docs/verification/profile-journal/revision-overlay.png.
- Focused illustration/text/layout comparison: docs/verification/profile-journal/revision-details.png.
- Final production screenshot: docs/verification/profile-journal/revision-production.png.
- Source downsampled to 390 x 683. Journal initial screenshot was 388 x 679 from browser capture rounding, normalized to 390 x 683; grid capture was 390 x 683. Full-view and detail comparisons were opened together before passing. All screenshots remain local ignored verification files.

## Earlier incorrect acceptance and fixes
The previous QA incorrectly accepted major density drift as an intentional constraint. That acceptance is superseded.
- P1: journey started around y421 and grid tiles were 164px high; large blank editor feedback area and excess section spacing pushed entries off the first screen. Added an explicit compact editor presentation, removed redundant English caption, matched section spacing, and restored approximately 110px grid tiles / 69px journal rows.
- P2: grid titles/subtitles were packed at the top and left aligned. Centered the text group independently within its column, both horizontally and vertically.
- P2: sun/star tarot assets had nearly identical silhouettes at their rendered size. Interpretation now uses the cropped sun tarot artwork; encyclopedia uses the star/compass book from the companion selected reference. This is an intentional correction to the user's icon-distinction request, rather than a claim of literal identity to the grid mock.
- P2: background reused unrelated large constellation curves; rebuilt a clean reference-derived star/cloud background and reference-derived arrows/divider/frame.
- P2: system Chinese serif fallback varied in appearance. Added a local 41,176-byte Noto Serif CJK Light subset from the existing licensed ritual font, scoped to fixed headings; arbitrary nicknames retain the complete existing fallback stack.
- Secondary geometry check found scrollbar appearance could shrink the compact editor by about 2.4px on failure. A profile-scoped html :has(.surface) selector reserves the gutter. Browser check confirms width 188px and y105.4 before/after error; after navigating away the root gutter returns to auto.

## Quantified composition gate
Coordinates refer to the rendered content, not the comparison label strip.
| Landmark | Reference target at 390px | Final implementation |
| --- | --- | --- |
| Statistics top | about 163px | 162.8px |
| Journey heading top | about 249px | 248.6px |
| First row top | about 277px | 280.6px |
| Entry row height | about 69px | 68.8px |
| Footer bottom / navigation top | complete footer before nav | 608.7px / 611.2px |
- Grid title/subtitle center delta: 0px horizontally and effectively 0px vertically (floating-point epsilon) for all four cards.
- Journal retains the reference's left-aligned text with vertical centering; the user's centering correction concerns the double-column cards.
- Four entries and footer visible at the default reference viewport. Error states, narrow single-column layout, enlarged text and short landscape may scroll naturally.

## Required fidelity surfaces
- Typography: local Noto serif for fixed headings, original body/numeral/editor stacks retained; fixed headings have glyph coverage. Titles 16–18px, secondary copy 12px. Body/heading text remains real accessible text.
- Layout: compact identity; independent 44px avatar action at right; real 44px rename control; reference-size rows/cards. Grid preserves row-major 2x2 order, with one-column fallback below 340px.
- Color: navy, restrained antique gold and ivory; original source colors and local raster texture retained. No unrelated large orbit curves in background.
- Images: correct distinct subjects, transparent edges inspected, grid corner ornaments/arrow/footer divider extracted from source. All images loaded in production. Full-page mock is not used as a UI image.
- Copy: all four exact titles/subtitles/routes, real stat derivations, session notices, footer and six-item nav retained. Extra visible English caption removed intentionally per latest request.

## Functional / tooling validation
- Both branches: 77 tests passed across profile UI/session/model and MobilePages suites. Updated only obsolete caption expectation; IME, save/cancel, pending, errors and focus assertions retained.
- Default ProfileEditor behavior unchanged; compact mode is explicitly selected only by this page. Errors in compact mode expand below stable identity controls; downstream content may move.
- Browser: journal cancel, failed save, retry/save; grid failed save, invalid long name, cancel and input geometry; no horizontal overflow. Grid centering measured in DOM.
- Browser at 320x740, 390x683, 430x932, 844x390 and 1440x900: all four entries present, no horizontal overflow; checked screenshots.
- Navigation: revised grid link reaches /history/messages; page-scoped gutter releases after navigation. Existing destination semantics remain native links; previous full navigation verification still applies.
- ESLint passed for changed page/editor/tests; final production build and TypeScript passed on each branch.
- Final production smoke: correct assets, four entries, clear footer, no unexpected console errors in inspected tabs.
- Reference overlay/detail review repeated after fixes. No remaining actionable P0/P1/P2 issue in this corrective scope.

## Remaining precision / coverage limits
- Not a claim of 100% identical pixels: live text rasterization, existing avatar/nav drawing, a few decorative stars and the deliberate encyclopedia-book/centered-grid changes differ from the generated reference.
- The normal reference viewport now fits; no clipped fixed-height page or rasterized text was introduced.
- Older WebViews without :has or scrollbar-gutter retain natural scrolling but may exhibit the small scrollbar-induced width change; real-device WeChat keyboard/safe-area rendering remains a release check.
- Preview still uses isolated in-memory fixtures, not live WeChat/database/upload/payment validation.

## Pro review
Same Latest + Pro conversation consulted again before this revision:
https://chatgpt.com/c/6aaa58ba-76c8-83e8-a6e3-2f889642aa29
Adopted explicit compact editor API, removal of unused feedback space, stable identity anchors, precise per-reference geometry and distinct icons. Used a narrowly page-scoped root gutter selector as an evidence-based exception to avoiding root CSS, because native scrollbar appearance affected input width; verified it releases after navigation.

The maintained standalone browser test script was updated and linted; browser interaction checks in this run used the Codex internal browser instead of executing that external-browser script.

---

# Daily card solar design implementation — 2026-09-19

final result: passed

## Source, state and comparison evidence
- Approved source: `output/imagegen/daily-sunburst-20260918/daily-card-revised.png` (619 × 2182). The user selected this solar design, removed the upper-right moon decoration and required the existing vertical 今日解读 → 心之札记 → 近期轨迹 order.
- App-owned reference: `output/daily-solar-qa/reference-app-416.png` (416 × 1427). Mini-program host chrome was cropped out before comparison; it is not recreated in the webpage.
- Production preview: http://127.0.0.1:4113/daily, forwarding the production Next build on port 3000 through a disposable, memory-only API fixture. Fixture date: 2026-09-18; actual deterministic daily draw: 星币10, upright; empty note and no generated reading for the visual comparison.
- Final original viewport captures: `output/daily-solar-qa/production-416-top.png` and `production-416-lower.png`. CSS viewport 416 × 900, DPR approximately 1; browser PNG rounding produces 414 × 896 images, normalized to 416 × 900 for comparison. Content client width is 414 CSS px because of the scrollbar.
- Full-view comparison: `output/daily-solar-qa/final-comparison.png`. Implementation: `production-416-composed.png` (416 × 1472), composed from the two viewport captures at scrollY 0 and 572; persistent navigation appears once. Browser full-page capture was unreliable, so no acceptance conclusion uses that capture.
- Focused comparison: `output/daily-solar-qa/final-top-comparison.png`, covering header, corona, card, typography and reading CTA. Reference corona detail: `reference-corona-detail.png`.
- Final responsive comparison: `output/daily-solar-qa/production-responsive.png`, from 320 × 740, 390 × 844 and 430 × 932 viewports. Metrics: `production-metrics.json` and `responsive-metrics.json`. Desktop evidence: `production-desktop.png`, 1440 × 900 CSS viewport.

## Findings and correction history
- Resolved P2: initial header/card placement and caption gaps pushed reading content down. Reduced header bottom padding, caption gaps and section spacing; narrowed meaning text and adjusted title word spacing. Evidence: `compare-1-top.png`, `compare-2-top.png`, then `final-top-comparison.png`. Final reading section starts at y588.7 CSS px, close to the source's approximately y585 visual landmark.
- Resolved P2: reused background was too blue, and the clear ritual card face introduced black contain gutters. Generated a near-black starfield and restored the existing daily-card cover crop at all widths. Card interaction component and original card images remain in use.
- Resolved P2: intermediate lower-page composition retained a 144px editor and 70.8px trail rows, creating excess height. Final editor is 100px with native internal scrolling; trail rows are 63.2px at default state, with natural expansion for note markers. Section gap is 32px. Page height reduced from 1570px to 1472px. The vertical order is unchanged. Final journal heading y743.0, trail heading y912.6; the reference is approximately y730 and y883. Residual difference comes from real font metrics, readable body text and existing state/footer content.
- Resolved P2: missing fine outer solar orbit. A separately generated dotted orbit was composited into the real transparent corona image. No CSS illustration or inline SVG was introduced for the solar artwork.
- No remaining actionable P0/P1/P2 finding in this page's visual implementation scope. The final reference and production composition were opened together and inspected after these corrections.

## Required fidelity surfaces
- Typography: reused local Noto Serif Light through a page-specific font face for Chinese display text, with existing Marcellus numerals/English and body fonts. Title 28px, card name 30px, section headings 16px; form text remains readable at 16px and trail text 12–13px. Live text remains accessible and selectable. Font rasterization and some letter spacing differ slightly from the generated reference (P3).
- Layout/rhythm: one content tree; original vertical sections; centered 2:3 card; compact outlined CTA; thin journal border; four-column trail and existing six-item navigation. No page clipping or global overflow suppression. Top composition matches closely; final page is 45px taller than the normalized generated reference, with natural content flow.
- Colors/tokens: near-black violet, antique gold #dbbf7a/#c9a961, ivory display text and readable #d2ccc5 body copy. Restrained low-opacity surfaces replace heavy layering. Focus uses #e8d5a3. Selected date remains visually and semantically distinct.
- Image quality: real transparent solar disk/rays/orbit plus real starfield; reused original card JPEG, arrow and star assets. Transparency was inspected against a dark background. No upper-right decorative moon is present. Individual rays, star locations and cloud silhouette differ from the source (P3). Existing card art can itself contain a moon on applicable cards.
- Copy/content: current dates, deterministic daily cards, keyword/meaning data, notes, reading/error content and history remain dynamic. The mock's illustrative past card assignments and extra footer date are not hardcoded. Mini-program header/status chrome and original global nav artwork remain owned by their existing layers.

## Behavior and validation
- 27 tests passed across daily, dailyPage, dailyStorage and useDailyNote suites. No production state, persistence, cancellation, streaming, date-selection or storage logic changed.
- Scoped ESLint passed for `app/daily/page.tsx`. TypeScript `--noEmit` passed; final `next build --webpack` passed including TypeScript and all 29 static pages. Final whitespace/diff checks passed.
- Browser fixtures: multiline Chinese note saves; earlier date switches to its own note; back-to-today and reload restore the saved note. Injected save failure preserves the draft and exposes retry; retry saves successfully. Intentional interpretation HTTP 503 shows the existing error and retry button.
- Final compact editor: four-line Chinese note retained in full and saved at 320px; native textarea scrollHeight 139px/clientHeight 100px and scrollTop 39.2px expose the final line. With a saved-note marker, the last grid row grows naturally to 77.6px instead of clipping text.
- No horizontal overflow at 320/390/416/430/1440 widths. Final four-column tracks: 65.4/79/85.4/89px at the corresponding mobile widths. All date controls remain above the minimum 44px height. Six nav targets are approximately 67 × 71px at 416px.
- Keyboard Tab reaches the textarea with a visible gold outline. The corona is decorative, pointer-transparent and static; existing reduced-motion handling and card keyboard behavior are retained.
- Production navigation from daily to library and back works; daily-specific classes are absent on library. Final production console error/warning inspection returned no entries. Existing dev-only card-back LCP guidance was not expanded into a shared component refactor.
- Preview requests are isolated from live data and model usage. Live WeChat login, database persistence, AI service success, physical keyboard/safe-area rendering and OS font enlargement were not revalidated in this visual task.

## Pro architecture review
Before code changes, consulted ChatGPT with Latest + Pro:
https://chatgpt.com/c/6aae1328-9d14-83e8-8fde-b93280b61ff2
Adopted route-local styles/assets, reuse of existing state and handlers, a single responsive content tree, live date/card semantics, normal scrolling, host-owned chrome exclusion and isolated fixture validation. Reused the card component's existing ritual appearance to remove the faded overlay and applied only a daily-page image-fit override. No new viewport hook, API, dependency or shared component behavior was introduced. The early choice to retain the taller editor was revised after measured full-page comparison; native scrolling and input/save behavior were then verified.

## Completion checklist and remaining polish
- [x] Approved solar appearance and no upper-right decorative moon.
- [x] Existing section order, four-column history and six-item navigation.
- [x] Real assets, responsive screenshots, focused/full visual comparison.
- [x] Core interaction checks, tests, lint and final production build.
- [x] P3 limits recorded: generated texture/star/ray details, original nav icon art, font rasterization and dynamic history/footer content.
- Local preview remains running; no deployment was requested or performed. Generated asset provenance is in `public/brand/daily-theme/README.md`.

---

# Daily shared animated background correction — 2026-09-19

final result: passed

- User explicitly requested aligning the daily background with the other pages' motion. This supersedes the earlier static starfield choice; the solar corona and approved layout remain the visual reference.
- Consulted the same Latest + Pro conversation before editing, explicitly selected Latest and verified Pro. Adopted its one-declaration correction: replace the mobile route's opaque background shorthand with `transparent`. No new canvas, animation, stacking order, opacity, markup or event handlers. The static asset is retained as provenance.
- Production `next build --webpack` passed, including TypeScript and all static pages; `git diff --check` passed. This small CSS correction adds no tests and does not alter application logic.
- Visual evidence: `output/daily-solar-qa/motion-before.png`, `motion-after-a.png`, `motion-after-b.png`, `motion-comparison.png` and `motion-lower.png`. Compared at 416 × 900 CSS px, DPR approximately 1; native captures 414 × 896, identical scaling on both sides. Latest screenshot inspected alongside the pre-change approved implementation, including the lower sections.
- Two settled screenshots separated by four seconds, with no pointer or scroll action, show moving ambient pixels. Background-only edge region (x0–40, y450–800) changed in 10,008 of 14,000 pixels. Foreground section positions remain exactly equal: reading y588.725, journal y743.025, trail y912.625.
- Computed route background is transparent with no background image; the existing global canvas count is one, page visibility is visible, ambient pause flag is false and existing mist animation is running. No new console errors or warnings in the inspected production daily tab.
- At 390/416/430px, no horizontal overflow; four-column history preserved. Daily → library → Daily returns to the transparent background with exactly one global canvas. Final width/navigation checks used a separate temporary browser tab to avoid interrupting the user's active preview.
- Typography, geometry, foreground colors, corona/card assets, content order and functional controls are unchanged. Shared ambient background is deliberately more blue-violet and omits the previous static cloud/star texture; this is the requested cross-page consistency change. Readability was visually checked in both timed frames and the lower-page capture.
- Existing reduced-motion/hidden-page safeguards remain owned by AmbientField and global CSS and were inspected read-only; no forced-motion override was added. Physical mobile performance, WeChat keyboard and reduced-motion system-setting toggles were not re-tested in this correction.
- No remaining actionable P0/P1/P2 issue for this narrow correction. Local production preview remains running.

---

# Profile Mine subtitle — 2026-09-19

final result: passed

- User selected the exact title-case subtitle `Mine`, below 我的 and above the existing introduction, using the antique-gold serif italic treatment shown in their Tarot Library / Reading Journey screenshots. Source references: `C:/Users/admin/AppData/Local/Temp/codex-clipboard-4118780c-71a2-4215-825d-abebab5ba673.png` and `codex-clipboard-7870fbcd-c1fa-4c17-9cd5-40aabf207531.png`.
- Added one `p lang="en"` in the common ProfilePageFrame, used by both loaded and loading views. Added a dedicated subtitle class and a profile-specific alias for existing `/brand/home-italic.woff2`; no new font file or dependency. Existing uppercase JOURNEY styling is untouched.
- Production computed typography: exact text Mine, 14px/21px, italic 400, #DBBF7A, text-transform none; intended font reported loaded. It is left aligned with the Chinese title. At 390px the title remains y14, subtitle y52.8, introduction y77.8 (previously y54.8): natural 23px insertion, no negative offsets or compensating positioning.
- Evidence: `output/profile-mine-qa/before-390.png`, `after-390.png`, `comparison.png`, `mine-header.png`, `responsive.png`, and individual `after-320.png`, `after-430.png`, `after-1440.png`. Before/after captures were compared together at 390 × 844 CSS px, DPR approximately 1; browser PNG rounding is identical on both sides. Full-page composition and focused header crop inspected. Dynamic background differences between frames are expected.
- At 320 × 740, 390 × 844, 430 × 932 and 1440 × 900, exactly one Mine is present; no horizontal overflow, title/moon collision or hidden footer/nav controls. Existing flexible journey rows absorb the extra header height naturally. Typography, color and imagery match the requested sibling treatment; other page content and behavior remain unchanged.
- 83 existing tests passed across profile UI, profile session, profile model and MobilePages suites. Scoped ESLint, production `next build --webpack` (including TypeScript), and diff checks passed. No new mirror test was added for this static subtitle; rendered appearance and language/case were checked in the browser. Production tab reported no console errors/warnings.
- Latest + Pro was explicitly selected/verified and consulted before changes in the existing architecture conversation: https://chatgpt.com/c/6aae1328-9d14-83e8-8fde-b93280b61ff2 . Adopted a literal paragraph, dedicated non-uppercase class, existing local font, natural document flow and shared loading/loaded frame. No unrelated profile or shared-component redesign.
- No actionable P0/P1/P2 findings. Existing serif fallback remains available with font-display swap; blocked-font simulation and physical WeChat rendering were not repeated. Preview uses the existing synthetic local fixture, not live account data.

---

# Profile Mine alignment correction — 2026-09-19

final result: passed

- User clarified that Mine should be centered directly beneath the two characters 我的. This supersedes the prior left-aligned subtitle choice; the heading group stays left anchored.
- Consulted Latest + Pro before editing in the same architecture conversation above. Adopted an intrinsic-width wrapper around only the heading and subtitle, with text-align center on Mine. The introduction stays outside the wrapper; no fixed offsets, font changes or unrelated layout changes.
- At 390 × 844 CSS px, Mine's text-run center moved from x37.631 to x56.556; the Chinese title center is x56.563 (difference 0.006px). Heading top remains 14px, subtitle top 52.8px, introduction top 77.8px and header height 83.8px.
- At 320/430/1440px widths, text-run center differences remain below 0.01px and there is no horizontal overflow. Visually inspected the mobile and desktop screenshots, including a settled 430px recapture after resizing.
- Evidence: `output/profile-mine-qa/alignment-before.png`, `alignment-after-390.png`, `alignment-comparison.png`, `alignment-header.png`, individual `alignment-after-320.png`, `alignment-after-430.png`, `alignment-after-1440.png`, and `alignment-responsive-metrics.json`. Before/after header crops use identical native screenshot dimensions. Animated background differences are expected.
- 83 existing tests passed across profile UI, profile session, profile model and MobilePages suites. Scoped ESLint, production `next build --webpack` including TypeScript/static generation, and git diff checks passed. The production build was restarted and inspected through the synthetic local fixture.
- No remaining actionable visual issue in this alignment correction. Physical WeChat rendering and blocked-font fallback were not rechecked; existing behavior, assets and local font remain unchanged.

---

# Daily full card artwork correction — 2026-09-19

final result: passed

- User approved displaying the entire card image at its original proportions while retaining the solar decoration and vertical reading/journal/history layout. This supersedes the earlier 2:3 cover crop.
- Before editing, explicitly selected Latest and verified Pro in the internal browser; complete review: https://chatgpt.com/c/6aae47c9-f410-83ee-bf57-7e9ebc2220a2 . Adopted removal of the conflicting page-level image-fit override, a daily-only 3:5 frame matching the library, unchanged widths, natural content flow, and no new image-load state or shared-component changes.
- Removed `.card img { object-fit: cover; }`, restoring the ritual face's existing `object-contain`, and changed the daily card sizing utility from 2:3 to 3:5. The shared decorative card back retains its existing fill behavior. No image files, sources, flip/reverse/fallback logic, journal state, section order or corona styles changed.
- Asset inventory: 78 JPEG faces, all 500px wide and 839–881px high. A 3:5 contain frame displays their full source area with approximately 0.7–5.4% combined side gutters. Source image resampling is expected; no stretching or crop is required.
- Production at 390px: the sample 500×861 face now uses computed contain with an approximately 150×251px box. The complete top numeral, bottom margin and four corners are visible. Reading/journal/history headings move down by the same 25.05px to y599/753.30/922.90. The corona stays centered around the taller frame, with no horizontal overflow.
- Responsive checks: 320×640, 390×844, 430×932, 768×900 and 1440×900. Effective contain throughout; card boxes approximately 144×240, 150×251, 166×276, 320×533 and 384×640. No horizontal overflow; section order retained. No ancestor round clipping or fixed max-height constrains the face. Short screens use normal document scrolling.
- Evidence: `output/daily-solar-qa/full-card-before.png`, `full-card-after-390.png`, `full-card-comparison.png`, `full-card-detail.png`, `full-card-responsive.png`, individual responsive captures and `full-card-metrics.json`. Inspected the before/after and responsive images. Geometry alone was not used as proof of complete artwork.
- 33 existing tests passed across TarotCard, DailyPage, daily, dailyStorage and useDailyNote, including reveal/reverse accessibility and failed-image retry. Scoped ESLint, production build including TypeScript/static generation, and diff checks passed. Production browser logs contained no warnings/errors.
- No new tests were added for this narrow style correction. Browser visual checks used the synthetic upright 500×861 fixture; all 78 dimensions were audited, but each face and forced-failure/reversed browser state was not separately photographed. Physical WeChat/Safari rendering was not rechecked. No remaining actionable issue in the inspected correction scope.

---

# Celtic preview: outside numbers without leaders — 2026-09-21

final result: passed

The user accepted the current local effect on 2026-09-21, explicitly confirming the central cross with outside numbers as the version to commit. Physical WeChat verification remains pending.

- Source visual: `C:/Users/admin/.codex/generated_images/01a0c327-66de-7c41-8871-31a70110c2f6/exec-97b63e40-a8ad-47bc-b6aa-feb2af81227f.png`, plus the user's explicit corrections: remove leader lines; preserve the original card proportions and shared panel dimensions. The generated image is a layout reference, not runtime evidence.
- Implementation: `http://127.0.0.1:3002/reading?spread=celtic-cross`, then 更换牌阵. Evidence folder: `C:/Users/admin/.codex/visualizations/2026/09/21/01a0c327-66de-7c41-8871-31a70110c2f6/celtic-outside-labels/`. Main screenshot: `actual-390.png`; focused screenshot: `diagram-390.png`; additional screenshots: `actual-320.png`, `actual-375.png`, `actual-430.png`. Measurements: `geometry.json`, `spread-sizes.json`.
- Comparison: opened the generated reference, current screenshot and earlier original-layout screenshot together. Source is 853×1844 pixels; main capture is 388×840 pixels for a 390×844 CSS viewport. Compared matching selection-screen composition and relative element proportions, accounting for the roughly 2.2× source image density; no pixel-identical fidelity claim. Also inspected the focused diagram and individual responsive captures. The source's leaders and enlarged diagram details are intentionally not copied, per the user's latest instruction to remove leaders and preserve original sizing.
- Corrected earlier P1 findings: the previous parallel upright cards lost the central cross; restored coincident center coordinates and a 90-degree second card. Previous number movement still left labels on card faces; all ten now sit outside the corresponding card edges with a 4px horizontal gap. Number 1 sits at the vertical card's upper-left; number 2 at the horizontal card's right. No leader lines added.
- Fonts/typography: existing serif, 12px position numbers, bone color and text shadow retained; no font or global style changes. Layout: preview image boxes remain 22×38.5 SVG units (4:7), with second card rotated, and viewBox remains `0 -8 240 162`. Existing 128px/108px responsive diagram region preserved. All six spreads at 390px measured the same outer panel size, approximately 255.83×491.86 CSS px; panel height matches the pre-change reading.
- Colors/assets/content: existing palette, card-back.webp, arch/orbit assets and all copy preserved. No replacement illustration, stretching, new CSS, reading-position meaning/order or result-layout changes.
- At 320×640, 375×812, 390×844 and 430×932: no number-number or number-card intersections, no horizontal page overflow; the only card-card overlap is the intentional central 1/2 cross. These geometry checks supplement inspected screenshots rather than replacing visual review. No remaining actionable P0/P1/P2 finding within this change's scope.
- Interactions: cycled through all six spreads and returned to Celtic; expanded all ten position descriptions and collapsed them; confirmed return to the question screen. Browser warning/error log empty. No model request or reading generation performed.
- Validation: 43 tests across SpreadSelector, SpreadsPage and mobileNavigation passed before submission, including regression assertions for the central cross, external label anchors, original dimensions/aspect ratio, no leader elements and no unintended card overlap. Scoped ESLint, TypeScript and diff checks passed during implementation QA. Existing Mini Program configuration edits are excluded from the approved local commits. No push or deployment is included.

---

# Daily ink sun — 2026-09-21

final result: passed

This result covers local implementation QA. The user selected the third generated direction; acceptance of this rendered implementation and physical WeChat verification remain pending.

- Selected reference: `C:/Users/admin/.codex/generated_images/01a0c327-66de-7c41-8871-31a70110c2f6/exec-e2907e24-5b96-48bb-aea8-d34a4312cafd.png`. The user's priority is illustrated ink texture consistent with the tarot face. Original page reference: `C:/Users/admin/AppData/Local/Temp/codex-clipboard-af8a1da8-f6d0-41f2-9967-a16b8c471646.png`.
- Scope: new transparent `public/brand/daily-theme/solar-ink.webp` and the mobile `.solarCorona` background, opacity, size and centering in `app/daily/daily.module.css`. Existing card artwork, proportions, fonts, palette, copy, section order and application logic remain unchanged. No production dependency added.
- Actual page: `http://127.0.0.1:3002/daily`, today's King of Wands. Evidence directory: `C:/Users/admin/.codex/visualizations/2026/09/21/01a0c327-66de-7c41-8871-31a70110c2f6/daily-ink-sun/`. Files: `before-390.png`, `after-390.png`, `after-320.png`, `after-321.png`, `after-430.png`, `geometry.json`.
- Inspected the selected generated reference and the actual 321px capture together, plus the before/after and responsive screenshots. Broad curved rays and dry ink texture are retained. This is an adapted implementation, not a pixel-identical reproduction: the sun is deliberately smaller than the generated mock to preserve existing page geometry and clear nearby text.
- Initial implementation kept the old 91vw decoration size; the top ray approached the date. Corrected to 185% of card-stage width, centered at 50%, with 0.62 opacity. Final screenshots show separation from date and orientation text, visible ink rays beside the card and the existing star field through transparent regions. No solid disk or red fringe is visible.
- At 390x844, face bounds remain x118.483/y105.121/w150.695/h251.254 CSS px. Header, card name, interpretation-section bounds and document height also exactly match the before measurement. The sun box changes from 355.386px to 278.148px square. The `card: null` measurement is an unused button-ancestor lookup; face bounds provide the valid image comparison.
- At 320x640, 321px, 390x844 and 430x932, inspected screenshots have no horizontal overflow or decoration/text collision. At 1024x900, the decoration remains display:none, preserving the existing desktop behavior. Alpha inspection confirms transparent center/corner and approximately 62.58% fully transparent pixels in the asset.
- Interactions: selected 09.20, confirmed Queen of Wands, returned to 09.21 and confirmed King of Wands. Browser warning/error log empty. No AI interpretation request or journal write performed.
- Validation: 15 tests passed across `tests/DailyPage.test.tsx` and `tests/daily.test.ts`; diff checks passed. No new test added for this decorative style change. No remaining actionable finding in the inspected local scope. Existing Mini Program configuration changes are unrelated and preserved. No commit, push or deployment performed.

---

<!-- Home scene feature QA, recorded 2026-09-21; earlier entries retained from origin/main. -->

# Home scene reading — design QA

final result: passed

## Scope and visual truth

- User direction: preserve the existing Home design and reuse the existing question-first reading flow. This intentionally takes priority over a literal rebuild of the generated mockup.
- Approved reference: `D:/tarot-web/output/imagegen/home-scenes-20260921/constellation-grid-v3.png` (975 × 1614).
- Existing Home reference: `D:/tarot-web/output/imagegen/home-scenes-20260921/current-home-reference.png`.
- Implementation: `http://127.0.0.1:3034/`, branch `codex/home-scenarios`.
- Local evidence directory: `docs/verification/home-scenes/` (ignored, retained in this worktree).
- Full-view combined comparison: `comparison-home-final.png`.
- Focused scene comparison: `comparison-scenes-final.png`. Both inputs were opened together and inspected, including default titles, descriptive text, divider and the two raster illustrations.

## Viewports and capture normalization

| CSS viewport | Browser screenshot | Evidence |
| --- | --- | --- |
| 390 × 844 | 388 × 839 | `qa-home-390.png`, `qa-scenes-final.png` |
| 320 × 740 | 318 × 735 | `qa-home-320.png`, `selector-320.png` |
| 1440 × 1000 | 1438 × 999 | `qa-home-desktop.png` |

Browser DOM reported devicePixelRatio approximately 1 and visual viewport scale 1. The desktop browser capture surface trims a few pixels relative to the requested CSS viewport. Comparisons use 388 px width; the 975 px reference is scaled proportionally to 388 × 642. The focused comparison crops only the scene section, using the measured bounding rectangle in `qa-scenes-rect.json`; it does not compare device chrome. Temporary resize/full-page captures with mismatched composition were excluded from final evidence.

State: Home with no modal or active reading; focused comparison uses the default, unfocused scene links. The scene region was scrolled into view to inspect its full content. All widths had no horizontal document overflow. At 320/390 px the preserved brand hero means the scene labels require scrolling; this is an intentional consequence of retaining the existing design. Bottom navigation remains fixed, with content accessible by scrolling.

## Findings and comparison history

- Resolved P2, image background integration: the first rendered 390 px capture showed dark rectangular edges around the extracted illustrations. Low-luminance background pixels were feathered into alpha, preserving the gold hands, signpost, moon and foliage. The final focused comparison confirms both images blend into the existing background without a rectangular container.
- No remaining actionable P0/P1/P2 findings within this scope.
- Expected differences: retained existing fox animation, stacked wordmark, background, lunar divider, navigation and daily content; did not replace them with the mockup's different mascot or denser hero. Scene content is two columns with a thin divider, with no new nested panels.

## Required fidelity surfaces

- Typography: existing Home title and button fonts retained. Scene headings use the existing heading family with Chinese serif fallbacks; descriptive UI copy uses readable body type. Titles and descriptions remain complete at 320 px. No clipped buttons or form labels were observed.
- Layout rhythm: existing hero spacing retained; scene section follows the two entry buttons and precedes DailyCardPreview. Two equal columns, constrained art dimensions and a single vertical divider match the approved grouping. Desktop content follows the existing left-aligned content column.
- Colors/tokens: reused gold, pale gold and bone tokens on the existing ink background. No separate scene theme or replacement global tokens.
- Image quality: retained original product branding; two 400 × 400 WebP illustrations are extracted from the approved generated visual. Gold subjects remain legible at their mobile size. No code-drawn substitutes were introduced.
- Copy/content: both existing entrances explicitly say to write the question first. Scene titles/descriptions and five-card labels match the approved direction. The question page identifies the scene, displays its preset spread, and lets the user edit the seeded draft or explicitly change to general selection.
- Accessibility: scene links are keyboard reachable with visible focus, decorative images have empty alt text, form labeling is preserved. The four-option carousel has unique virtual-slot keys; hidden duplicates add no tab stops. Existing six-item navigation is retained.

## Interaction verification

Verified in the Codex internal browser against an isolated loopback API fixture:

1. Home system-recommendation entrance opens the existing empty question composer; no new automatic submission.
2. Home manual entrance opens an empty question first; only then opens the general spread chooser.
3. Both scenes open editable static drafts with the correct five-card spread.
4. Editing a scene question, changing to general selection, and confirming a spread returns the edited question intact. The URL becomes `/reading`.
5. Two-options scene completes question → shuffle → five-card draw → reveal → existing manual report. Report uses an explicitly labeled synthetic response.
6. New question from the report clears the old reading and restores the scene template/spread.
7. Mobile 320/390 and desktop 1440 layouts render without horizontal overflow. Checked small-screen selector and persistent navigation.
8. Initial development compilation produced a chunk timeout; reloading after compilation resolved it. A fresh independent QA tab subsequently reported no console errors. Preview and Next error logs were empty at final inspection.

## Technical validation and architecture review

- ChatGPT Latest + Pro consulted before implementation: `https://chatgpt.com/c/6ab0ecaa-3eb0-83e9-a010-8993882d3a16`.
- Adopted: static scene configuration, strict URL resolution, one-time draft initialization, explicit in-flow URL adoption without remounting, preserved six-spread domain/legacy links, four-choice carousel slot keys, existing manual reset/cancellation semantics.
- Omitted the optional report-to-Conversation shortcut because destination restoration could overwrite an existing automatic conversation. Session/provider changes are outside this iteration.
- 89 tests passed across HomePage, ReadingPage, SpreadSelector, SpreadsPage, readingEntry and readingControls. Coverage includes malformed/duplicate/ambiguous entries, legacy six-spread links, draft preservation, four-option wraparound, and scene reset from report state.
- TypeScript noEmit, scoped ESLint, webpack production build and git diff whitespace checks passed.

## Remaining limitations / follow-up polish

- Live WeChat and real model/backend behavior were not exercised; preview API traffic is synthetic and fail-closed, with in-memory records only.
- This change does not add a unified Conversation session list or persistence for an unfinished manual reading. Existing saved readings can still be continued from History. Manual unmount/cancellation behavior is unchanged.
- P3: evaluate scene discovery placement after product feedback; bringing the entire scene section above the fold would require reducing the existing hero, which was deliberately not done.

## Implementation checklist

- [x] Preserve Home and existing question-first paths.
- [x] Separate four general choices from two scene entrances without changing the domain catalog.
- [x] Keep scene drafts editable and preserve them on explicit general switching.
- [x] Run behavioral checks and inspect mobile/desktop rendering.
- [x] Fix illustration edges and compare the updated screenshots.
- [x] Keep the local isolated preview running for review.

## Integration verification — 2026-09-22

- Merged `origin/main` at `366cd8d9d5638aefa4a7299a059961174e02a5a8` into feature HEAD `eeea6ff6aa3aa57c73f43f778a26707e2eafbb40` using a normal merge. The only textual conflict was this document: retained the entire upstream log and appended the Home scene report exactly once.
- ChatGPT Latest + Pro reviewed the sanitized merge brief in the conversation linked above. Adopted the recommendation to preserve both parents, make no manual production-source changes, and validate the four-choice carousel with upstream Celtic anchors plus scene readings with upstream reveal/report behavior. No design or persistence expansion was needed.
- The resolved source matches Git's predicted automatic merge. Both-parent inspection confirms the optional four-choice list, full-catalog selector default, stable slot keys and external Celtic number anchors coexist. Reveal/report, dependencies, payment, server and model changes from upstream are retained unchanged.
- 143 tests passed across 13 suites: HomePage, ReadingPage, SpreadSelector, SpreadsPage, readingEntry, readingControls, RevealStage, manualFollowUp, readingResume, mobileNavigation, ReadingReport, HistoryReadingReport and manualDrawNavigation. Two ReadingPage cases emitted non-failing React act warnings; no assertions failed.
- Webpack production build, TypeScript noEmit, scoped ESLint and staged whitespace checks passed. The first typecheck encountered stale generated types for an upstream-deleted payment route; regenerating build output resolved this without a source or configuration change.
- Browser smoke against the existing isolated loopback fixture completed both five-card scene readings and a ten-card general Celtic reading. Every card advanced by exactly one single click, reports defaulted open, and each reading accepted one synthetic follow-up. History showed one record per completed reading with one follow-up each; its existing Continue link restored the two-options reading and follow-up in Conversation.
- Verified both editable scene drafts, scene reset, edited-question preservation when switching to general selection, four-choice wraparound in both directions, Celtic preview numbering, and the original empty system-recommendation entrance.
- Checked 320/390 px reading surfaces and 1440 px Home; no horizontal overflow or new browser warning/error logs were observed. Scope uses the earlier detailed visual QA rather than repeating image fidelity comparisons for this merge.
- Fixture limitations remain explicit: synthetic abbreviated text triggers incomplete-section notices and an unconfirmed-save notice on manual follow-ups. In-memory history recovery was verified, but this does not establish live backend/model or WeChat behavior. No live services, deployment, provider changes, new session list or unfinished-reading persistence were added.

## 四场景与专属提问引导验收 — 2026-09-22

- 本次基于 `985c561` 的最新输入框实现，保留首页两个主按钮、既有牌阵和页面结构。新增「事情进展 / 三张牌阵 / 3 张」「临场准备 / 单张牌 / 1 张」；原有两个场景继续使用各自五张牌阵。
- 四个场景均使用空白初始输入框、场景专属 placeholder 和三个独立开头。填入操作保留已有草稿，不自动提交，不重复追加相同开头；通用入口继续使用原通用引导。沿用输入框自适应高度和 500 字限制；新问题保留场景、清空草稿，改为自选牌阵保留草稿。

### 视觉依据与截图

- 截图目录：`C:/Users/admin/.codex/visualizations/2026/09/22/01a0c7f9-cc47-7681-98c5-6cb4dedbbcda/`。
- 已选效果图：`01-home-scenes.png`（724×2172）、`02-relationship.png`（1566×1004）、`03-two-options.png`、`04-progress.png`、`05-preparation.png`（后三张均 1586×992）。生成图用于确认内容和风格，具体组件比例以最新代码为准，不宣称逐像素还原生成图。
- 实际页面：`verified-home-scenes.png`；四个场景分别为 `verified-{relationship,two-options,progress,preparation}-question.png` 和对应 `-opening.png`。移动视口 390×844，实际截图约 388×840；分别覆盖空输入框和展开引导弹窗。另有 `live-preparation-opening-320.png`（320×740 窄屏）及 `verified-home-desktop.png`（1440×1024 桌面视口）。
- 已将来源和实现放在同一图中检查：`compare-home-scenes.png` 及四张 `compare-final-{relationship,two-options,progress,preparation}.png`。比较采用裁切和等比缩放，未拉伸。首页最终对齐修正后再次保存并检查 `verified-home-scenes.png` 和 `verified-home-desktop.png`。

### 五项视觉检查与修正

- 字体：沿用现有标题、正文和牌数标签字体、字号及颜色层级。
- 间距：沿用现有页面布局，场景新增第二行，行间距 24px；保持两列及每行中间分隔线。
- 颜色与状态：使用原有金色、暗色背景和禁用样式；空白或超长问题不能进入抽牌。
- 图片：新增两张 400×400 透明 WebP，分别为星光小径和灯笼石阶，检查了边缘透明度及实际暗色背景上的融合；原有两张插画保留。
- 文案：四场景标题、描述、专属输入提示和各三个开头均检查；首页和牌阵页显示真实牌数 5 / 5 / 3 / 1。
- 修正 P2：桌面新场景说明行数不同导致牌数标签错位，改为卡片内部纵向 flex 和标签自动上边距。同排标签 DOM 顶部位置一致；修正后重新检查 390px 和 1440px，无横向溢出。

### 行为与代码验证

- 六个相关测试文件共 90 项测试分批通过，覆盖四场景入口、三选一开头、追加和去重、500 字限制、通用入口回归、切换保留草稿、完整模拟抽牌解读后的场景重置。
- TypeScript noEmit、变更文件 ESLint 和 `git diff --check` 通过。
- 浏览器实际检查四场景输入提示、引导选择和填入、切换自选后草稿保留及通用引导恢复；320px 弹窗三个选项及填入按钮可见，390px 和 1440px 页面无横向溢出，控制台无新增 warning/error。
- 限制：未进行微信真机、原生软键盘或真实模型调用验证；完整解读与重置由模拟测试覆盖。短手机视口仍沿用原页面滚动到主操作的布局。
- final result: passed（本次实现范围与本地验证范围内）。验收时尚未提交，后续按用户要求拆分本地提交；未推送或部署，用户已有小程序配置改动保持原样。

---

# 今日一牌：2026-09-24 第二方案落地

final result: passed（浏览器视觉与功能检查；微信真机未验证）

- 用户确认：采用第二张 Product Design 设计图后实施。
- 参考：C:/Users/xiaox/.codex/generated_images/01a0d27b-e134-7931-b0c9-0ff1a6f53d34/exec-837ab34b-6a7b-4950-b381-adeb2e68ce4c.png（853×1844，约对应390×844手机画面）。参考图与最终390×844截图在同一次视觉检查中呈现对照。
- 当前证据：artifacts/daily-design/mobile-390.png、trail-390.png、mobile-320.png、desktop-1280.png。截图来自3001开发服务实际页面，没有替换业务数据。
- 实施：月云标题、左牌右文、整行牌义与解读按钮；开放式札记；近期记录改为带牌面缩略图的纵向列表，新日期优先。复用牌典字体、首页英文斜体、品牌插画及颜色token。
- 已修复：首轮留白过大；轨迹图片经过优化接口加载失败（与牌典一致改用直接加载）；去除不兼容旧Chromium的 :has 选择器；历史札记提示区分今天与过去日期。
- 字体与色彩：中文衬线、英文斜体、暖金与骨白层级已检查；不额外生成字体，缺字使用系统衬线回退。背景与月云保留现有品牌素材，不复刻生成图的星光像素分布。
- 间距与内容：真实牌义长于示意图，保留全部关键词与14日记录，因此首屏记录数量不同，需要向下滚动；没有用示意图的固定文案替代牌义。输入区可滚动编辑，保留保存状态与错误反馈。
- 响应式：320×844、390×844、1280×900均无横向溢出；手机首屏解读按钮和札记可见。近期轨迹缩略图正常加载，支持点击昨天和返回今日，底栏沿用共享导航。
- 验证：DailyPage、daily、dailyStorage、useDailyNote共27项测试通过；TypeScript、ESLint、Prettier、生产构建和git diff --check通过；浏览器未捕获error。札记保存与解读重试由现有mock测试验证，本轮未调用真实模型或写入真实札记。
- 限制：未进行微信开发者工具或微信真机视觉验收；浏览器结果不能替代真机验收。未部署、提交或推送。

## 2026-09-24 近期轨迹对齐修正

用户截图显示卡牌与文字块偏向行中间。本次仅在移动端日期按钮显式设置 width:100%、min-width:0、margin:0，使行宽由列表容器决定。390px视口中列表、按钮、内部行均为335px宽，左边缘均为26px；320px视口均为281px宽、左边缘18px，无横向溢出。截图：artifacts/daily-design/trail-alignment-390.png。DailyPage 4项测试、Prettier及局部diff检查通过；未在微信旧版内核直接复测，因此该环境的根因仍需以实际刷新结果确认。

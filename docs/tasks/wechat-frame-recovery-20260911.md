# 微信开发者工具渲染上下文空指针排查

用户错误：`Cannot read property '__subPageFrameEndTime__' of null`，Windows 微信开发者工具 2.01.2510290，基础库 3.17.3。堆栈包含匿名脚本 1:1742246、setInterval 和 WAServiceMainContext.js。

## 确认证据

- 从本机已安装的 3.17.3.wxvpkg 只读提取并分析 WAXRFrameRenderContextDevTools.js。该文件中读取上述字段的定时器位置与用户提供的匿名脚本偏移吻合。
- 定时器每 500ms 读取 window 上的该字段；读取前没有检查 window 是否为 null。WAServiceMainContext 的堆栈位置属于通用回调执行包装。
- 在 Node VM 中执行从本机基础库提取的这个定时器表达式：window 为对象时正常，随后将其设为 null，再调用定时器，会得到同一字段的 TypeError。这验证了库内错误条件，未复现微信宿主将 window 置空的完整过程。
- 本机缓存的 3.16.2、3.17.2 同一文件也存在相同形式的轮询，因此没有凭版本号随意降级。
- 项目源代码不读写这个基础库字段。没有修改微信安装文件、基础库包或注入全局异常过滤器。

## 项目侧已复现并修复的缺陷

原小程序页面 onUnload 只隐藏加载提示。延迟 wx.login / wx.request 回调在卸载后仍可请求接口并 setData 创建 web-view；失败回调也可能操作已销毁页面。

修复 miniprogram/pages/index/index.js：

- 标记页面卸载，阻止卸载后新登录与页面更新。
- 为每次登录保留独立尝试标识，忽略失效尝试的成功 / 失败回调。
- 保存 RequestTask，卸载时先使回调失效再 abort。
- 忽略卸载后的 web-view load / error 事件。
- 保留原有登录失败、重试、返回路径和条件 web-view 行为。

这消除了已验证的页面生命周期竞态，但不能单独证明它是微信基础库内部 window 失效的唯一触发因素。

## 验证与本地恢复

- 新增回归测试先失败：卸载后登录回调、在途请求卸载、重试后的旧回调。
- 修复后 miniapp + wechat-recovery 32 项测试通过，相关 ESLint 通过。
- 最终全量回归：45 个测试文件通过、1 个跳过；376 项通过、26 项跳过。TypeScript 检查通过。
- 通过微信官方 CLI 对 D:/Project/tarot-web 执行 compile 缓存清理、关闭项目、重新打开项目，均返回成功。没有清除 storage、auth 或 session 缓存。
- Windows 开发者工具日志未保留用户提供的该条 MiniProgramError，因此不能以日志没有匹配项作为错误已消失的证据。

## 验证边界

已询问错误是在首次打开还是保存 / 重新编译后出现，以及是否影响手机微信。当前未获得该触发信息，尚未在微信开发者工具界面或真机完成原始场景复测。项目卸载竞态已修复；原始库内异常是否完全消失需要按用户触发步骤复测。

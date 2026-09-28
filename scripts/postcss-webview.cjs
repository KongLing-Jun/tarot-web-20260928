/* eslint-disable @typescript-eslint/no-require-imports -- Next 的 PostCSS 加载器通过 require 加载此 CommonJS 插件。 */
const postcss = require('postcss');
const { transform } = require('lightningcss');

module.exports = function webViewCss({ targets }) {
  return {
    postcssPlugin: 'webview-css',
    OnceExit(root) {
      // Tailwind 仍会生成一个 properties 初始化层；只展开这一层，
      // 不以删除任意 layer 的方式悄悄改变未来业务样式的层叠顺序。
      root.walkAtRules('layer', (rule) => {
        if (rule.params === 'properties') rule.replaceWith(rule.nodes || []);
        else throw rule.error('WebView CSS 不支持 @layer，请使用普通样式规则。');
      });
      const filename = root.source?.input.file;
      const { code } = transform({
        filename,
        code: Buffer.from(root.toString()),
        targets,
        minify: false,
      });
      root.removeAll();
      root.append(postcss.parse(code.toString(), { from: filename }).nodes);
    },
  };
};
module.exports.postcss = true;

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

const shared = readFileSync('app/_styles/small-actions.css', 'utf8');
const report = readFileSync('components/reading/ReadingReport.module.css', 'utf8');
const properties = [
  'display',
  'font-size',
  'padding',
  'min-height',
  'border-radius',
  'border-image-source',
  'background-image',
  'box-shadow',
];
afterEach(() => {
  document.body.innerHTML = '';
});

describe('共享按钮样式的覆盖边界', () => {
  it('加载共享样式后，停止、标签、展开、菜单和箭头保留组件尺寸与外观', () => {
    document.body.innerHTML = `<style>${report}</style>
      <div class="inputBox"><button class="stop" data-small-action="text"><span></span>停止</button></div>
      <div class="tabs"><button role="tab" data-small-action="tab" aria-selected="true">事情怎么看</button></div>
      <button class="expand" data-small-action="text">展开本段</button>
      <div class="menu"><button data-small-action="menu"><span>＋</span>补充情况</button></div>
      <button data-small-action="icon" data-small-icon="back"><span>〈</span></button>`;
    const elements = [...document.querySelectorAll('button, button span')];
    const appearance = () =>
      elements.map((element) => {
        const style = window.getComputedStyle(element);
        return properties.map((property) => style.getPropertyValue(property));
      });
    const before = appearance();
    const style = document.createElement('style');
    style.textContent = shared;
    document.body.append(style);
    expect(appearance()).toEqual(before);
    expect(window.getComputedStyle(document.querySelector('.stop')!).padding).toBe('0px 7px');
  });

  it('只有明确指定的面板按钮获得圆角和有主次的渐变，文字链接不套框', () => {
    document.body.innerHTML = `<style>${shared}</style>
      <a data-small-action="surface" data-action-emphasis="primary">聊天记录</a>
      <button data-small-action="surface">管理</button>
      <a data-small-action="text">继续聊</a>`;
    const [primary, secondary, text] = [...document.querySelectorAll('[data-small-action]')].map(
      (element) => window.getComputedStyle(element),
    );
    expect(primary.borderRadius).toBe('0.625rem');
    expect(secondary.borderRadius).toBe(primary.borderRadius);
    expect(primary.backgroundImage).not.toBe(secondary.backgroundImage);
    expect(primary.borderImageSource).not.toContain('url(');
    expect(text.backgroundImage).toBe('none');
    expect(text.boxShadow).not.toContain('inset');
  });
});

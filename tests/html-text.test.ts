import { describe, expect, it } from 'vitest';
import { extractHtmlText, htmlToText, IMAGE_PLACEHOLDER } from '../src/main/html-text';

describe('htmlToText（扫描器）', () => {
  it('保留段落并解码实体', () => {
    expect(htmlToText('<p>第一段</p><p>第二段 &amp; 结尾</p>')).toBe('第一段\n第二段 & 结尾');
  });

  it('属性里的 > 不会截断标签', () => {
    const html = '<p>前文<img alt="a > b" src="x.jpg">后文</p>';
    // 图片会单独成段，所以「前文/后文」之间是段落边界，而不是属性残片
    expect(htmlToText(html)).toBe('前文\n后文');
  });

  it('属性里带换行也不漏内容', () => {
    const html = '<p>前文<span title="第一行\n第二行 > 结束">中间</span>后文</p>';
    expect(htmlToText(html)).toBe('前文中间后文');
  });

  it('未闭合的 style 后面的内容整段跳过', () => {
    const html = '<p>正文</p><style>.x{content:"secret"}';
    expect(htmlToText(html)).toBe('正文');
  });

  it('注释、CDATA、DOCTYPE 被跳过或保留为纯文本', () => {
    const html = '<!DOCTYPE html><!-- 注释 --><p>正文</p><![CDATA[原样保留]]>';
    expect(htmlToText(html)).toBe('正文\n原样保留');
  });

  it('base64 噪声行被丢弃', () => {
    const noise = 'Exr6287u6NNVz+GYLY+7SCGVQ1q5GpzKP8t9pj/VFi1RBuyi5+kaK+b/WyY/wYacqUOQqYMt1kKCpGDzVSpAA==';
    const html = `<p>正文</p><p>${noise}</p><p>结尾</p>`;
    expect(htmlToText(html)).toBe('正文\n结尾');
  });

  it('60–79 字的 base64 噪声行也丢弃（与旧书清理规则一致）', () => {
    const noise = 'A'.repeat(65);
    const html = `<p>正文</p><p>${noise}</p><p>结尾</p>`;
    expect(htmlToText(html)).toBe('正文\n结尾');
  });

  it('源码里的换行/缩进不会把一句话或公式拆成多段', () => {
    const html = `<p>例如，2CW51型稳压管的V
 <span class="sub">zmin</span>
 为3.0V，V
 <span class="sub">zmax</span>
 则为3.6V。</p>
 <p>需要给二极管施加一个反向的电压，例如V
 <span>in（min）</span>
 >V
 <span>z</span>
 + 3V。</p>`;
    expect(htmlToText(html)).toBe(
      '例如，2CW51型稳压管的V zmin 为3.0V，V zmax 则为3.6V。\n' +
        '需要给二极管施加一个反向的电压，例如V in（min） >V z + 3V。',
    );
  });

  it('<br> 断行', () => {
    expect(htmlToText('<p>第一行<br>第二行</p>')).toBe('第一行\n第二行');
  });
});

describe('extractHtmlText（带图片占位符）', () => {
  it('img 变成占位符并记录 src 顺序', () => {
    const html = '<p>前</p><p><img src="images/1.jpg"/></p><p>后</p><p><img src="images/2.jpg"></p>';
    const result = extractHtmlText(html, { imagePlaceholder: true });
    expect(result.imageSrcs).toEqual(['images/1.jpg', 'images/2.jpg']);
    expect(result.text.split('\n').filter((line) => line === IMAGE_PLACEHOLDER)).toHaveLength(2);
    expect(result.text).toBe(`前\n${IMAGE_PLACEHOLDER}\n后\n${IMAGE_PLACEHOLDER}`);
  });

  it('默认不插入占位符', () => {
    const result = extractHtmlText('<p>前</p><p><img src="a.jpg"/></p><p>后</p>');
    expect(result.text).toBe('前\n后');
    expect(result.imageSrcs).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { attr, decodeEntities, findAll, findFirst, parseXml, textOf, trimmedText } from '../src/core/xml';

describe('decodeEntities', () => {
  it('解码常见实体', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(
      'a & b <c> "d" \'e\'',
    );
  });

  it('解码数字实体', () => {
    expect(decodeEntities('&#20013;&#x6587;')).toBe('中文');
  });

  it('未知实体原样保留', () => {
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
  });
});

describe('parseXml', () => {
  it('解析元素、属性与文本', () => {
    const root = parseXml('<root id="1"><child name="a">你好</child></root>');
    expect(root?.local).toBe('root');
    expect(attr(root, 'id')).toBe('1');
    const child = findFirst(root, 'child');
    expect(attr(child, 'name')).toBe('a');
    expect(textOf(child)).toBe('你好');
  });

  it('处理自闭合标签', () => {
    const root = parseXml('<r><item id="x"/><item id="y"/></r>');
    expect(findAll(root, 'item').map((node) => attr(node, 'id'))).toEqual(['x', 'y']);
  });

  it('忽略注释与声明', () => {
    const root = parseXml('<?xml version="1.0"?><!-- hi --><r><a>1</a></r>');
    expect(trimmedText(findFirst(root, 'a'))).toBe('1');
  });

  it('支持 CDATA', () => {
    const root = parseXml('<r><a><![CDATA[<b>raw</b>]]></a></r>');
    expect(textOf(findFirst(root, 'a'))).toBe('<b>raw</b>');
  });

  it('命名空间前缀按局部名匹配', () => {
    const root = parseXml('<opf:package><opf:item id="c1" href="a.xhtml"/></opf:package>');
    expect(findAll(root, 'item')).toHaveLength(1);
    expect(attr(findFirst(root, 'item'), 'href')).toBe('a.xhtml');
  });

  it('嵌套文本会被拼接', () => {
    const root = parseXml('<r><p>前<span>中</span>后</p></r>');
    expect(textOf(findFirst(root, 'p'))).toBe('前中后');
  });

  it('非法输入不抛异常', () => {
    expect(() => parseXml('<r><a>未闭合')).not.toThrow();
    expect(parseXml('')).toBeNull();
  });
});

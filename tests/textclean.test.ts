import { describe, expect, it } from 'vitest';
import { cleanNoiseLines, isNoiseLine, remapOffset } from '../src/core/textclean';

const NOISE = 'EXr6287u6NNVz+GYLY+7SCGVQ1Qs5GpzKP8t9pj/VFiiRBuyi5+kak+b/wyV/yWacqUOQqYMtlkKCpGDzVSpAA==';

describe('isNoiseLine', () => {
  it('识别纯 base64 长行', () => {
    expect(isNoiseLine(NOISE)).toBe(true);
    expect(isNoiseLine(`  ${NOISE}  `)).toBe(true);
  });

  it('正常正文不算噪声', () => {
    expect(isNoiseLine('这是正文。')).toBe(false);
    expect(isNoiseLine('ISBN：9787301352571')).toBe(false);
    expect(isNoiseLine('')).toBe(false);
  });

  it('太短的 base64 片段不算', () => {
    expect(isNoiseLine('abc123==')).toBe(false);
  });
});

describe('cleanNoiseLines', () => {
  it('删掉噪声行并给出偏移映射', () => {
    const text = `第一段\n${NOISE}\n第二段`;
    const result = cleanNoiseLines(text);
    expect(result.text).toBe('第一段\n第二段');
    expect(result.removed).toBe(NOISE.length + 1);
    expect(result.ranges).toHaveLength(1);
    // 第二段原来的起点 = 第一段长度 + 1 + 噪声行 + 换行
    const oldOffset = text.indexOf('第二段');
    expect(remapOffset(oldOffset, result.ranges)).toBe(result.text.indexOf('第二段'));
  });

  it('没有噪声时原样返回', () => {
    const text = '第一段\n第二段';
    const result = cleanNoiseLines(text);
    expect(result.text).toBe(text);
    expect(result.ranges).toEqual([]);
    expect(result.removed).toBe(0);
  });

  it('多行噪声都被删除', () => {
    const text = `${NOISE}\n正文\n${NOISE}\n结尾`;
    const result = cleanNoiseLines(text);
    expect(result.text).toBe('正文\n结尾');
    expect(result.ranges).toHaveLength(2);
  });
});

describe('remapOffset', () => {
  const ranges = [
    { from: 10, to: 20 },
    { from: 40, to: 50 },
  ];

  it('区间之后的偏移减去删除量', () => {
    expect(remapOffset(30, ranges)).toBe(20);
    expect(remapOffset(60, ranges)).toBe(40);
  });

  it('区间之前的偏移不变', () => {
    expect(remapOffset(5, ranges)).toBe(5);
  });

  it('落进删除区间的偏移收到区间开头', () => {
    expect(remapOffset(15, ranges)).toBe(10);
    expect(remapOffset(45, ranges)).toBe(30);
  });

  it('没有删除时原样返回', () => {
    expect(remapOffset(123, [])).toBe(123);
  });
});

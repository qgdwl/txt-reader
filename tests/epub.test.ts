import { describe, expect, it } from 'vitest';
import { htmlToText, parseEpub, resolveHref } from '../src/main/epub';
import { makeZip } from './helpers/zip';

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opf(options: { title?: string; author?: string; spine?: string[]; extraManifest?: string; guide?: string }) {
  const spine = (options.spine ?? ['ch1', 'ch2'])
    .map((id) => `<itemref idref="${id}"/>`)
    .join('\n      ');
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${options.title ?? '测试书'}</dc:title>
    <dc:creator>${options.author ?? '测试作者'}</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    ${options.extraManifest ?? ''}
  </manifest>
  <spine>
      ${spine}
  </spine>
  ${options.guide ?? ''}
</package>`;
}

const CH1 = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>忽略</title>
<style>p{color:red}</style></head><body>
<h1>第一章 归途</h1>
<p>雨下了整夜 &amp; 没有停。</p>
<p>他把伞收起来。<br/>抬手叩了三下门环。</p>
</body></html>`;

const CH2 = `<html><body><h2>第二章 旧信</h2><p>抽屉里压着一叠信。</p></body></html>`;

function epubWithNav(): Uint8Array {
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol>
  <li><a href="text/ch1.xhtml">第一章 归途</a></li>
  <li><a href="text/ch2.xhtml">第二章 旧信</a></li>
</ol></nav></body></html>`;
  return makeZip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': opf({ extraManifest: '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' }),
    'OEBPS/nav.xhtml': nav,
    'OEBPS/text/ch1.xhtml': CH1,
    'OEBPS/text/ch2.xhtml': CH2,
  });
}

describe('htmlToText', () => {
  it('去掉标签并保留段落', () => {
    expect(htmlToText('<p>第一段</p><p>第二段</p>')).toBe('第一段\n第二段');
  });

  it('br 变行内换行', () => {
    expect(htmlToText('<p>a<br/>b</p>')).toBe('a\nb');
  });

  it('丢弃 script/style/head', () => {
    const html = '<head><title>t</title></head><style>p{}</style><script>1</script><p>正文</p>';
    expect(htmlToText(html)).toBe('正文');
  });

  it('解码实体', () => {
    expect(htmlToText('<p>a &amp; b &lt;c&gt;</p>')).toBe('a & b <c>');
  });

  it('压缩空白并丢弃空行', () => {
    expect(htmlToText('<p>  a   b  </p>\n\n<p></p><p>c</p>')).toBe('a b\nc');
  });
});

describe('resolveHref', () => {
  it('拼接目录', () => {
    expect(resolveHref('OEBPS', 'text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
  });

  it('处理 ../ 与 ./', () => {
    expect(resolveHref('OEBPS/text', '../images/a.png')).toBe('OEBPS/images/a.png');
    expect(resolveHref('OEBPS', './nav.xhtml')).toBe('OEBPS/nav.xhtml');
  });

  it('去掉锚点', () => {
    expect(resolveHref('OEBPS', 'ch1.xhtml#top')).toBe('OEBPS/ch1.xhtml');
  });

  it('空 href 返回空串', () => {
    expect(resolveHref('OEBPS', '   ')).toBe('');
  });
});

describe('parseEpub', () => {
  it('解析书名、作者与章节', () => {
    const book = parseEpub(epubWithNav());
    expect(book.title).toBe('测试书');
    expect(book.author).toBe('测试作者');
    expect(book.chapters).toHaveLength(2);
    expect(book.chapters[0].title).toBe('第一章 归途');
    expect(book.chapters[1].title).toBe('第二章 旧信');
  });

  it('正文是纯文本且按段落分行', () => {
    const book = parseEpub(epubWithNav());
    expect(book.chapters[0].text).toBe('雨下了整夜 & 没有停。\n他把伞收起来。\n抬手叩了三下门环。');
  });

  it('正文里不重复保留章节标题', () => {
    const book = parseEpub(epubWithNav());
    expect(book.chapters[0].text.startsWith('第一章 归途')).toBe(false);
    expect(book.chapters[1].text.startsWith('第二章 旧信')).toBe(false);
  });

  it('章节顺序按 spine，不按文件名', () => {
    const zip = makeZip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf({ spine: ['ch2', 'ch1'] }),
      'OEBPS/text/ch1.xhtml': CH1,
      'OEBPS/text/ch2.xhtml': CH2,
    });
    const book = parseEpub(zip);
    expect(book.chapters.map((c) => c.title)).toEqual(['第二章 旧信', '第一章 归途']);
  });

  it('没有 nav 时回退到 ncx 目录', () => {
    const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
      <navMap>
        <navPoint><navLabel><text>卷首</text></navLabel><content src="text/ch1.xhtml"/></navPoint>
        <navPoint><navLabel><text>卷二</text></navLabel><content src="text/ch2.xhtml"/></navPoint>
      </navMap></ncx>`;
    const zip = makeZip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf({
        extraManifest: '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      }),
      'OEBPS/toc.ncx': ncx,
      'OEBPS/text/ch1.xhtml': CH1,
      'OEBPS/text/ch2.xhtml': CH2,
    });
    expect(parseEpub(zip).chapters.map((c) => c.title)).toEqual(['卷首', '卷二']);
  });

  it('既无 nav 也无 ncx 时用正文里的标题', () => {
    const zip = makeZip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf({}),
      'OEBPS/text/ch1.xhtml': CH1,
      'OEBPS/text/ch2.xhtml': CH2,
    });
    expect(parseEpub(zip).chapters.map((c) => c.title)).toEqual(['第一章 归途', '第二章 旧信']);
  });

  it('标题缺失时按序号兜底', () => {
    const zip = makeZip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf({ title: '' }),
      'OEBPS/text/ch1.xhtml': '<html><body><p>只有正文</p></body></html>',
      'OEBPS/text/ch2.xhtml': CH2,
    });
    const book = parseEpub(zip);
    expect(book.title).toBe('未命名');
    expect(book.chapters[0].title).toBe('第 1 节');
  });

  it('跳过图片等非文本 spine 项', () => {
    const zip = makeZip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf({
        spine: ['ch1', 'img'],
        extraManifest: '<item id="img" href="img/cover.jpg" media-type="image/jpeg"/>',
      }),
      'OEBPS/text/ch1.xhtml': CH1,
      'OEBPS/text/ch2.xhtml': CH2,
      'OEBPS/img/cover.jpg': new Uint8Array([1, 2, 3]),
    });
    expect(parseEpub(zip).chapters).toHaveLength(1);
  });

  it('缺少 container.xml 时抛错', () => {
    const zip = makeZip({ mimetype: 'application/epub+zip' });
    expect(() => parseEpub(zip)).toThrow('container.xml');
  });

  it('没有正文时抛错', () => {
    const zip = makeZip({
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': CONTAINER,
      'OEBPS/content.opf': opf({ spine: [] }),
    });
    expect(() => parseEpub(zip)).toThrow('没有可阅读的正文');
  });
});

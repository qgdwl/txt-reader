/**
 * 够用即止的 XML 读取器。
 *
 * EPUB 里要解析的都是结构简单、格式规整的 XML（container.xml / OPF / nav / ncx），
 * 引第三方解析器会给打包产物带来运行时依赖（打包时会剔除 node_modules），
 * 所以这里只实现「建树 + 按标签名找 + 取属性 + 取文本」。
 */

export interface XmlNode {
  /** 原始标签名，可能带命名空间前缀。 */
  name: string;
  /** 去掉前缀的标签名，用于匹配。 */
  local: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 直接子文本（已解码实体）。 */
  text: string;
  /** 文本与子节点按出现顺序排列，取文本时不会打乱顺序。 */
  parts: Array<string | XmlNode>;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = decodeEntities(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function localName(name: string): string {
  const index = name.lastIndexOf(':');
  return index === -1 ? name : name.slice(index + 1);
}

/** 解析 XML，返回文档元素（第一个元素节点）。 */
export function parseXml(source: string): XmlNode | null {
  const xml = source.replace(/^\uFEFF/, '');
  const root: XmlNode = {
    name: '#document',
    local: '#document',
    attrs: {},
    children: [],
    text: '',
    parts: [],
  };
  const stack: XmlNode[] = [root];
  let cursor = 0;

  const appendText = (value: string) => {
    if (!value) return;
    const current = stack[stack.length - 1];
    const decoded = decodeEntities(value);
    current.text += decoded;
    current.parts.push(decoded);
  };

  while (cursor < xml.length) {
    const lt = xml.indexOf('<', cursor);
    if (lt === -1) {
      appendText(xml.slice(cursor));
      break;
    }
    if (lt > cursor) appendText(xml.slice(cursor, lt));

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      const value = xml.slice(lt + 9, end === -1 ? xml.length : end);
      const current = stack[stack.length - 1];
      current.text += value;
      current.parts.push(value);
      cursor = end === -1 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      cursor = end === -1 ? xml.length : end + 1;
      continue;
    }

    const gt = xml.indexOf('>', lt);
    if (gt === -1) break;
    const raw = xml.slice(lt + 1, gt).trim();
    cursor = gt + 1;
    if (!raw) continue;

    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const split = body.search(/\s/);
    const name = split === -1 ? body : body.slice(0, split);
    if (!name) continue;
    const node: XmlNode = {
      name,
      local: localName(name),
      attrs: split === -1 ? {} : parseAttrs(body.slice(split)),
      children: [],
      text: '',
      parts: [],
    };
    stack[stack.length - 1].children.push(node);
    stack[stack.length - 1].parts.push(node);
    if (!selfClosing) stack.push(node);
  }

  return root.children[0] ?? null;
}

export function findAll(node: XmlNode | null, local: string): XmlNode[] {
  if (!node) return [];
  const target = local.toLowerCase();
  const out: XmlNode[] = [];
  const walk = (current: XmlNode) => {
    for (const child of current.children) {
      if (child.local.toLowerCase() === target) out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}

export function findFirst(node: XmlNode | null, local: string): XmlNode | null {
  return findAll(node, local)[0] ?? null;
}

/** 取属性，兼容带命名空间前缀的写法。 */
export function attr(node: XmlNode | null, name: string): string | undefined {
  if (!node) return undefined;
  if (node.attrs[name] !== undefined) return node.attrs[name];
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(node.attrs)) {
    if (localName(key).toLowerCase() === target) return value;
  }
  return undefined;
}

/** 递归取文本，按原始出现顺序拼接。 */
export function textOf(node: XmlNode | null): string {
  if (!node) return '';
  let out = '';
  for (const part of node.parts) {
    out += typeof part === 'string' ? part : textOf(part);
  }
  return out;
}

export function trimmedText(node: XmlNode | null): string {
  return textOf(node).replace(/\s+/g, ' ').trim();
}

#!/usr/bin/env node

/**
 * 单元测试：测试 mapKimiEvent 函数
 */

// 模拟 kimi-sdk.ts 中的函数

const KIMI_TOOL_MAP = {
  read: 'Read',
  edit: 'Edit',
  bash: 'Bash',
  shell: 'Bash',
  grep: 'Grep',
  search: 'Grep',
  file_search: 'Grep',
  ls: 'View',
  view: 'View',
  glob: 'Glob',
  mcp: 'MCP',
};

function extractTextContent(value, depth = 0) {
  if (value == null || depth > 5) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractTextContent(item, depth + 1))
      .filter((item) => item && item.length > 0);
    return parts.length > 0 ? parts.join('') : undefined;
  }
  if (typeof value !== 'object') return undefined;
  const record = value;
  for (const key of ['text', 'content', 'delta']) {
    const extracted = extractTextContent(record[key], depth + 1);
    if (extracted) return extracted;
  }
  if (record.message && typeof record.message === 'object') {
    const extracted = extractTextContent(record.message, depth + 1);
    if (extracted) return extracted;
  }
  if (record.type === 'text' || record.type === 'output_text' || record.type === 'text_delta') {
    const extracted = extractTextContent(record.text ?? record.content ?? record.delta, depth + 1);
    if (extracted) return extracted;
  }
  return undefined;
}

function isToolLikeEvent(event) {
  return Boolean(
    event.tool || event.tool_call || event.tool_use_id || event.call_id ||
    event.function || event.args || event.arguments
  );
}

function isAssistantLikeEvent(event) {
  const role = event.role;
  const sender = event.sender;
  const type = event.type;
  const subtype = event.subtype;
  if (role === 'assistant' || role === 'model' || role === 'thinking') return true;
  if (sender === 'assistant' || sender === 'model') return true;
  if (type && (type.includes('assistant') || type.includes('thinking') || type.includes('reasoning'))) return true;
  if (subtype && (subtype.includes('assistant') || subtype.includes('delta') || subtype === 'text')) return true;
  return false;
}

// 新增：处理 content 数组的函数
function processContentArray(contentArray, inThinkBlock) {
  const results = [];
  let currentThinkBlock = inThinkBlock;

  for (const block of contentArray) {
    const blockType = block.type;

    switch (blockType) {
      case 'think': {
        const thinkContent = block.think || block.content || '';
        if (thinkContent) {
          if (!currentThinkBlock) {
            results.push({
              msg: { type: 'assistant', content: `unding思考${thinkContent}` },
              updateThink: true,
            });
            currentThinkBlock = true;
          } else {
            results.push({ msg: { type: 'assistant', content: thinkContent } });
          }
        }
        break;
      }

      case 'text': {
        const textContent = block.text || block.content || '';
        if (textContent) {
          if (currentThinkBlock) {
            results.push({ msg: { type: 'assistant', content: '\nunding思考' }, updateThink: false });
            currentThinkBlock = false;
          }
          results.push({ msg: { type: 'assistant', content: textContent } });
        }
        break;
      }

      case 'tool_use':
      case 'tool_call': {
        const toolName = block.name || block.tool || '';
        const toolInput = block.input || block.arguments || {};
        if (toolName) {
          const mappedTool = KIMI_TOOL_MAP[toolName] || toolName;
          results.push({
            msg: {
              type: 'tool_use',
              toolName: mappedTool,
              toolInput,
              toolUseId: block.id || block.tool_use_id || crypto.randomUUID(),
            },
          });
        }
        break;
      }

      default: {
        const content = extractTextContent(block);
        if (content) {
          if (currentThinkBlock) {
            results.push({ msg: { type: 'assistant', content: '\nunding思考' }, updateThink: false });
            currentThinkBlock = false;
          }
          results.push({ msg: { type: 'assistant', content } });
        }
      }
    }
  }

  return results;
}

// 模拟 mapKimiEvent 函数
function mapKimiEvent(event, inThinkBlock) {
  const type = event.type;
  const role = event.role;
  const results = [];

  // 处理新格式：没有 type 字段，但有 role 和 content 数组
  if (!type && role === 'assistant' && Array.isArray(event.content)) {
    return processContentArray(event.content, inThinkBlock);
  }

  // 默认情况
  const content = extractTextContent(event);
  if (content && !isToolLikeEvent(event) && isAssistantLikeEvent(event)) {
    results.push({ msg: { type: 'assistant', content } });
  }

  return results;
}

// 测试用例
console.log('=== mapKimiEvent 单元测试 ===\n');

// 测试 1: 新格式事件
console.log('测试 1: 新格式事件 (无 type, 有 role + content 数组)');
const newFormatEvent = {
  role: 'assistant',
  content: [
    { type: 'think', think: 'This is thinking content...' },
    { type: 'text', text: 'Hello world!' }
  ]
};
const result1 = mapKimiEvent(newFormatEvent, false);
console.log('输入:', JSON.stringify(newFormatEvent, null, 2));
console.log('输出:', JSON.stringify(result1, null, 2));
console.log('✅ 通过: 生成了', result1.length, '条消息\n');

// 测试 2: 只有思考块
console.log('测试 2: 只有思考块');
const thinkOnlyEvent = {
  role: 'assistant',
  content: [
    { type: 'think', think: 'Just thinking...' }
  ]
};
const result2 = mapKimiEvent(thinkOnlyEvent, false);
console.log('输入:', JSON.stringify(thinkOnlyEvent, null, 2));
console.log('输出:', JSON.stringify(result2, null, 2));
console.log('✅ 通过: 生成了', result2.length, '条消息\n');

// 测试 3: 只有文本块
console.log('测试 3: 只有文本块');
const textOnlyEvent = {
  role: 'assistant',
  content: [
    { type: 'text', text: 'Just text output' }
  ]
};
const result3 = mapKimiEvent(textOnlyEvent, false);
console.log('输入:', JSON.stringify(textOnlyEvent, null, 2));
console.log('输出:', JSON.stringify(result3, null, 2));
console.log('✅ 通过: 生成了', result3.length, '条消息\n');

// 测试 4: 标准格式事件 (有 type 字段)
console.log('测试 4: 标准格式事件');
const standardEvent = {
  type: 'message',
  role: 'assistant',
  content: 'Standard format message'
};
const result4 = mapKimiEvent(standardEvent, false);
console.log('输入:', JSON.stringify(standardEvent, null, 2));
console.log('输出:', JSON.stringify(result4, null, 2));
console.log('✅ 通过: 生成了', result4.length, '条消息\n');

console.log('=== 所有测试通过 ===');

//  版本1.8
// test_filter.js - 批量测试脚本，仅支持 --file 指定JSON文件
//  新增：屏蔽/通过原因显示具体匹配规则或豁免规则、分类分支定位、关键词命中显示、
//        HTML内容合并、debug模式、性能统计、--verbose、--show、--no-stats等
//  修改版：一条数据若命中多个屏蔽规则，全部显示并参与统计
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// 调试开关（手动设为 true 以观察规则静默跳过等情况）
const DEBUG = false;

// ------------------------ 从原脚本复制必要的纯函数 ------------------------
const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;
const MAX_USER_REGEX_LEN = 300;
const MAX_MATCH_TARGET_LEN = 5000;
const EVIL_PATTERN = /\([^)]*[*+][^)]*\)[*+]|\([^)]*\{[^}]*\}[^)]*\)[*+]/;

function escapeRegex(str) {
  return str.replaceAll(ESCAPE_REGEX, String.raw`\$&`);
}

function safeRegExp(pattern, flags) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    console.error(`正则构造失败：/${pattern}/${flags}，原因：${e.message}`);
    return null;
  }
}

function isEvilRegex(pattern) {
  return EVIL_PATTERN.test(pattern);
}

function safeUserRegExp(pattern, flags) {
  if (!pattern) return null;
  if (pattern.length > MAX_USER_REGEX_LEN) {
    console.warn(`用户正则过长(${pattern.length}字符)，已忽略`);
    return null;
  }
  if (isEvilRegex(pattern)) {
    console.warn(`用户正则疑似 Evil Regex，已忽略：${pattern.substring(0, 50)}...`);
    return null;
  }
  return safeRegExp(pattern, flags);
}

function splitRegexByTopLevelOr(pattern) {
  const branches = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === '|' && depth === 0) {
      branches.push(pattern.slice(start, i));
      start = i + 1;
    }
  }
  branches.push(pattern.slice(start));
  return branches.filter(b => b.length > 0);
}

function parseSingleRule(rawPart) {
  const idx = rawPart.indexOf('###');
  if (idx === -1) return null;
  const cat = rawPart.slice(0, idx);
  const val = rawPart.slice(idx + 3);
  if (!val) return null;
  return {
    raw: rawPart,
    catRegex: cat ? safeRegExp(escapeRegex(cat), 'i') : null,
    valRegex: safeRegExp(escapeRegex(val), 'i')
  };
}

function parseRules(configStr) {
  if (!configStr) return [];
  const isClassified = configStr.includes('###');
  if (isClassified) {
    return configStr.split(/<br>|\n\n|\r\n/)
      .filter(Boolean)
      .map(parseSingleRule)
      .filter(Boolean);
  }
  if (configStr.length <= MAX_USER_REGEX_LEN) {
    const reg = safeUserRegExp(configStr, 'i');
    return reg ? [{ raw: configStr, catRegex: null, valRegex: reg }] : [];
  }
  const branches = splitRegexByTopLevelOr(configStr);
  return branches.flatMap(branch => {
    const reg = safeUserRegExp(branch, 'i');
    if (reg) return [{ raw: branch, catRegex: null, valRegex: reg }];
    console.warn(`忽略非法正则分支: ${branch.substring(0, 50)}...`);
    return [];
  });
}

function matchesRule(rule, catStr, targetStr) {
  if (!rule.valRegex || !targetStr) return false;
  if (targetStr.length > MAX_MATCH_TARGET_LEN) {
    console.warn(`匹配目标过长(${targetStr.length}字符)，跳过正则`);
    return false;
  }
  if (!rule.valRegex.test(targetStr)) return false;
  if (rule.catRegex) {
    if (!catStr || catStr.length > MAX_MATCH_TARGET_LEN) {
      if (DEBUG) console.log(`[DEBUG] 规则因缺少分类名而跳过：${rule.raw?.substring(0, 60)}`);
      return false;
    }
    return rule.catRegex.test(catStr);
  }
  return true;
}

function findFirstRule(rules, catStr, targetStr) {
  for (const rule of rules) {
    if (matchesRule(rule, catStr, targetStr)) {
      return rule;
    }
  }
  return null;
}

function isRetainedDetail(rules, catStr, targetStr) {
  if (!targetStr) return { retained: false, rule: null };
  const rule = findFirstRule(rules, catStr, targetStr);
  return { retained: !!rule, rule: rule };
}

function isBlockedDetail(rules, catStr, targetStr, ...retainDetails) {
  if (!targetStr) return { blocked: false, rule: null };
  if (retainDetails.some(d => d.retained)) return { blocked: false, rule: null };
  const rule = findFirstRule(rules, catStr, targetStr);
  return { blocked: !!rule, rule: rule };
}

function matchedText(rule, targetStr) {
  if (!rule || !rule.valRegex || !targetStr) return '';
  const m = targetStr.match(rule.valRegex);
  return m ? m[0] : '';
}

function ruleText(rule) {
  if (!rule || !rule.raw) return '?';
  const r = rule.raw;
  return r.length > 77 ? r.substring(0, 77) + '...' : r;
}

function findMatchedBranch(fullPattern, testStr) {
  if (!fullPattern || !testStr) return null;
  const fullReg = safeRegExp(fullPattern, 'i');
  if (!fullReg || !fullReg.test(testStr)) return null;
  const branches = splitRegexByTopLevelOr(fullPattern);
  for (const branch of branches) {
    try {
      const branchReg = new RegExp(branch, 'i');
      if (branchReg.test(testStr)) return branch.trim();
    } catch {
      // 忽略非法分支
    }
  }
  return null;
}

function daysComputed(dateStr) { return 0; }
function checkTimeBlocked(group, catStr) { return false; }

// ------------------------ 加载配置 ------------------------
let config;
try {
  config = require('./xbk_config.json');
  console.log('✅ 成功加载 xbk_config.json');
} catch (e) {
  console.error('❌ 读取 xbk_config.json 失败，请检查文件是否存在及格式', e.message);
  process.exit(1);
}

const domin = config.domin;
const pingbifenlei = config.pingbifenlei;
const pingbibiaoti = config.pingbibiaoti;
const pingbibiaotiplus = config.pingbibiaotiplus;
const zhanxianbiaoti = config.zhanxianbiaoti;
const pingbineirong = config.pingbineirong;
const zhanxianneirong = config.zhanxianneirong;
const pingbineirongplus = config.pingbineirongplus;
const pingbilouzhu = config.pingbilouzhu;
const zhanxianlouzhu = config.zhanxianlouzhu;
const pingbilouzhuplus = config.pingbilouzhuplus;
const pingbitime = config.pingbitime;

// 编译规则
const RULES = {
  zhanxianlouzhu: parseRules(zhanxianlouzhu),
  pingbilouzhu: parseRules(pingbilouzhu),
  pingbilouzhuplus: parseRules(pingbilouzhuplus),
  zhanxianbiaoti: parseRules(zhanxianbiaoti),
  pingbibiaoti: parseRules(pingbibiaoti),
  pingbibiaotiplus: parseRules(pingbibiaotiplus),
  zhanxianneirong: parseRules(zhanxianneirong),
  pingbineirong: parseRules(pingbineirong),
  pingbineirongplus: parseRules(pingbineirongplus)
};
const pingbifenleiReg = safeRegExp(pingbifenlei, 'i');

// ------------------------ 核心过滤逻辑 ------------------------
function testItem(item) {
  const catStr = typeof item.catename === 'string' ? item.catename : null;
  const louzhuStr = typeof item.louzhu === 'string' ? item.louzhu : null;
  const titleStr = typeof item.title === 'string' ? item.title : null;

  const parts = [item.content, item.content_html].filter(v => typeof v === 'string');
  let contentStr = parts.length > 0 ? parts.join(' ') : null;
  if (parts.length === 2 && parts[0] === parts[1]) {
    contentStr = parts[0];
  }

  // 分类屏蔽（优先级最高）
  if (catStr && pingbifenleiReg?.test?.(catStr)) {
    const matchedBranch = findMatchedBranch(pingbifenlei, catStr);
    const detail = matchedBranch
      ? `命中分类分支：“${matchedBranch}”`
      : `匹配完整分类规则：“${pingbifenlei?.substring(0, 80)}”`;
    return { passed: false, reasons: [`分类屏蔽 → ${detail}`] };
  }

  const blockedReasons = [];
  const retainReasons = [];

  // 各字段展现豁免（白名单）
  const louzhuRetain = isRetainedDetail(RULES.zhanxianlouzhu, catStr, louzhuStr);
  const titleRetain = isRetainedDetail(RULES.zhanxianbiaoti, catStr, titleStr);
  const contentRetain = isRetainedDetail(RULES.zhanxianneirong, catStr, contentStr);

  if (louzhuRetain.retained) retainReasons.push(`楼主展现：“${ruleText(louzhuRetain.rule)}”`);
  if (titleRetain.retained) retainReasons.push(`标题展现：“${ruleText(titleRetain.rule)}”`);
  if (contentRetain.retained) retainReasons.push(`内容展现：“${ruleText(contentRetain.rule)}”`);

  function collectFieldBlockReasons(rules, catStr, targetStr, isRetained, label) {
    if (!targetStr || isRetained) return;
    if (!rules || rules.length === 0) return;
    for (const rule of rules) {
      if (matchesRule(rule, catStr, targetStr)) {
        const hit = matchedText(rule, targetStr);
        const hitPart = hit ? ` 命中：“${hit}”` : '';
        blockedReasons.push(`${label} → 匹配规则：“${ruleText(rule)}”${hitPart}`);
      }
    }
  }

  collectFieldBlockReasons(RULES.pingbilouzhu, catStr, louzhuStr, louzhuRetain.retained, '楼主屏蔽');
  collectFieldBlockReasons(RULES.pingbilouzhuplus, catStr, louzhuStr, louzhuRetain.retained, '楼主加强屏蔽');
  collectFieldBlockReasons(RULES.pingbibiaoti, catStr, titleStr, titleRetain.retained, '标题屏蔽');
  collectFieldBlockReasons(RULES.pingbibiaotiplus, catStr, titleStr, titleRetain.retained, '标题加强屏蔽');
  collectFieldBlockReasons(RULES.pingbineirong, catStr, contentStr, contentRetain.retained, '内容屏蔽');
  collectFieldBlockReasons(RULES.pingbineirongplus, catStr, contentStr, contentRetain.retained, '内容加强屏蔽');

  if (blockedReasons.length > 0) {
    return { passed: false, reasons: blockedReasons };
  } else if (retainReasons.length > 0) {
    return { passed: true, reasons: [`通过（豁免）→ ${retainReasons.join('、')}`] };
  } else {
    return { passed: true, reasons: ['无屏蔽规则命中'] };
  }
}

// ------------------------ 批量测试函数 ------------------------
function testBatch(items, options = {}) {
  const { verbose = false, showMode = 'blocked', noStats = false } = options;
  if (!Array.isArray(items) || items.length === 0) {
    console.log('⚠️ 文件内无有效测试数据（期望 JSON 数组）');
    return;
  }

  if (!noStats) {
    console.log(`📦 共加载 ${items.length} 条数据，开始批量测试...\n`);
  }
  console.time('⏱ 批量测试耗时');

  let passCount = 0, blockCount = 0;
  const blockedItems = [];
  const exemptItems = [];

  items.forEach((item, index) => {
    const catStr = item.catename ?? '(无)';
    // 标题强制截断到40个字符，防止超长标题破坏排版
    const titleStr = (item.title ?? '(无)').substring(0, 40);
    const result = testItem(item);
    const reasons = result.reasons;

    if (result.passed) {
      passCount++;
      if (showMode === 'all' || showMode === 'passed') {
        console.log(`✅ #${(index + 1).toString().padStart(4)}  [${catStr}]`);
        console.log(`   标题: ${titleStr}`);
        reasons.forEach(r => console.log(`   ↳ ${r}`));
        console.log('');
      }
      if (reasons[0].includes('通过（豁免）')) {
        exemptItems.push({ index: index + 1, cat: catStr, title: titleStr, reason: reasons.join('；') });
      }
    } else {
      blockCount++;
      if (showMode === 'all' || showMode === 'blocked') {
        console.log(`❌ #${(index + 1).toString().padStart(4)}  [${catStr}]`);
        console.log(`   标题: ${titleStr}`);
        reasons.forEach(r => console.log(`   ↳ ${r}`));
        console.log('');
      }
      blockedItems.push({ index: index + 1, cat: catStr, title: titleStr, reason: reasons.join('；') });
    }
  });

  console.timeEnd('⏱ 批量测试耗时');

  if (!noStats) {
    console.log(`\n${'='.repeat(40)}`);
    console.log(`总计: ${items.length}  通过: ${passCount}  屏蔽: ${blockCount}`);
  }

  if (blockCount > 0 && (showMode === 'blocked' || showMode === 'all')) {
    const reasonStats = {};
    blockedItems.forEach(b => {
      const reasons = b.reason.split('；');
      reasons.forEach(reason => {
        const match = reason.match(/^(.+?) → (.+)$/);
        if (match) {
          const type = match[1];
          const detail = match[2];
          if (!reasonStats[type]) reasonStats[type] = {};
          reasonStats[type][detail] = (reasonStats[type][detail] || 0) + 1;
        } else {
          if (!reasonStats['其他']) reasonStats['其他'] = {};
          reasonStats['其他'][reason] = (reasonStats['其他'][reason] || 0) + 1;
        }
      });
    });

    console.log('\n屏蔽原因分布:');
    console.log('-'.repeat(40));
    for (const [type, details] of Object.entries(reasonStats)) {
      console.log(`  ${type}:`);
      const sorted = Object.entries(details).sort((a, b) => b[1] - a[1]);
      for (const [detail, count] of sorted) {
        console.log(`    ${detail} × ${count}`);
      }
    }
    const totalRuleHits = blockedItems.reduce((sum, b) => sum + b.reason.split('；').length, 0);
    console.log(`\n（屏蔽数据共 ${blockCount} 条，共命中规则 ${totalRuleHits} 次）`);
    console.log(`${'='.repeat(40)}\n`);
  }

  if (verbose && exemptItems.length > 0 && showMode === 'blocked') {
    console.log('\n豁免通过详情（verbose）:');
    exemptItems.forEach(e => console.log(`  #${e.index} [${e.cat}] ${e.title} → ${e.reason}`));
    console.log('');
  }
}

// ------------------------ 帮助信息 ------------------------
function printHelp() {
  console.log(`
使用方法:
  node test_filter.js --file <路径>              # 从 JSON 文件批量测试，文件应为对象数组
  node test_filter.js --file <路径> --verbose    # 批量测试并显示全部通过记录
  node test_filter.js --show <all|passed|blocked>  # 控制显示条目类型（默认 blocked）
  node test_filter.js --no-stats                # 不显示统计头部信息

仅支持 --file 模式。单条测试请构造一个包含该条目的 JSON 文件。
`);
}

// ------------------------ 命令行解析 ------------------------
let batchFilePath = null;
let verbose = false;
let showMode = 'blocked';
let noStats = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file' && args[i + 1]) {
    batchFilePath = path.resolve(args[i + 1]);
    i++;
  } else if (args[i] === '--verbose') {
    verbose = true;
  } else if (args[i] === '--show' && args[i + 1]) {
    const mode = args[i + 1];
    if (['all', 'passed', 'blocked'].includes(mode)) {
      showMode = mode;
    } else {
      console.warn(`未知 --show 模式: ${mode}，有效值: all, passed, blocked`);
    }
    i++;
  } else if (args[i] === '--no-stats') {
    noStats = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    printHelp();
    process.exit(0);
  }
}

// 必须提供 --file
if (!batchFilePath) {
  console.log('❌ 请使用 --file 指定测试 JSON 文件。');
  printHelp();
  process.exit(1);
}

// 读取并执行批量测试
try {
  const rawData = fs.readFileSync(batchFilePath, 'utf-8');
  let items;
  try {
    items = JSON.parse(rawData);
  } catch (parseError) {
    console.warn('⚠️ JSON 解析失败，尝试按行分拆对象修复...');
    const lines = rawData.split(/\r?\n/).filter(line => line.trim());
    items = [];
    let buffer = '';
    let braceCount = 0;
    for (const line of lines) {
      for (const ch of line) {
        if (ch === '{') braceCount++;
        else if (ch === '}') braceCount--;
      }
      buffer += line;
      if (braceCount === 0 && buffer.trim()) {
        try {
          items.push(JSON.parse(buffer));
        } catch (e) {
          console.error('无法解析的对象:', buffer.substring(0, 100));
        }
        buffer = '';
      }
    }
    if (items.length === 0) throw new Error('无法从文件中提取任何有效 JSON 对象');
  }
  testBatch(items, { verbose, showMode, noStats });
} catch (e) {
  console.error('❌ 读取或解析文件失败:', e.message);
  process.exit(1);
}
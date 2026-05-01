//  版本1.92r （重构版：降低认知复杂度）
// test_filter.js - 批量测试脚本（重构降低圈复杂度与认知复杂度）
//  新增：屏蔽/通过原因显示具体匹配规则或豁免规则、分类分支定位、关键词命中显示、
//        HTML内容合并、debug模式、性能统计、--verbose、--show、--no-stats等
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ------------------------ 调试开关 ------------------------
const DEBUG = false;

// ------------------------ 工具函数 ------------------------
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
        if (matchesRule(rule, catStr, targetStr)) return rule;
    }
    return null;
}

function isRetainedDetail(rules, catStr, targetStr) {
    if (!targetStr) return { retained: false, rule: null };
    const rule = findFirstRule(rules, catStr, targetStr);
    return { retained: !!rule, rule };
}

// ✅ 修正点2：统一使用可选链
function matchedText(rule, targetStr) {
    if (!rule?.valRegex || !targetStr) return '';
    const m = targetStr.match(rule.valRegex);
    return m ? m[0] : '';
}

// ✅ 已使用可选链
function ruleText(rule) {
    if (!rule?.raw) return '?';
    const r = rule.raw;
    return r.length > 77 ? r.substring(0, 77) + '...' : r;
}

// ✅ 已使用可选链
function findMatchedBranch(fullPattern, testStr) {
    if (!fullPattern || !testStr) return null;
    const fullReg = safeRegExp(fullPattern, 'i');
    if (!fullReg?.test(testStr)) return null;
    const branches = splitRegexByTopLevelOr(fullPattern);
    for (const branch of branches) {
        try {
            const branchReg = new RegExp(branch, 'i');
            if (branchReg.test(testStr)) return branch.trim();
        } catch { /* 忽略非法分支 */ }
    }
    return null;
}

// 占位函数
function daysComputed(dateStr) { return 0; }
function checkTimeBlocked(group, catStr) { return false; }

// ------------------------ 配置加载 ------------------------
function loadConfig() {
    try {
        const config = require('./xbk_config.json');
        console.log('✅ 成功加载 xbk_config.json');
        return config;
    } catch (e) {
        console.error('❌ 读取 xbk_config.json 失败，请检查文件是否存在及格式', e.message);
        process.exit(1);
    }
}

const config = loadConfig();

const domin = config.domin;
const pingbifenlei = config.pingbifenlei;
const pingbifenleiReg = safeRegExp(pingbifenlei, 'i');

const RULES = {
    zhanxianlouzhu: parseRules(config.zhanxianlouzhu),
    pingbilouzhu: parseRules(config.pingbilouzhu),
    pingbilouzhuplus: parseRules(config.pingbilouzhuplus),
    zhanxianbiaoti: parseRules(config.zhanxianbiaoti),
    pingbibiaoti: parseRules(config.pingbibiaoti),
    pingbibiaotiplus: parseRules(config.pingbibiaotiplus),
    zhanxianneirong: parseRules(config.zhanxianneirong),
    pingbineirong: parseRules(config.pingbineirong),
    pingbineirongplus: parseRules(config.pingbineirongplus)
};

// ------------------------ 表驱动字段检查 ------------------------
function fieldCheckDescriptors() {
    return [
        { field: 'louzhu', rules: RULES.pingbilouzhu,      label: '楼主屏蔽' },
        { field: 'louzhu', rules: RULES.pingbilouzhuplus,  label: '楼主加强屏蔽' },
        { field: 'title',  rules: RULES.pingbibiaoti,      label: '标题屏蔽' },
        { field: 'title',  rules: RULES.pingbibiaotiplus,  label: '标题加强屏蔽' },
        { field: 'content',rules: RULES.pingbineirong,     label: '内容屏蔽' },
        { field: 'content',rules: RULES.pingbineirongplus, label: '内容加强屏蔽' }
    ];
}

function collectFieldBlockReasons(rules, catStr, targetStr, isRetained, label) {
    const reasons = [];
    if (!targetStr || isRetained || !rules || rules.length === 0) return reasons;
    for (const rule of rules) {
        if (matchesRule(rule, catStr, targetStr)) {
            const hit = matchedText(rule, targetStr);
            reasons.push({ type: label, detail: ruleText(rule), hit: hit || '' });
        }
    }
    return reasons;
}

// ------------------------ 内容合并 ------------------------
function mergeContent(item) {
    const parts = [item.content, item.content_html].filter(v => typeof v === 'string');
    if (parts.length === 0) return null;
    if (parts.length === 2 && parts[0] === parts[1]) return parts[0];
    return parts.join(' ');
}

// ✅ 修正点1：去掉多余的 ?.
function checkCategoryBlock(catStr) {
    if (!catStr || !pingbifenleiReg?.test(catStr)) return null;
    const matchedBranch = findMatchedBranch(pingbifenlei, catStr);
    const detail = matchedBranch
        ? `命中分类分支：“${matchedBranch}”`
        : `匹配完整分类规则：“${pingbifenlei?.substring(0, 80)}”`;
    return { passed: false, reasons: [{ type: '分类屏蔽', detail, hit: '' }] };
}

function buildRetainReasons(retainMap) {
    const reasons = [];
    if (retainMap.louzhu.retained) reasons.push({ type: '楼主展现', detail: ruleText(retainMap.louzhu.rule), hit: '' });
    if (retainMap.title.retained) reasons.push({ type: '标题展现', detail: ruleText(retainMap.title.rule), hit: '' });
    if (retainMap.content.retained) reasons.push({ type: '内容展现', detail: ruleText(retainMap.content.rule), hit: '' });
    return reasons;
}

function collectAllBlockReasons(catStr, louzhuStr, titleStr, contentStr, retainMap) {
    const targetMap = { louzhu: louzhuStr, title: titleStr, content: contentStr };
    const reasons = [];
    for (const check of fieldCheckDescriptors()) {
        const targetStr = targetMap[check.field];
        const isRetained = retainMap[check.field]?.retained || false;
        reasons.push(...collectFieldBlockReasons(check.rules, catStr, targetStr, isRetained, check.label));
    }
    return reasons;
}

function testItem(item) {
    const catStr = typeof item.catename === 'string' ? item.catename : null;
    const louzhuStr = typeof item.louzhu === 'string' ? item.louzhu : null;
    const titleStr = typeof item.title === 'string' ? item.title : null;
    const contentStr = mergeContent(item);

    const categoryResult = checkCategoryBlock(catStr);
    if (categoryResult) return categoryResult;

    const retainMap = {
        louzhu: isRetainedDetail(RULES.zhanxianlouzhu, catStr, louzhuStr),
        title: isRetainedDetail(RULES.zhanxianbiaoti, catStr, titleStr),
        content: isRetainedDetail(RULES.zhanxianneirong, catStr, contentStr)
    };
    const retainReasons = buildRetainReasons(retainMap);
    const blockedReasons = collectAllBlockReasons(catStr, louzhuStr, titleStr, contentStr, retainMap);

    if (blockedReasons.length > 0) return { passed: false, reasons: blockedReasons };
    if (retainReasons.length > 0) return { passed: true, reasons: retainReasons };
    return { passed: true, reasons: [{ type: '无屏蔽规则命中', detail: '', hit: '' }] };
}

function formatReasons(reasons) {
    return reasons.map(r => {
        if (r.type === '无屏蔽规则命中') return '无屏蔽规则命中';
        if (r.type === '分类屏蔽') return `分类屏蔽 → ${r.detail}`;
        if (r.type.includes('展现')) return `通过（豁免）→ ${r.type}：“${r.detail}”`;
        const hitPart = r.hit ? ` 命中：“${r.hit}”` : '';
        return `${r.type} → 匹配规则：“${r.detail}”${hitPart}`;
    });
}

function analyzeResults(items) {
    let passCount = 0, blockCount = 0;
    const blockedItems = [], exemptItems = [];

    items.forEach((item, index) => {
        const catStr = item.catename ?? '(无)';
        const titleStr = (item.title ?? '(无)').substring(0, 40);
        const result = testItem(item);

        if (result.passed) {
            passCount++;
            if (result.reasons.some(r => r.type.includes('展现'))) {
                exemptItems.push({ index: index + 1, cat: catStr, title: titleStr, reasons: result.reasons });
            }
        } else {
            blockCount++;
            blockedItems.push({ index: index + 1, cat: catStr, title: titleStr, reasons: result.reasons });
        }
    });

    return { items, passCount, blockCount, blockedItems, exemptItems };
}

function shouldShow(mode, passed) {
    if (mode === 'all') return true;
    if (mode === 'passed') return passed;
    if (mode === 'blocked') return !passed;
    return false;
}

function printItemResult(item, index, result, showMode) {
    if (!shouldShow(showMode, result.passed)) return;
    const catStr = item.catename ?? '(无)';
    const titleStr = (item.title ?? '(无)').substring(0, 40);
    const prefix = result.passed ? '✅' : '❌';
    console.log(`${prefix} #${(index + 1).toString().padStart(4)}  [${catStr}]`);
    console.log(`   标题: ${titleStr}`);
    formatReasons(result.reasons).forEach(r => console.log(`   ↳ ${r}`));
    console.log('');
}

function buildBlockStats(blockedItems) {
    const reasonStats = {};
    let totalRuleHits = 0;

    for (const b of blockedItems) {
        for (const reason of b.reasons) {
            totalRuleHits++;
            const type = reason.type;
            if (!reasonStats[type]) reasonStats[type] = {};
            const hitSuffix = reason.hit ? ` 命中：“${reason.hit}”` : '';
            const detailKey = `匹配规则：“${reason.detail}”${hitSuffix}`;
            reasonStats[type][detailKey] = (reasonStats[type][detailKey] || 0) + 1;
        }
    }
    return { reasonStats, totalRuleHits };
}

function printStats(summary, stats, showMode) {
    console.log(`\n${'='.repeat(40)}`);
    console.log(`总计: ${summary.items.length}  通过: ${summary.passCount}  屏蔽: ${summary.blockCount}`);

    if (summary.blockCount > 0 && (showMode === 'blocked' || showMode === 'all')) {
        console.log('\n屏蔽原因分布:');
        console.log('-'.repeat(40));
        const { reasonStats, totalRuleHits } = stats;
        for (const [type, details] of Object.entries(reasonStats)) {
            console.log(`  ${type}:`);
            const sorted = Object.entries(details).sort((a, b) => b[1] - a[1]);
            for (const [detail, count] of sorted) {
                console.log(`    ${detail} × ${count}`);
            }
        }
        console.log(`\n（屏蔽数据共 ${summary.blockCount} 条，共命中规则 ${totalRuleHits} 次）`);
        console.log(`${'='.repeat(40)}\n`);
    }
}

function testBatch(items, options = {}) {
    const { verbose = false, showMode = 'blocked', noStats = false } = options;
    if (!Array.isArray(items) || items.length === 0) {
        console.log('⚠️ 文件内无有效测试数据（期望 JSON 数组）');
        return;
    }

    if (!noStats) console.log(`📦 共加载 ${items.length} 条数据，开始批量测试...\n`);

    console.time('⏱ 批量测试耗时');
    const summary = analyzeResults(items);

    summary.items.forEach((item, index) => printItemResult(item, index, testItem(item), showMode));

    console.timeEnd('⏱ 批量测试耗时');

    if (!noStats) {
        const stats = buildBlockStats(summary.blockedItems);
        printStats(summary, stats, showMode);
    }

    if (verbose && summary.exemptItems.length > 0 && showMode === 'blocked') {
        console.log('\n豁免通过详情（verbose）:');
        summary.exemptItems.forEach(e => {
            const reasonStr = formatReasons(e.reasons).join('；');
            console.log(`  #${e.index} [${e.cat}] ${e.title} → ${reasonStr}`);
        });
        console.log('');
    }
}

// ------------------------ 命令行 & 主流程 ------------------------
function parseArgs(args) {
    const options = { batchFilePath: null, verbose: false, showMode: 'blocked', noStats: false };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--file' && args[i + 1]) {
            options.batchFilePath = path.resolve(args[i + 1]);
            i++;
        } else if (arg === '--verbose') {
            options.verbose = true;
        } else if (arg === '--show' && args[i + 1]) {
            const mode = args[i + 1];
            if (['all', 'passed', 'blocked'].includes(mode)) options.showMode = mode;
            else console.warn(`未知 --show 模式: ${mode}`);
            i++;
        } else if (arg === '--no-stats') {
            options.noStats = true;
        } else if (arg === '--help' || arg === '-h') {
            console.log(`
使用方法:
  node test_filter.js --file <路径>
  node test_filter.js --file <路径> --verbose
  node test_filter.js --show <all|passed|blocked>
  node test_filter.js --no-stats
`);
            process.exit(0);
        }
    }
    return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.batchFilePath) {
    console.log('❌ 请使用 --file 指定测试 JSON 文件。');
    process.exit(1);
}
try {
    const rawData = fs.readFileSync(options.batchFilePath, 'utf-8');
    let items;
    try {
        items = JSON.parse(rawData);
    } catch (parseError) {
        console.warn('⚠️ JSON 解析失败，尝试按行分拆对象修复...');
        const lines = rawData.split(/\r?\n/).filter(line => line.trim());
        items = [];
        let buffer = '';
        let braceCount = 0;
        let parseFailCount = 0;                     // 新增：失败计数器
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
                    parseFailCount++;
                    // 序号标识，方便定位
                    console.error(`[解析失败 #${parseFailCount}] 无法解析的对象:`, buffer.substring(0, 100));
                }
                buffer = '';
            }
        }
        if (items.length === 0) throw new Error('无法从文件中提取任何有效 JSON 对象');

        // 新增：统计信息与阈值检查
        if (parseFailCount > 0) {
            const totalAttempts = items.length + parseFailCount;
            console.warn(`⚠️ 行级解析完成：成功 ${items.length} 个，失败 ${parseFailCount} 个（共 ${totalAttempts} 个对象尝试）`);
            if (parseFailCount / totalAttempts > 0.5) {
                throw new Error(`解析失败比例过高 (${parseFailCount}/${totalAttempts})，终止测试`);
            }
        }
    }

    testBatch(items, {
        verbose: options.verbose,
        showMode: options.showMode,
        noStats: options.noStats
    });
} catch (e) {
    console.error('❌ 读取或解析文件失败:', e.message);
    process.exit(1);
}
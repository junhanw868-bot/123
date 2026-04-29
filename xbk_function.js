'use strict';

// ======================== 用户配置区域 ======================== //
// 版本号: v4.4

/**
 * 更新日志:
 *
 * v4.4 (2026-04-29)
 * - 移除 proper-lockfile 依赖，改为直接同步文件读写，彻底兼容青龙面板
 * - 优化 daysComputed：改为纯日期比较，完全避免时区偏移导致的临界天数误差
 * - 采用 padStart 替代手动补零
 * - 使用 flatMap 替代 map().filter(Boolean) 消除中间 null 值
 * - 使用 ??= 逻辑赋值简化默认 id 生成
 * - 统一使用可选链 (?.) 和空值合并 (??) 增强健壮性
 * - 移除无用锁文件代码，减少文件 I/O 错误风险
 *
 * v4.3 (旧版)
 * - 原始版本
 */

const notify = require('./xbk_sendNotify');
const fs = require('node:fs');
const got = require('got');
const path = require('node:path');

// ------------------------ 纯函数与常量 ---------------------------

const EMPTY_JSON_ARRAY = '[]';
const UTF8 = 'utf8';
const CACHE_DIR_NAME = 'xianbaoku_cache';
const DEFAULT_CACHE_FILENAME = 'push.json';
const MAX_CACHE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10000;
const REQUEST_RETRY_LIMIT = 2;
const MS_PER_DAY = 86400000;
const CONTENT_BR_SPACER = '<br>&nbsp;<br>&nbsp;<br>';
const ORIGINAL_LINK_HTML = (url) => `原文链接:<a href="${url}" target="_blank">${url}</a><br>&nbsp;<br>&nbsp;<br>`;

const LOG_LEVEL = Object.freeze({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 });
const CURRENT_LOG_LEVEL = LOG_LEVEL.INFO;

// ------------------------ 日志工具 ---------------------------

function selectLogFunction(level) {
    if (level >= LOG_LEVEL.ERROR) return console.error;
    if (level >= LOG_LEVEL.WARN) return console.warn;
    return console.log;
}

const logger = {
    _log(level, prefix, ...args) {
        if (level < CURRENT_LOG_LEVEL) return;
        const fn = selectLogFunction(level);
        fn(`[${prefix}]`, ...args);
    },
    debug(...args) { this._log(LOG_LEVEL.DEBUG, 'DEBUG', ...args); },
    info(...args) { this._log(LOG_LEVEL.INFO, 'INFO', ...args); },
    warn(...args) { this._log(LOG_LEVEL.WARN, 'WARN', ...args); },
    error(...args) { this._log(LOG_LEVEL.ERROR, 'ERROR', ...args); }
};

// ------------------------ 配置加载与校验 ---------------------------

let config;
try {
    config = require('./xbk_config.json');
} catch (e) {
    logger.error('读取 xbk_config.json 失败，请检查文件是否存在及格式', e.message);
    process.exit(1);
}

if (!config.domin?.startsWith('http')) {
    throw new Error('配置错误: domin 必须是合法的 HTTP URL');
}

if (
    config.pingbitime &&
    Number.isNaN(Number(config.pingbitime)) &&
    !config.pingbitime.includes('###')
) {
    throw new Error('配置错误: pingbitime 必须是数字或"分类###天数"格式');
}

// 提取配置项（不可变）
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

const fetchUrl = domin + '/plus/json/push.json';

// ------------------------ 正则安全设施 ---------------------------

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
        logger.error(`正则构造失败：/${pattern}/${flags}，原因：${e.message}`);
        return null;
    }
}

function isEvilRegex(pattern) {
    return EVIL_PATTERN.test(pattern);
}

function safeUserRegExp(pattern, flags) {
    if (!pattern) return null;
    if (pattern.length > MAX_USER_REGEX_LEN) {
        logger.warn(`用户正则过长(${pattern.length}字符)，已忽略`);
        return null;
    }
    if (isEvilRegex(pattern)) {
        logger.warn(`用户正则疑似 Evil Regex，已忽略：${pattern.substring(0, 50)}...`);
        return null;
    }
    return safeRegExp(pattern, flags);
}

// ------------------------ 时间计算（纯日期，时区安全） ---------------------------

function daysComputed(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return Infinity;
    // 提取 yyyy-MM-dd 格式的日期部分
    const match = dateStr.match(/^\d{4}-\d{2}-\d{2}/);
    if (!match) return Infinity;
    const [y, m, d] = match[0].split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);          // 本地日期
    const today = new Date();
    const todayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate()); // 本地今天 0 时
    const diff = todayDate - targetDate;
    return diff >= 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}

// ------------------------ 规则解析 ---------------------------

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
    // 原始正则模式
    if (configStr.length <= MAX_USER_REGEX_LEN) {
        const reg = safeUserRegExp(configStr, 'i');
        return reg ? [{ catRegex: null, valRegex: reg }] : [];
    }
    const branches = splitRegexByTopLevelOr(configStr);
    return branches.flatMap(branch => {
        const reg = safeUserRegExp(branch, 'i');
        if (reg) return [{ catRegex: null, valRegex: reg }];
        logger.warn(`忽略非法正则分支: ${branch.substring(0, 50)}...`);
        return [];   // flatMap 自动跳过空数组
    });
}

// ------------------------ 字段匹配引擎 ---------------------------

function matchesRule(rule, catStr, targetStr) {
    if (!rule.valRegex || !targetStr) return false;
    if (targetStr.length > MAX_MATCH_TARGET_LEN) {
        logger.warn(`匹配目标过长(${targetStr.length}字符)，跳过正则`);
        return false;
    }
    if (!rule.valRegex.test(targetStr)) return false;
    if (rule.catRegex) {
        if (!catStr || catStr.length > MAX_MATCH_TARGET_LEN) {
            logger.warn(`分类名过长(${catStr?.length}字符)，跳过正则`);
            return false;
        }
        return rule.catRegex.test(catStr);
    }
    return true;
}

function matchesAnyRule(rules, catStr, targetStr) {
    return rules.some(rule => matchesRule(rule, catStr, targetStr));
}

// ------------------------ 时间屏蔽判断 ---------------------------

function parseTimeRule(rawRule) {
    const parts = rawRule.split('###');
    if (parts.length < 2) return null;
    const catPattern = parts[0];
    const daysStr = parts[1];
    const days = Number(daysStr);
    if (!catPattern || Number.isNaN(days)) return null;
    const catRegex = safeRegExp(escapeRegex(catPattern), 'i');
    if (!catRegex) return null;
    // 返回检查函数
    return (catStr, groupDays) => catStr && catRegex.test(catStr) && days > groupDays;
}

function checkTimeBlocked(group, catStr) {
    if (!pingbitime || typeof group.louzhuregtime !== 'string') return false;
    const groupDays = daysComputed(group.louzhuregtime);
    if (pingbitime.includes('###')) {
        const checkers = pingbitime.split(/<br>|\n\n|\r\n/).flatMap(raw => {
            const c = parseTimeRule(raw);
            return c ? [c] : [];
        });
        return checkers.some(checker => checker?.(catStr, groupDays) ?? false);
    }
    const limitDays = Number(pingbitime);
    return !Number.isNaN(limitDays) && limitDays > groupDays;
}

// ------------------------ 编译所有规则（资源复用） ---------------------------

const RULES = Object.freeze({
    zhanxianlouzhu: parseRules(zhanxianlouzhu),
    pingbilouzhu: parseRules(pingbilouzhu),
    pingbilouzhuplus: parseRules(pingbilouzhuplus),
    zhanxianbiaoti: parseRules(zhanxianbiaoti),
    pingbibiaoti: parseRules(pingbibiaoti),
    pingbibiaotiplus: parseRules(pingbibiaotiplus),
    zhanxianneirong: parseRules(zhanxianneirong),
    pingbineirong: parseRules(pingbineirong),
    pingbineirongplus: parseRules(pingbineirongplus)
});

const pingbifenleiReg = safeRegExp(pingbifenlei, 'i');

// ------------------------ 单条数据过滤器 ---------------------------

function isRetained(rules, catStr, targetStr) {
    return targetStr && matchesAnyRule(rules, catStr, targetStr);
}

function isBlocked(rules, catStr, targetStr, ...retainFlags) {
    if (!targetStr) return false;
    if (retainFlags.some(Boolean)) return false;
    return matchesAnyRule(rules, catStr, targetStr);
}

function filterItem(group) {
    if (!group || typeof group !== 'object') {
        logger.warn('listfilter 接收到无效 group，已忽略');
        return false;
    }

    const catStr = typeof group.catename === 'string' ? group.catename : null;
    const louzhuStr = typeof group.louzhu === 'string' ? group.louzhu : null;
    const titleStr = typeof group.title === 'string' ? group.title : null;
    const contentStr = typeof group.content === 'string' ? group.content : null;

    if (checkTimeBlocked(group, catStr)) return false;
    if (catStr && pingbifenleiReg?.test?.(catStr)) return false;

    const louzhuRetain = isRetained(RULES.zhanxianlouzhu, catStr, louzhuStr);
    const titleRetain = isRetained(RULES.zhanxianbiaoti, catStr, titleStr);
    const contentRetain = isRetained(RULES.zhanxianneirong, catStr, contentStr);

    if (isBlocked(RULES.pingbilouzhu, catStr, louzhuStr, louzhuRetain)) return false;
    if (isBlocked(RULES.pingbilouzhuplus, catStr, louzhuStr, louzhuRetain)) return false;
    if (isBlocked(RULES.pingbibiaoti, catStr, titleStr, louzhuRetain, titleRetain)) return false;
    if (isBlocked(RULES.pingbibiaotiplus, catStr, titleStr, louzhuRetain)) return false;
    if (isBlocked(RULES.pingbineirong, catStr, contentStr, louzhuRetain, titleRetain, contentRetain)) return false;
    if (isBlocked(RULES.pingbineirongplus, catStr, contentStr, louzhuRetain, titleRetain)) return false;

    return true;
}

function safeFilterItem(item) {
    try {
        return filterItem(item);
    } catch (e) {
        logger.error(`过滤单条数据异常 (${item.id || item.title}): ${e.message}`);
        return false;
    }
}

// ------------------------ 推送内容渲染 ---------------------------

const padTwo = (num) => String(num).padStart(2, '0');

const RE_H = /<h([1-6])>(.*?)<\/h\1>/gi;
const RE_A = /<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
const RE_IMG_ALT = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi;
const RE_IMG = /<img[^>]+src="([^"]+)"[^>]*>/gi;
const RE_BR = /<br\s*\/?>/gi;
const RE_P_OPEN = /<p[^>]*>/gi;
const RE_P_CLOSE = /<\/p>/gi;
const RE_ANY_TAG = /<[^>]+>/g;
const RE_MULTI_NEWLINE = /\n{3,}/g;

function htmlToMarkdown(shuju) {
    let html = shuju.content_html || '';
    html = html.replaceAll(RE_H, (_, level, content) => '#'.repeat(Number(level)) + ' ' + content + '\n\n');
    html = html.replaceAll(RE_A, '[$2]($1)');
    html = html.replaceAll(RE_IMG_ALT, '\n\n![$2]($1)\n\n');
    html = html.replaceAll(RE_IMG, '\n\n![]($1)\n\n');
    html = html.replaceAll(RE_BR, '\n\n');
    html = html.replaceAll(RE_P_OPEN, '\n\n');
    html = html.replaceAll(RE_P_CLOSE, '\n\n');
    html = html.replaceAll(RE_ANY_TAG, '');
    html = html.replaceAll(RE_MULTI_NEWLINE, '\n\n');
    html = `${html}\n\n原文链接:[${shuju.url}](${shuju.url})\n\n\n\n`;
    return html.trim();
}

function tuisong_replace(template, shuju) {
    shuju.catename = shuju.category_name || shuju.catename;
    if (shuju.posttime) {
        const d = new Date(shuju.posttime * 1000);
        shuju.datetime = `${d.getFullYear()}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`;
        shuju.shorttime = `${padTwo(d.getHours())}:${padTwo(d.getMinutes())}`;
    }

    const contentHtml = `${shuju.content_html || ''}${CONTENT_BR_SPACER}${ORIGINAL_LINK_HTML(shuju.url)}`;

    const map = Object.entries({
        '{标题}': shuju.title,
        '{内容}': shuju.content,
        '{Html内容}': contentHtml,
        '{Markdown内容}': htmlToMarkdown(shuju),
        '{分类名}': shuju.catename,
        '{分类ID}': shuju.cateid,
        '{链接}': shuju.url,
        '{日期}': shuju.datetime,
        '{时间}': shuju.shorttime,
        '{楼主}': shuju.louzhu,
        '{类目}': shuju.category_name,
        '{价格}': shuju.price,
        '{商城}': shuju.mall_name,
        '{品牌}': shuju.brand,
        '{图片}': shuju.pic
    });

    let result = template;
    for (const [key, value] of map) {
        result = result.replaceAll(key, value ?? '');
    }
    return result;
}

// ------------------------ 运行时状态 ---------------------------

const isDryRun = process.argv.includes('--dry-run');
if (isDryRun) {
    logger.info('[DRY-RUN] 仅验证过滤结果，不推送、不写入缓存');
}

// ------------------------ 推送接口封装（使用 sendNotify 多通道） ---------------------------

class Notifier {
    async send(title, content) {
        if (isDryRun) {
            logger.info(`[DRY-RUN] 跳过推送: ${title}`);
            return;
        }
        try {
            await notify.sendNotify(title, content);
            logger.info(`[PUSH] 成功: ${title}`);
        } catch (err) {
            logger.error(`[PUSH] 失败: ${title}`, err.message);
        }
    }
}

// ------------------------ 缓存服务（无锁，同步读写，青龙安全） ---------------------------

const DATA_DIR = path.join(__dirname, CACHE_DIR_NAME);
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
} catch (e) {
    logger.error('创建缓存目录失败，后续读写可能出错:', e.message);
}

function getFilePath(filename) {
    return path.join(DATA_DIR, filename);
}

class CacheService {
    constructor(filename) {
        this.filePath = getFilePath(filename);
        this.#ensureFile();
    }

    #ensureFile() {
        if (!fs.existsSync(this.filePath)) {
            try {
                fs.writeFileSync(this.filePath, EMPTY_JSON_ARRAY, UTF8);
            } catch (err) {
                logger.error(`无法创建缓存文件 ${this.filePath}:`, err.message);
            }
        }
    }

    #parse() {
        try {
            const raw = fs.readFileSync(this.filePath, UTF8);
            const data = JSON.parse(raw || EMPTY_JSON_ARRAY);
            return Array.isArray(data) ? data : [];
        } catch (e) {
            logger.error(`JSON解析错误，重置文件 ${this.filePath}:`, e.message);
            try {
                fs.writeFileSync(this.filePath, EMPTY_JSON_ARRAY, UTF8);
            } catch (writeErr) {
                logger.error(`无法重置缓存文件 ${this.filePath}:`, writeErr.message);
            }
            return [];
        }
    }

    #serialize(messages) {
        try {
            return JSON.stringify(messages, null, 2);
        } catch (e) {
            logger.error('无法序列化对象:', e.message);
            return EMPTY_JSON_ARRAY;
        }
    }

    // 返回已缓存的 id 集合（同步，无锁）
    getCachedIds() {
        const msgs = this.#parse();
        return new Set(msgs.map(m => m.id));
    }

    // 添加/更新条目（同步，无锁）
    addItem(item) {
        if (isDryRun) {
            logger.info(`[DRY-RUN] 跳过写入缓存: ${item.id} - ${item.title}`);
            return;
        }
        try {
            const messages = this.#parse();
            const idx = messages.findIndex(m => m.id === item.id);
            const enriched = { ...item, timestamp: new Date().toISOString() };
            if (idx >= 0) {
                messages[idx] = enriched;
            } else {
                messages.push(enriched);
                if (messages.length > MAX_CACHE_SIZE) {
                    messages.splice(0, messages.length - MAX_CACHE_SIZE);
                }
            }
            fs.writeFileSync(this.filePath, this.#serialize(messages), UTF8);
        } catch (err) {
            logger.error(`写入缓存失败 [${path.basename(this.filePath)}]:`, err.message);
        }
    }
}

// ------------------------ 数据获取与解析 ---------------------------

function parseResponseBody(body) {
    try {
        const parsed = JSON.parse(body);
        if (!parsed) {
            logger.warn('服务器返回空数据');
            return null;
        }
        if (Array.isArray(parsed)) return parsed;
        if (parsed.data && Array.isArray(parsed.data)) return parsed.data;
        logger.warn('数据格式异常，非列表');
        return null;
    } catch (e) {
        logger.error('返回内容不是合法 JSON');
        logger.error('响应片段:', body.slice(0, 300));
        throw e;
    }
}

function ensureItemId(item) {
    item.id ??= item.url || `unknown_${Date.now()}_${Math.random()}`;
    if (!item.id.startsWith('http')) {
        logger.warn('数据缺少 id，使用 url 作为标识');
    }
}

function ensureItemUrl(item) {
    if (item.url) {
        if (!/^https?:\/\//i.test(item.url)) {
            item.url = domin + item.url;
        }
    } else {
        logger.warn('数据缺少 url，使用空链接:', item.title);
        item.url = domin + '/';
    }
}

function extractCacheFileName(url) {
    let filename;
    try {
        filename = path.basename(new URL(url).pathname);
    } catch {
        const parts = url.split('/');
        filename = parts[parts.length - 1];
    }
    if (!filename?.endsWith('.json')) {
        filename = (filename || DEFAULT_CACHE_FILENAME) + '.json';
    }
    return filename;
}

// ------------------------ 主流程 ---------------------------

async function main() {
    logger.info('开始获取线报酷数据...');

    const cacheFileName = extractCacheFileName(fetchUrl);
    const cacheService = new CacheService(cacheFileName);
    const notifier = new Notifier();

    let list;
    try {
        const response = await got(fetchUrl, {
            timeout: REQUEST_TIMEOUT_MS,
            retry: { limit: REQUEST_RETRY_LIMIT, methods: ['GET'] }
        });
        list = parseResponseBody(response.body);
    } catch (error) {
        if (error.response) {
            logger.error('请求失败，状态码:', error.response.statusCode);
        } else if (error.code === 'ETIMEDOUT') {
            logger.error('请求超时:', error.message);
        } else {
            logger.error('请求错误:', error.message);
        }
        return;
    }

    if (!list) return;

    const cachedIds = cacheService.getCachedIds();   // 同步获取，仍可 await（自动包装）
    list.forEach(ensureItemId);

    const newItems = [];
    for (const item of list) {
        if (cachedIds.has(item.id)) continue;
        cacheService.addItem(item);                  // 同步写入
        if (safeFilterItem(item)) {
            newItems.push(item);
        }
    }

    // 推送与日志输出
    for (const item of newItems) {
        ensureItemUrl(item);
        await notifier.send(
            tuisong_replace('【{分类名}】{标题}', item),
            tuisong_replace('<h5>{标题}</h5><br>{Html内容}', item)
        );
        console.log('----------------------------------------------');
        console.log(`发现到新数据:${item.title}【${item.catename}】${item.url}`);
    }

    console.log('\n\n\n\n**************************************************');
    console.log(`获取到${list.length}条数据，筛选后的新数据${newItems.length}条，本次任务结束`);
}

// 启动
main().catch(err => {
    logger.error('程序异常退出:', err);
    process.exit(1);
});
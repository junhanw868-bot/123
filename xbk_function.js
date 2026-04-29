'use strict';

// ======================== 用户配置区域开始 ======================== // 版本号:DeepSeek6

const notify = require('./xbk_sendNotify');
const fs = require('node:fs');
const got = require('got');
const path = require('node:path');
const lockFile = require('proper-lockfile');

// ------------------------ 常量与日志管理 ------------------------
const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) {
  console.log('[DRY-RUN] 仅验证过滤结果,不推送、不写入缓存');
}

// ----- 魔法值消除：所有固定字符串/数字统一为常量 -----
const EMPTY_JSON_ARRAY = '[]';
const UTF8 = 'utf8';
const CACHE_DIR_NAME = 'xianbaoku_cache';
const DEFAULT_CACHE_FILENAME = 'push.json';

const MAX_CACHE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10000;
const REQUEST_RETRY_LIMIT = 2;
const MS_PER_DAY = 86400000;

// 日志级别常量
const LOG_LEVEL = Object.freeze({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 });
const CURRENT_LOG_LEVEL = LOG_LEVEL.INFO;

// 推送内容模板分隔符（原魔法字符串）
const CONTENT_BR_SPACER = '<br>&nbsp;<br>&nbsp;<br>';
const ORIGINAL_LINK_HTML = (url) => `原文链接:<a href="${url}" target="_blank">${url}</a><br>&nbsp;<br>&nbsp;<br>`;

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
  info(...args)  { this._log(LOG_LEVEL.INFO,  'INFO',  ...args); },
  warn(...args)  { this._log(LOG_LEVEL.WARN,  'WARN',  ...args); },
  error(...args) { this._log(LOG_LEVEL.ERROR, 'ERROR', ...args); }
};

// ------------------------ 配置加载与校验 ------------------------
const config = require('./xbk_config.json');

if (!config.domin?.startsWith('http')) {
  throw new Error('配置错误:domin 必须是合法的 HTTP URL');
}
if (
  config.pingbitime &&
  Number.isNaN(Number(config.pingbitime)) &&
  !config.pingbitime.includes('###')
) {
  throw new Error('配置错误:pingbitime 必须是数字或"分类###天数"格式');
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

const newUrl = domin + '/plus/json/push.json';

// ------------------------ 通知发送器（可插拔接口） ------------------------
// 将通知模块封装为函数，如需替换通知渠道只需修改此函数
function sendNotification(title, content) {
  if (DRY_RUN) {
    logger.info('[DRY-RUN] 跳过推送:', title);
    return;
  }
  try {
    notify.wxPusherNotify(title, content);
  } catch (pushError) {
    logger.error(`推送失败: ${title}`, pushError.message);
  }
}

// ------------------------ 正则安全设施 ------------------------
function safeRegExp(pattern, flags) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    logger.error(`正则构造失败：/${pattern}/${flags}，原因：${e.message}`);
    return null;
  }
}

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;
function escapeRegex(string) {
  return string.replaceAll(ESCAPE_REGEX, String.raw`\$&`);
}

const MAX_USER_REGEX_LEN = 300;
const MAX_MATCH_TARGET_LEN = 5000;
const EVIL_PATTERN = /\([^)]*[*+][^)]*\)[*+]|\([^)]*\{[^}]*\}[^)]*\)[*+]/;

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
    logger.warn(`用户正则疑似 Evil Regex，已忽略：${pattern.substring(0, 50)}…`);
    return null;
  }
  return safeRegExp(pattern, flags);
}

// ------------------------ 时间与通用工具 ------------------------
function daysComputed(time) {
  if (typeof time !== 'string' || !time) return Infinity;
  const oldTime = new Date(time.replaceAll('-', '/'));
  if (Number.isNaN(oldTime.getTime())) {
    logger.warn('无法解析日期:', time);
    return Infinity;
  }
  const diff = Date.now() - oldTime.getTime();
  return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}

// ------------------------ 正则拆分辅助 ------------------------
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

// ------------------------ 规则解析与匹配引擎 ------------------------
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
  const strategies = {
    classified: (str) => str.split(/<br>|\n\n|\r\n/)
                             .filter(Boolean)
                             .map(parseSingleRule)
                             .filter(Boolean),
    raw: (str) => {
      if (str.length <= MAX_USER_REGEX_LEN) {
        const reg = safeUserRegExp(str, 'i');
        return reg ? [{ catRegex: null, valRegex: reg }] : [];
      }
      const branches = splitRegexByTopLevelOr(str);
      const rules = [];
      for (const branch of branches) {
        const reg = safeUserRegExp(branch, 'i');
        if (reg) rules.push({ catRegex: null, valRegex: reg });
        else logger.warn(`忽略非法正则分支: ${branch.substring(0, 50)}…`);
      }
      return rules;
    }
  };
  const type = /###/.test(configStr) ? 'classified' : 'raw';
  return strategies[type](configStr);
}

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

// ------------------------ 时间屏蔽逻辑 ------------------------
function parseTimeRule(rawRule) {
  const parts = rawRule.split('###');
  if (parts.length < 2) return null;
  const catPattern = parts[0];
  const days = Number(parts[1]);
  if (Number.isNaN(days)) return null;
  const catRegex = safeRegExp(escapeRegex(catPattern), 'i');
  if (!catRegex) return null;
  return (catStr, groupDays) => catStr && catRegex.test(catStr) && days > groupDays;
}

function checkTimePingbi(group, pingbitime, catStr) {
  if (!pingbitime || !group.louzhuregtime || typeof group.louzhuregtime !== 'string') {
    return false;
  }
  const groupDays = daysComputed(group.louzhuregtime);

  if (/###/.test(pingbitime)) {
    const rules = pingbitime.split(/<br>|\n\n|\r\n/);
    return rules.some(raw => {
      const checker = parseTimeRule(raw);
      return checker ? checker(catStr, groupDays) : false;
    });
  }

  const limitDays = Number(pingbitime);
  return !Number.isNaN(limitDays) && limitDays > groupDays;
}

// ------------------------ 预编译所有规则（资源复用） ------------------------
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

// ------------------------ 字段过滤辅助 ------------------------
function isRetainedByField(rules, catStr, targetStr) {
  return targetStr && matchesAnyRule(rules, catStr, targetStr);
}

function isBlockedByField(rules, catStr, targetStr, retainConditions) {
  if (!targetStr) return false;
  if (retainConditions.includes(true)) return false;
  return matchesAnyRule(rules, catStr, targetStr);
}

// ------------------------ 主过滤函数（增加顶层防御） ------------------------
function listfilter(group) {
  // 新增：防御 null/undefined 输入，局部容错不倒
  if (!group || typeof group !== 'object') {
    logger.warn('listfilter 接收到无效 group，已忽略');
    return false;
  }

  const catStr = typeof group.catename === 'string' ? group.catename : null;
  const louzhuStr = typeof group.louzhu === 'string' ? group.louzhu : null;
  const titleStr = typeof group.title === 'string' ? group.title : null;
  const contentStr = typeof group.content === 'string' ? group.content : null;

  if (checkTimePingbi(group, pingbitime, catStr)) return false;
  if (catStr && pingbifenleiReg?.test?.(catStr)) return false;

  const louzhuRetain = isRetainedByField(RULES.zhanxianlouzhu, catStr, louzhuStr);
  const titleRetain = isRetainedByField(RULES.zhanxianbiaoti, catStr, titleStr);
  const contentRetain = isRetainedByField(RULES.zhanxianneirong, catStr, contentStr);

  if (
    isBlockedByField(RULES.pingbilouzhu, catStr, louzhuStr, [louzhuRetain]) ||
    isBlockedByField(RULES.pingbilouzhuplus, catStr, louzhuStr, [louzhuRetain])
  ) return false;

  if (
    isBlockedByField(RULES.pingbibiaoti, catStr, titleStr, [louzhuRetain, titleRetain]) ||
    isBlockedByField(RULES.pingbibiaotiplus, catStr, titleStr, [louzhuRetain])
  ) return false;

  if (
    isBlockedByField(RULES.pingbineirong, catStr, contentStr, [
      louzhuRetain, titleRetain, contentRetain
    ]) ||
    isBlockedByField(RULES.pingbineirongplus, catStr, contentStr, [louzhuRetain, titleRetain])
  ) return false;

  return true;
}

// ------------------------ 推送内容组装（魔法值消除） ------------------------
function add0(m) { return m < 10 ? '0' + m : m; }

function tuisong_replace(text, shuju) {
  shuju.catename = shuju.category_name || shuju.catename;

  if (shuju.posttime) {
    const posttime = new Date(shuju.posttime * 1000);
    shuju.datetime = `${posttime.getFullYear()}-${add0(posttime.getMonth() + 1)}-${add0(posttime.getDate())}`;
    shuju.shorttime = `${posttime.getHours()}:${add0(posttime.getMinutes())}`;
  }

  const content_html = `${shuju.content_html || ''}${CONTENT_BR_SPACER}${ORIGINAL_LINK_HTML(shuju.url)}`;

  const replacements = {
    '{标题}': shuju.title,
    '{内容}': shuju.content,
    '{Html内容}': content_html,
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
  };

  for (const [key, value] of Object.entries(replacements)) {
    text = text.replaceAll(key, value ?? '');
  }
  return text;
}

// ----- 预编译 html 转 markdown 用到的正则（提升性能） -----
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
  let html = shuju.content_html ? shuju.content_html : '';

  html = html.replaceAll(RE_H, (_, level, content) =>
    '#'.repeat(Number(level)) + ' ' + content + '\n\n'
  );
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

// ------------------------ 缓存与文件管理（魔法值消除） ------------------------
const DATA_DIR = path.join(__dirname, CACHE_DIR_NAME);
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }
} catch (e) {
  logger.error('创建缓存目录失败,后续读写可能出错:', e.message);
}

function getFilePath(filename) {
  return path.join(DATA_DIR, filename);
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, EMPTY_JSON_ARRAY, UTF8);
    } catch (err) {
      logger.error(`无法创建缓存文件 ${filePath}:`, err.message);
    }
  }
}

function fixJsonFile(filePath) {
  ensureFileExists(filePath);
  try {
    const content = fs.readFileSync(filePath, UTF8);
    JSON.parse(content || EMPTY_JSON_ARRAY);
  } catch (error) {
    logger.error(`JSON解析错误,重置文件 ${filePath}:`, error.message);
    try {
      fs.writeFileSync(filePath, EMPTY_JSON_ARRAY, UTF8);
    } catch (writeErr) {
      logger.error(`无法重置缓存文件 ${filePath}:`, writeErr.message);
    }
  }
}

function readMessages(filePath) {
  try {
    fixJsonFile(filePath);
    const data = fs.readFileSync(filePath, UTF8);
    return JSON.parse(data || EMPTY_JSON_ARRAY);
  } catch (error) {
    logger.error(`读取消息失败 ${filePath}:`, error.message);
    return [];
  }
}

function stringifySafe(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (error) {
    logger.error('无法序列化对象:', error.message);
    return EMPTY_JSON_ARRAY;
  }
}

async function appendMessageToFile(message, filename) {
  if (DRY_RUN) {
    logger.info(`[DRY-RUN] 跳过写入缓存: ${message.id} - ${message.title}`);
    return;
  }

  const filePath = getFilePath(filename);
  ensureFileExists(filePath);

  let release;
  try {
    release = await lockFile.lock(filePath, {
      retries: { retries: 5, factor: 2, minTimeout: 100, maxTimeout: 1000 }
    });

    const messages = readMessages(filePath);
    const existingIndex = messages.findIndex(m => m.id === message.id);

    if (existingIndex >= 0) {
      messages[existingIndex] = { ...message, timestamp: new Date().toISOString() };
    } else {
      messages.push({ ...message, timestamp: new Date().toISOString() });
    }

    if (messages.length > MAX_CACHE_SIZE) {
      messages.splice(0, messages.length - MAX_CACHE_SIZE);
    }

    fs.writeFileSync(filePath, stringifySafe(messages), UTF8);
  } catch (error) {
    logger.error(`写入缓存失败 [${filename}]:`, error.message);
  } finally {
    if (release) {
      try {
        await release();
      } catch (e) {
        logger.error('释放文件锁失败:', e.message);
      }
    }
  }
}

function getFileName(url) {
  let filename;
  try {
    filename = path.basename(new URL(url).pathname);
  } catch (e) {
    logger.warn('URL 解析失败，回退到 split 方式:', e.message);
    const parts = url.split('/');
    filename = parts[parts.length - 1];
  }
  if (!filename?.endsWith('.json')) {
    filename = (filename || DEFAULT_CACHE_FILENAME) + '.json';
  }
  return filename;
}

// ------------------------ 主流程辅助 ------------------------
function parseResponseData(body) {
  let xbkdata;
  try {
    xbkdata = JSON.parse(body);
  } catch (e) {
    logger.error('返回内容不是合法 JSON');
    logger.error('响应片段:', body.slice(0, 300));
    throw e;
  }
  if (!xbkdata) {
    logger.warn('警告:服务器返回空数据');
    return null;
  }
  if (Array.isArray(xbkdata)) return xbkdata;
  if (xbkdata.data && Array.isArray(xbkdata.data)) return xbkdata.data;
  logger.warn('数据格式异常,非列表');
  return null;
}

async function getCurrentCacheIds(cacheFilePath) {
  let releaseRead = null;
  try {
    ensureFileExists(cacheFilePath);
    releaseRead = await lockFile.lock(cacheFilePath, {
      retries: { retries: 3, factor: 2, minTimeout: 100, maxTimeout: 500 }
    });
    return new Set(readMessages(cacheFilePath).map(m => m.id));
  } catch (lockErr) {
    logger.warn('获取缓存锁失败,使用空集合继续:', lockErr.message);
    return new Set();
  } finally {
    if (releaseRead) {
      try {
        await releaseRead();
      } catch (e) {
        logger.error('释放文件锁失败:', e.message);
      }
    }
  }
}

function ensureItemId(item) {
  if (item.id == null) {
    logger.warn('数据缺少 id,使用 url 作为标识');
    item.id = item.url || `unknown_${Date.now()}_${Math.random()}`;
  }
}

function ensureItemUrl(item) {
  if (item.url) {
    if (!/^https?:\/\//i.test(item.url)) {
      item.url = domin + item.url;
    }
  } else {
    logger.warn('数据缺少 url,使用空链接:', item.title);
    item.url = domin + '/';
  }
}

// ----- 单条过滤安全包裹（局部容错不倒） -----
function safeFilterItem(item) {
  try {
    return listfilter(item);
  } catch (e) {
    logger.error(`过滤单条数据异常 (${item.id || item.title}): ${e.message}`);
    return false; // 异常时不推送
  }
}

async function filterAndPushItems(list, cachedIds, cacheFileName) {
  list.forEach(ensureItemId);

  const newItems = [];
  for (const item of list) {
    if (!cachedIds.has(item.id)) {
      await appendMessageToFile(item, cacheFileName);
      if (safeFilterItem(item)) {    // 使用安全包裹替代直接调用 listfilter
        newItems.push(item);
      }
    }
  }

  let hebingdata = '';
  for (const item of newItems) {
    ensureItemUrl(item);
    sendNotification(
      tuisong_replace('【{分类名}】{标题}', item),
      tuisong_replace('<h5>{标题}</h5><br>{Html内容}', item)
    );

    console.log('-----------------------------');
    console.log(`发现到新数据:${item.title}【${item.catename}】${item.url}`);

    hebingdata += (hebingdata ? '\n\n' : '') + tuisong_replace('{标题}【{分类名}】{链接}', item);
  }

  console.log('\n\n\n\n*******************************************');
  console.log(`获取到${list.length}条数据,筛选后的新数据${newItems.length}条,本次任务结束`);
  return hebingdata;
}

// ------------------------ 程序入口 ------------------------
logger.info('开始获取线报酷数据...');

(async () => {
  try {
    const response = await got(newUrl, {
      timeout: REQUEST_TIMEOUT_MS,
      retry: { limit: REQUEST_RETRY_LIMIT, methods: ['GET'] }
    });

    const list = parseResponseData(response.body);
    if (!list) return;

    const cacheFileName = getFileName(newUrl);
    const cacheFilePath = getFilePath(cacheFileName);
    const cachedIds = await getCurrentCacheIds(cacheFilePath);

    await filterAndPushItems(list, cachedIds, cacheFileName);
  } catch (error) {
    if (error.response) {
      logger.error('请求失败,状态码:', error.response.statusCode);
    } else if (error.code === 'ETIMEDOUT') {
      logger.error('请求超时:', error.message);
    } else {
      logger.error('请求错误:', error.message);
    }
  }
})();
'use strict';

// 用户配置区域开始 ********************************* // 版本号:DeepSeek6

const notify = require('./xbk_sendNotify');
const fs = require('node:fs');
const got = require('got');
const path = require('node:path');
const lockFile = require('proper-lockfile');

const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) {
  console.log('[DRY-RUN] 仅验证过滤结果,不推送、不写入缓存');
}

const MAX_CACHE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 10000;
const REQUEST_RETRY_LIMIT = 2;
const MS_PER_DAY = 86400000;

const config = require('./xbk_config.json');

// 配置合法性校验
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

// 注意:domin 是原代码的拼写,不要修改为 domain
const domin = config.domin;
const pingbifenlei = config.pingbifenlei;
const pingbibiaoti = config.pingbibiaoti;
const zhanxianbiaoti = config.zhanxianbiaoti;
const pingbibiaotiplus = config.pingbibiaotiplus;
const pingbineirong = config.pingbineirong;
const zhanxianneirong = config.zhanxianneirong;
const pingbineirongplus = config.pingbineirongplus;
const pingbilouzhu = config.pingbilouzhu;
const zhanxianlouzhu = config.zhanxianlouzhu;
const pingbilouzhuplus = config.pingbilouzhuplus;
const pingbitime = config.pingbitime;

const newUrl = domin + '/plus/json/push.json';

// 安全构造正则(捕获异常,防止启动崩溃)
function safeRegExp(pattern, flags) {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    console.error(`正则表达式无效: ${pattern},已忽略`, e.message);
    return null;
  }
}

// ---------- 修复1：提取正则常量，使用 replaceAll + String.raw 消除转义警告 ----------
const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

function escapeRegex(string) {
  return string.replaceAll(ESCAPE_REGEX, String.raw`\$&`);
}

// 正则预编译(使用安全构造) —— 仅保留分类屏蔽正则，其他统一用规则数组
const pingbifenleiReg = safeRegExp(pingbifenlei, 'i');

function daysComputed(time) {
  if (typeof time !== 'string' || !time) return Infinity;
  const oldTime = new Date(time.replaceAll('-', '/'));
  if (Number.isNaN(oldTime.getTime())) {
    console.warn('无法解析日期:', time);
    return Infinity;
  }
  const diff = Date.now() - oldTime.getTime();
  return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}

// ---------- 规则解析与匹配 ----------

/**
 * 将「分类###值」或「纯正则字符串」解析成规则数组
 * 每条规则 { catRegex: RegExp|null, valRegex: RegExp }
 */
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
  if (/###/.test(configStr)) {
    return configStr
      .split(/<br>|\n\n|\r\n/)
      .filter(Boolean)
      .map(parseSingleRule)
      .filter(Boolean);
  }
  // 纯正则模式: 没有分类维度
  const reg = safeRegExp(configStr, 'i');
  return reg ? [{ catRegex: null, valRegex: reg }] : [];
}

/** 测试单条规则是否匹配 */
function matchesRule(rule, catStr, targetStr) {
  if (!rule.valRegex || !targetStr || !rule.valRegex.test(targetStr)) return false;
  if (rule.catRegex) {
    return catStr && rule.catRegex.test(catStr);
  }
  return true;
}

/** 规则数组中是否任意一条匹配 */
function matchesAnyRule(rules, catStr, targetStr) {
  return rules.some(rule => matchesRule(rule, catStr, targetStr));
}

// ---------- 时间屏蔽 ----------

/** 解析 "分类###天数" 格式的时间规则，返回 null 或匹配条件函数 */
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

  // 分类###天数 模式
  if (/###/.test(pingbitime)) {
    const rules = pingbitime.split(/<br>|\n\n|\r\n/);
    return rules.some(raw => {
      const checker = parseTimeRule(raw);
      return checker ? checker(catStr, groupDays) : false;
    });
  }

  // 纯数字模式
  const limitDays = Number(pingbitime);
  if (!Number.isNaN(limitDays)) {
    return limitDays > groupDays;
  }
  return false;
}

// ---------- 预解析所有规则 ----------
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

// ---------- 字段过滤辅助（拆解复杂度） ----------

/** 检查字段是否命中保留规则 */
function isRetainedByField(rules, catStr, targetStr) {
  return targetStr && matchesAnyRule(rules, catStr, targetStr);
}

/** 检查字段是否被屏蔽规则命中（前提：未被保留） */
function isBlockedByField(rules, catStr, targetStr, retainConditions) {
  if (!targetStr) return false;
  // ---------- 修复2：使用 includes 代替 some 检查值存在性 ----------
  if (retainConditions.includes(true)) return false;
  return matchesAnyRule(rules, catStr, targetStr);
}

// ---------- 主过滤函数（认知复杂度 < 5）----------
function listfilter(group) {
  const catStr = typeof group.catename === 'string' ? group.catename : null;
  const louzhuStr = typeof group.louzhu === 'string' ? group.louzhu : null;
  const titleStr = typeof group.title === 'string' ? group.title : null;
  const contentStr = typeof group.content === 'string' ? group.content : null;

  // 1. 时间屏蔽
  if (checkTimePingbi(group, pingbitime, catStr)) return false;

  // 2. 分类屏蔽（使用可选链，保持 catStr 真值检查）
  if (catStr && pingbifenleiReg?.test?.(catStr)) return false;

  // 3. 各字段保留状态
  const louzhuRetain = isRetainedByField(RULES.zhanxianlouzhu, catStr, louzhuStr);
  const titleRetain = isRetainedByField(RULES.zhanxianbiaoti, catStr, titleStr);
  const contentRetain = isRetainedByField(RULES.zhanxianneirong, catStr, contentStr);

  // 4. 楼主屏蔽
  if (
    isBlockedByField(RULES.pingbilouzhu, catStr, louzhuStr, [louzhuRetain]) ||
    isBlockedByField(RULES.pingbilouzhuplus, catStr, louzhuStr, [louzhuRetain])
  ) {
    return false;
  }

  // 5. 标题屏蔽（受 louzhu 保留影响）
  if (
    isBlockedByField(RULES.pingbibiaoti, catStr, titleStr, [louzhuRetain, titleRetain]) ||
    isBlockedByField(RULES.pingbibiaotiplus, catStr, titleStr, [louzhuRetain])
  ) {
    return false;
  }

  // 6. 内容屏蔽（受 louzhu 和 title 保留影响）
  if (
    isBlockedByField(RULES.pingbineirong, catStr, contentStr, [
      louzhuRetain,
      titleRetain,
      contentRetain
    ]) ||
    isBlockedByField(RULES.pingbineirongplus, catStr, contentStr, [louzhuRetain, titleRetain])
  ) {
    return false;
  }

  return true;
}

function add0(m) {
  return m < 10 ? '0' + m : m;
}

function tuisong_replace(text, shuju) {
  shuju.catename = shuju.category_name || shuju.catename;

  if (shuju.posttime) {
    const posttime = new Date(shuju.posttime * 1000);
    shuju.datetime = `${posttime.getFullYear()}-${add0(posttime.getMonth() + 1)}-${add0(
      posttime.getDate()
    )}`;
    shuju.shorttime = `${posttime.getHours()}:${add0(posttime.getMinutes())}`;
  }

  const content_html = `${shuju.content_html || ''}<br>&nbsp;<br>&nbsp;<br>原文链接:<a href="${
    shuju.url
  }" target="_blank">${shuju.url}</a><br>&nbsp;<br>&nbsp;<br>`;

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

  // ---------- 修复3：使用 ?? 代替 value !== undefined 的三元表达式 ----------
  for (const [key, value] of Object.entries(replacements)) {
    text = text.replaceAll(key, value ?? '');
  }

  return text;
}

function htmlToMarkdown(shuju) {
  let html = shuju.content_html ? shuju.content_html : '';

  html = html.replaceAll(/<h([1-6])>(.*?)<\/h\1>/gi, (_, level, content) =>
    '#'.repeat(Number(level)) + ' ' + content + '\n\n'
  );
  html = html.replaceAll(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  html = html.replaceAll(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, '\n\n![$2]($1)\n\n');
  html = html.replaceAll(/<img[^>]+src="([^"]+)"[^>]*>/gi, '\n\n![]($1)\n\n');
  html = html.replaceAll(/<br\s*\/?>/gi, '\n\n');
  html = html.replaceAll(/<p[^>]*>/gi, '\n\n');
  html = html.replaceAll(/<\/p>/gi, '\n\n');
  html = html.replaceAll(/<[^>]+>/g, '');
  html = html.replaceAll(/\n{3,}/g, '\n\n');
  html = `${html}\n\n原文链接:[${shuju.url}](${shuju.url})\n\n\n\n`;

  return html.trim();
}

const DATA_DIR = path.join(__dirname, 'xianbaoku_cache');
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
  }
} catch (e) {
  console.error('创建缓存目录失败,后续读写可能出错:', e.message);
}

function getFilePath(filename) {
  return path.join(DATA_DIR, filename);
}

function ensureFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    try {
      fs.writeFileSync(filePath, '[]', 'utf8');
    } catch (err) {
      console.error(`无法创建缓存文件 ${filePath}:`, err.message);
    }
  }
}

function fixJsonFile(filePath) {
  ensureFileExists(filePath);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    JSON.parse(content || '[]');
  } catch (error) {
    console.error(`JSON解析错误,重置文件 ${filePath}:`, error.message);
    try {
      fs.writeFileSync(filePath, '[]', 'utf8');
    } catch (writeErr) {
      console.error(`无法重置缓存文件 ${filePath}:`, writeErr.message);
    }
  }
}

function readMessages(filePath) {
  try {
    fixJsonFile(filePath);
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error(`读取消息失败 ${filePath}:`, error.message);
    return [];
  }
}

function isMessageInFile(message, filename) {
  const filePath = getFilePath(filename);
  const messages = readMessages(filePath);
  return messages.some(existing => existing.id === message.id);
}

function stringifySafe(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (error) {
    console.error('无法序列化对象:', error.message);
    return '[]';
  }
}

async function appendMessageToFile(message, filename) {
  if (DRY_RUN) {
    console.log(`[DRY-RUN] 跳过写入缓存: ${message.id} - ${message.title}`);
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

    fs.writeFileSync(filePath, stringifySafe(messages), 'utf8');
  } catch (error) {
    console.error(`写入缓存失败 [${filename}]:`, error.message);
  } finally {
    if (release) {
      try {
        await release();
      } catch (e) {
        console.error('释放文件锁失败:', e.message);
      }
    }
  }
}

// ---------- 修复4：捕获异常时输出警告，不赤裸裸地吞掉 ----------
function getFileName(url) {
  let filename;
  try {
    filename = path.basename(new URL(url).pathname);
  } catch (e) {
    console.warn('URL 解析失败，回退到 split 方式:', e.message);
    const parts = url.split('/');
    filename = parts[parts.length - 1];
  }
  // 使用可选链简化校验
  if (!filename?.endsWith('.json')) {
    filename = (filename || 'push') + '.json';
  }
  return filename;
}

// ---------- 主流程辅助 ----------

// ---------- 修复5：捕获 JSON 解析异常后记录并重新抛出，避免“吞掉”异常 ----------
function parseResponseData(body) {
  let xbkdata;
  try {
    xbkdata = JSON.parse(body);
  } catch (e) {
    console.error('返回内容不是合法 JSON');
    console.error('响应片段:', body.slice(0, 300));
    throw e; // 重新抛出，由上层统一处理
  }
  if (!xbkdata) {
    console.log('警告:服务器返回空数据');
    return null;
  }
  if (Array.isArray(xbkdata)) return xbkdata;
  if (xbkdata.data && Array.isArray(xbkdata.data)) return xbkdata.data;
  console.log('数据格式异常,非列表');
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
    console.warn('获取缓存锁失败,使用空集合继续:', lockErr.message);
    return new Set();
  } finally {
    if (releaseRead) {
      try {
        await releaseRead();
      } catch (e) {
        console.error('释放文件锁失败:', e.message);
      }
    }
  }
}

function ensureItemId(item) {
  if (item.id == null) {
    console.warn('数据缺少 id,使用 url 作为标识');
    item.id = item.url || `unknown_${Date.now()}_${Math.random()}`;
  }
}

function ensureItemUrl(item) {
  if (item.url) {
    if (!/^https?:\/\//i.test(item.url)) {
      item.url = domin + item.url;
    }
  } else {
    console.warn('数据缺少 url,使用空链接:', item.title);
    item.url = domin + '/';
  }
}

async function filterAndPushItems(list, cachedIds, cacheFileName) {
  list.forEach(ensureItemId);

  const newItems = [];
  for (const item of list) {
    if (!cachedIds.has(item.id)) {
      await appendMessageToFile(item, cacheFileName);
      if (listfilter(item)) {
        newItems.push(item);
      }
    }
  }

  let hebingdata = '';
  for (const item of newItems) {
    ensureItemUrl(item);

    if (!DRY_RUN) {
      try {
        notify.wxPusherNotify(
          tuisong_replace('【{分类名}】{标题}', item),
          tuisong_replace('<h5>{标题}</h5><br>{Html内容}', item)
        );
      } catch (pushError) {
        console.error(`推送失败: ${item.title}`, pushError.message);
      }
    }

    console.log('-----------------------------');
    console.log(`发现到新数据:${item.title}【${item.catename}】${item.url}`);

    hebingdata += (hebingdata ? '\n\n' : '') + tuisong_replace('{标题}【{分类名}】{链接}', item);
  }

  console.log('\n\n\n\n*******************************************');
  console.log(`获取到${list.length}条数据,筛选后的新数据${newItems.length}条,本次任务结束`);
  return hebingdata;
}

console.debug('开始获取线报酷数据...');

(async () => {
  try {
    const response = await got(newUrl, {
      timeout: REQUEST_TIMEOUT_MS,
      retry: { limit: REQUEST_RETRY_LIMIT, methods: ['GET'] }
    });

    const list = parseResponseData(response.body);
    if (!list) return; // 空数据或格式异常，直接结束（不会触发异常）

    const cacheFileName = getFileName(newUrl);
    const cacheFilePath = getFilePath(cacheFileName);
    const cachedIds = await getCurrentCacheIds(cacheFilePath);

    await filterAndPushItems(list, cachedIds, cacheFileName);
  } catch (error) {
    // 网络、JSON 解析或其他未处理异常统一捕获
    if (error.response) {
      console.log('请求失败,状态码:', error.response.statusCode);
    } else if (error.code === 'ETIMEDOUT') {
      console.log('请求超时:', error.message);
    } else {
      console.log('请求错误:', error.message);
    }
  }
})();
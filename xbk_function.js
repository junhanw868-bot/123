'use strict';

//用户配置区域开始********************************* // 版本号:DeepSeek6

const notify = require('./xbk_sendNotify'); 
const fs = require('fs'); 
const got = require('got'); 
const path = require('path'); 
const lockFile = require('proper-lockfile');

const DRY_RUN = process.argv.includes('--dry-run'); 
if (DRY_RUN) { console.log('[DRY-RUN] 仅验证过滤结果,不推送、不写入缓存'); }

const MAX_CACHE_SIZE = 100; 
const REQUEST_TIMEOUT_MS = 10000; 
const REQUEST_RETRY_LIMIT = 2; 
const MS_PER_DAY = 86400000;

const config = require('./xbk_config.json'); // 使用 const 代替 var

// 配置合法性校验 
if (!config.domin || !config.domin.startsWith('http')) { 
    throw new Error('配置错误:domin 必须是合法的 HTTP URL'); 
}

if (config.pingbitime && Number.isNaN(Number(config.pingbitime)) && !config.pingbitime.includes('###')) { // [FIXED] isNaN -> Number.isNaN
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

// 转义正则特殊字符,用于动态拼接用户输入
function escapeRegex(string) {
    // [CHANGED] replace -> replaceAll
    return string.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 正则预编译(使用安全构造) —— 仅保留分类屏蔽正则，其他统一用规则数组
const pingbifenleiReg = safeRegExp(pingbifenlei, 'i');

function daysComputed(time) {
    if (typeof time !== 'string' || !time) return Infinity;  // 无法计算时视为很老,避免误放
    // [CHANGED] replace -> replaceAll (简单字符替换)
    const oldTime = new Date(time.replaceAll('-', '/'));
    if (Number.isNaN(oldTime.getTime())) { // [FIXED] isNaN -> Number.isNaN
        console.warn('无法解析日期:', time);
        return Infinity;
    }
    const diff = Date.now() - oldTime.getTime();
    return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}

// ---------- 规则解析与匹配 ----------
/**
 * 把「分类###值」或「纯正则字符串」统一解析成规则数组
 * 每条规则形如 { catRegex: RegExp|null, valRegex: RegExp }
 */
function parseRules(configStr) {
    if (!configStr) return [];
    if (/###/.test(configStr)) {
        return configStr.split(/<br>|\n\n|\r\n/)
            .filter(Boolean)
            .map(part => {
                const idx = part.indexOf('###');
                if (idx === -1) return null;
                const cat = part.slice(0, idx);
                const val = part.slice(idx + 3);
                if (!val) return null;
                return {
                    catRegex: cat ? new RegExp(escapeRegex(cat), 'i') : null,
                    valRegex: new RegExp(escapeRegex(val), 'i')
                };
            })
            .filter(Boolean);
    } else {
        // 纯正则模式: 没有分类维度
        return [{ catRegex: null, valRegex: safeRegExp(configStr, 'i') }];
    }
}

/** 测试单条规则是否匹配 */
function matchesRule(rule, catStr, targetStr) {
    if (!rule.valRegex || !targetStr || !rule.valRegex.test(targetStr)) return false;
    if (rule.catRegex) {
        return catStr && rule.catRegex.test(catStr);
    }
    return true; // 无需匹配分类
}

/** 规则数组中是否任意一条匹配 */
function matchesAnyRule(rules, catStr, targetStr) {
    return rules.some(rule => matchesRule(rule, catStr, targetStr));
}

// ---------- 时间屏蔽 ----------
function checkTimePingbi(group, pingbitime, catStr) {
    if (!pingbitime || !group.louzhuregtime || typeof group.louzhuregtime !== 'string') return false;

    if (/###/.test(pingbitime)) {
        const rules = pingbitime.split(/<br>|\n\n|\r\n/);
        for (const rule of rules) {
            const parts = rule.split('###');
            if (
                parts.length >= 2 &&
                catStr &&
                new RegExp(escapeRegex(parts[0]), 'i').test(catStr) &&
                !Number.isNaN(Number(parts[1])) &&
                Number(parts[1]) > daysComputed(group.louzhuregtime)
            ) {
                return true; // 屏蔽
            }
        }
        return false;
    }

    if (!Number.isNaN(Number(pingbitime)) && Number(pingbitime) > daysComputed(group.louzhuregtime)) {
        return true;
    }
    return false;
}

// ---------- 预解析所有规则，避免每次调用 listfilter 重复解析 ----------
const RULES = {
    zhanxianlouzhu: parseRules(zhanxianlouzhu),
    pingbilouzhu: parseRules(pingbilouzhu),
    pingbilouzhuplus: parseRules(pingbilouzhuplus),
    zhanxianbiaoti: parseRules(zhanxianbiaoti),
    pingbibiaoti: parseRules(pingbibiaoti),
    pingbibiaotiplus: parseRules(pingbibiaotiplus),
    zhanxianneirong: parseRules(zhanxianneirong),
    pingbineirong: parseRules(pingbineirong),
    pingbineirongplus: parseRules(pingbineirongplus),
};

// 重构后的过滤函数，复杂度 < 15
function listfilter(group) {
    const catStr = (typeof group.catename === 'string' && group.catename) ? group.catename : null;
    const louzhuStr = (typeof group.louzhu === 'string' && group.louzhu) ? group.louzhu : null;
    const titleStr = (typeof group.title === 'string' && group.title) ? group.title : null;
    const contentStr = (typeof group.content === 'string' && group.content) ? group.content : null;

    // 1. 时间屏蔽
    if (checkTimePingbi(group, pingbitime, catStr)) return false;

    // 2. 分类屏蔽
    if (catStr && pingbifenleiReg && pingbifenleiReg.test(catStr)) return false;

    // 保留状态（跨字段依赖）
    let louzhuRetain = false;
    let titleRetain = false;
    let contentRetain = false;

    // 3. 楼主规则
    if (louzhuStr) {
        if (matchesAnyRule(RULES.zhanxianlouzhu, catStr, louzhuStr)) {
            louzhuRetain = true;
        }
        if (!louzhuRetain && matchesAnyRule(RULES.pingbilouzhu, catStr, louzhuStr)) {
            return false;
        }
        if (!louzhuRetain && matchesAnyRule(RULES.pingbilouzhuplus, catStr, louzhuStr)) {
            return false;
        }
    }

    // 4. 标题规则
    if (titleStr) {
        if (matchesAnyRule(RULES.zhanxianbiaoti, catStr, titleStr)) {
            titleRetain = true;
        }
        if (!louzhuRetain && !titleRetain && matchesAnyRule(RULES.pingbibiaoti, catStr, titleStr)) {
            return false;
        }
        if (!louzhuRetain && matchesAnyRule(RULES.pingbibiaotiplus, catStr, titleStr)) {
            return false; // 加强屏蔽覆盖保留
        }
    }

    // 5. 内容规则
    if (contentStr) {
        if (matchesAnyRule(RULES.zhanxianneirong, catStr, contentStr)) {
            contentRetain = true;
        }
        if (!louzhuRetain && !titleRetain && !contentRetain &&
            matchesAnyRule(RULES.pingbineirong, catStr, contentStr)) {
            return false;
        }
        if (!louzhuRetain && !titleRetain &&
            matchesAnyRule(RULES.pingbineirongplus, catStr, contentStr)) {
            return false;
        }
    }

    return true;
}

function add0(m) { return m < 10 ? '0' + m : m; }

function tuisong_replace(text, shuju) { 
    if (shuju.category_name) { shuju.catename = shuju.category_name; }

    if (shuju.posttime) {
        let posttime = new Date(shuju.posttime * 1000);
        shuju.datetime = `${posttime.getFullYear()}-${add0(posttime.getMonth() + 1)}-${add0(posttime.getDate())}`;
        shuju.shorttime = `${posttime.getHours()}:${add0(posttime.getMinutes())}`;
    }

    let content_html = `${shuju.content_html || ''}<br>&nbsp;<br>&nbsp;<br>原文链接:<a href="${shuju.url}" target="_blank">${shuju.url}</a><br>&nbsp;<br>&nbsp;<br>`;

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
        if (value !== undefined) {
            // [FIXED] 使用 replaceAll 替换字面字符串,避免 split/join
            text = text.replaceAll(key, value);
        } else {
            text = text.replaceAll(key, '');
        }
    }

    return text;
}

function htmlToMarkdown(shuju) { 
    let html = shuju.content_html ? shuju.content_html : '';

    // [CHANGED] 所有 replace 改为 replaceAll，因为正则均带有全局标志
    html = html.replaceAll(/<h([1-6])>(.*?)<\/h\1>/gi, function(match, level, content) {
        return '#'.repeat(level) + ' ' + content + '\n\n';
    });

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
    if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR); }
} catch (e) {
    console.error('创建缓存目录失败,后续读写可能出错:', e.message);
}

function getFilePath(filename) { return path.join(DATA_DIR, filename); }

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
    try { return JSON.stringify(obj, null, 2); } 
    catch (error) { console.error('无法序列化对象:', error.message); return '[]'; } 
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
            retries: {
                retries: 5,
                factor: 2,
                minTimeout: 100,
                maxTimeout: 1000
            }
        });

        const messages = readMessages(filePath);
        const existingIndex = messages.findIndex(m => m.id === message.id);

        if (existingIndex >= 0) {
            messages[existingIndex] = {
                ...message,
                timestamp: new Date().toISOString()
            };
        } else {
            messages.push({
                ...message,
                timestamp: new Date().toISOString()
            });
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
function getFileName(url) { 
    let filename; 
    try { filename = path.basename(new URL(url).pathname); } 
    catch (_) { 
        const parts = url.split('/'); 
        filename = parts[parts.length - 1]; 
    } 
    if (!filename || !filename.endsWith('.json')) { 
        filename = (filename || 'push') + '.json'; 
    } 
    return filename; 
}

console.debug('开始获取线报酷数据...');

(async () => {
    try {
        const response = await got(newUrl, {
            timeout: REQUEST_TIMEOUT_MS,
            retry: { limit: REQUEST_RETRY_LIMIT, methods: ['GET'] }
        });

        // ===== 原 .then 里面的全部代码,直接放在这里 =====
        let xbkdata;
        try {
            xbkdata = JSON.parse(response.body);
        } catch (e) {
            console.error('返回内容不是合法 JSON');
            console.error('响应片段:', response.body.slice(0, 300));
            return;
        }
        try {
            if (!xbkdata) {
                console.log('警告:服务器返回空数据');
                return;
            }

            let list = [];
            if (Array.isArray(xbkdata)) {
                list = xbkdata;
            } else if (xbkdata.data && Array.isArray(xbkdata.data)) {
                list = xbkdata.data;
            } else {
                console.log('数据格式异常,非列表');
                return;
            }

            const cacheFileName = getFileName(newUrl);
            const cacheFilePath = getFilePath(cacheFileName);

            let cachedIds = new Set();
            let releaseRead = null;
            try {
                ensureFileExists(cacheFilePath);
                releaseRead = await lockFile.lock(cacheFilePath, {
                    retries: { retries: 3, factor: 2, minTimeout: 100, maxTimeout: 500 }
                });
                cachedIds = new Set(readMessages(cacheFilePath).map(m => m.id));
            } catch (lockErr) {
                console.warn('获取缓存锁失败,使用空集合继续:', lockErr.message);
            } finally {
                if (releaseRead) {
                    try { await releaseRead(); } catch (e) { console.error('释放文件锁失败:', e.message); }
                }
            }

            list.forEach(item => {
                if (item.id === undefined || item.id === null) {
                    console.warn('数据缺少 id,使用 url 作为标识');
                    item.id = item.url || `unknown_${Date.now()}_${Math.random()}`;
                }
            });

            let items = [];
            for (const item of list) {
                if (!cachedIds.has(item.id)) {
                    await appendMessageToFile(item, cacheFileName);
                    if (listfilter(item)) {  // 已大幅简化，仅传入 item
                        items.push(item);
                    }
                }
            }

            let hebingdata = '';
            items.forEach(item => {
                if (item.url) {
                    if (!/^https?:\/\//i.test(item.url)) {
                        item.url = domin + item.url;
                    }
                } else {
                    console.warn('数据缺少 url,使用空链接:', item.title);
                    item.url = domin + '/';
                }

                let text = '{标题}{内容}';
                let desp = '{链接}';
                text = tuisong_replace(text, item);
                desp = tuisong_replace(desp, item);

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
                console.log('发现到新数据:' + item.title + '【' + item.catename + '】' + item.url);

                if (hebingdata) {
                    hebingdata += '\n\n';
                }
                hebingdata += tuisong_replace('{标题}【{分类名}】{链接}', item);
            });

            console.log('\n\n\n\n*******************************************');
            console.debug(`获取到${list.length}条数据,筛选后的新数据${items.length}条,本次任务结束`);
        } catch (innerError) {
            console.error('处理数据时发生错误:', innerError);
        }
        // ===== 原 .then 代码结束 =====

    } catch (error) {
        if (error.response) {
            console.log('请求失败,状态码:', error.response.statusCode);
        } else if (error.code === 'ETIMEDOUT') {
            console.log('请求超时:', error.message);
        } else {
            console.log('请求错误:', error.message);
        }
    }
})();
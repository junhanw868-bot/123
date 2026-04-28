'use strict';

//用户配置区域开始********************************* // 版本号：DeepSeek6

const notify = require('./xbk_sendNotify'); 
const fs = require('node:fs'); 
const got = require('got'); 
const path = require('path'); 
const lockFile = require('proper-lockfile');

const DRY_RUN = process.argv.includes('--dry-run'); 
if (DRY_RUN) { console.log('[DRY-RUN] 仅验证过滤结果，不推送、不写入缓存'); }

const MAX_CACHE_SIZE = 100; 
const REQUEST_TIMEOUT_MS = 10000; 
const REQUEST_RETRY_LIMIT = 2; 
const MS_PER_DAY = 86400000;

var config = require('./xbk_config.json');

// 配置合法性校验 
if (!config.domin || !config.domin.startsWith('http')) { 
    throw new Error('配置错误：domin 必须是合法的 HTTP URL'); 
}

if (
    config.pingbitime &&
    Number.isNaN(Number(config.pingbitime)) &&
    !config.pingbitime.includes('###')
) {
    throw new Error('配置错误：pingbitime 必须是数字或"分类###天数"格式'); 
}

// ⚠️ 注意：domin 是原代码的拼写，不要修改为 domain 
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

// 安全构造正则（捕获异常，防止启动崩溃）
function safeRegExp(pattern, flags) {
    if (!pattern) return null;
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        console.error(`正则表达式无效: ${pattern}，已忽略`, e.message);
        return null;
    }
}

// 转义正则特殊字符，用于动态拼接用户输入
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 正则预编译（使用安全构造）
const pingbifenleiReg = safeRegExp(pingbifenlei, 'i');
const pingbilouzhuReg = safeRegExp(pingbilouzhu, 'i');
const zhanxianlouzhuReg = safeRegExp(zhanxianlouzhu, 'i');
const pingbilouzhuplusReg = safeRegExp(pingbilouzhuplus, 'i');
const pingbibiaotiReg = safeRegExp(pingbibiaoti, 'i');
const zhanxianbiaotiReg = safeRegExp(zhanxianbiaoti, 'i');
const pingbibiaotiplusReg = safeRegExp(pingbibiaotiplus, 'i');
const pingbineirongReg = safeRegExp(pingbineirong, 'i');
const zhanxianneirongReg = safeRegExp(zhanxianneirong, 'i');
const pingbineirongplusReg = safeRegExp(pingbineirongplus, 'i');

function daysComputed(time) {
    if (typeof time !== 'string' || !time) return Infinity;  // 无法计算时视为很老，避免误放
    const oldTime = new Date(time.replace(/-/g, '/'));
    if (isNaN(oldTime.getTime())) {
        console.warn('无法解析日期:', time);
        return Infinity;
    }
    const diff = Date.now() - oldTime.getTime();
    return diff > 0 ? Math.floor(diff / MS_PER_DAY) : 0;
}

function listfilter(group, pingbifenlei, pingbilouzhu, zhanxianlouzhu, pingbilouzhuplus, pingbibiaoti, zhanxianbiaoti, pingbibiaotiplus, pingbineirong, zhanxianneirong, pingbineirongplus, pingbitime) {

    let pingbitimearr, xiaopingbitimearr, zhanxianlouzhuarr, xiaozhanxianlouzhuarr,
        pingbilouzhuarr, xiaopingbilouzhuarr, pingbilouzhuplusarr, xiaopingbilouzhuplusarr,
        zhanxianbiaotiarr, xiaozhanxianbiaotiarr, pingbibiaotiarr, xiaopingbibiaotiarr,
        pingbibiaotiplusarr, xiaopingbibiaotiplusarr, zhanxianneirongarr, xiaozhanxianneirongarr,
        pingbineirongarr, xiaopingbineirongarr, pingbineirongplusarr, xiaopingbineirongplusarr;

    // 显式初始化所有标志变量，避免 undefined 依赖
    let louzhubaoliu = 0, biaotibaoliu = 0, neirongbaoliu = 0,
        louzhupingbi = 0, louzhupingbiplus = 0, 
        biaotipingbi = 0, biaotipingbiplus = 0,
        neirongpingbi = 0, neirongpingbiplus = 0;

    const catStr = (typeof group.catename === 'string' && group.catename) ? group.catename : null;
    const louzhuStr = (typeof group.louzhu === 'string' && group.louzhu) ? group.louzhu : null;
    const titleStr = (typeof group.title === 'string' && group.title) ? group.title : null;
    const contentStr = (typeof group.content === 'string' && group.content) ? group.content : null;

    // ------ 1. 时间屏蔽（优先级最高）------
    if (pingbitime && group.louzhuregtime) {
        if (typeof group.louzhuregtime !== 'string') {
            // 类型不符，跳过时间过滤
        } else if (pingbitime.match(/###/)) {
            pingbitimearr = pingbitime.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < pingbitimearr.length; j++) {
                xiaopingbitimearr = pingbitimearr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaopingbitimearr[0]), "i")) &&
                    !isNaN(Number(xiaopingbitimearr[1])) &&
                    Number(xiaopingbitimearr[1]) > daysComputed(group.louzhuregtime)
                ) {
                    return false;
                }
            }
        } else {
            if (
                !isNaN(Number(pingbitime)) &&
                Number(pingbitime) > daysComputed(group.louzhuregtime)
            ) {
                return false;
            }
        }
    }

    // ------ 2. 分类屏蔽 ------
    if (pingbifenlei && catStr) {
        if (catStr && pingbifenleiReg && pingbifenleiReg.test(catStr)) {
            return false;
        }
    }

    // ------ 3. 楼主（louzhu）规则 ------

    // 3.1 楼主强制展现
    if (zhanxianlouzhu && louzhuStr) {
        if (zhanxianlouzhu.match(/###/)) {
            zhanxianlouzhuarr = zhanxianlouzhu.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < zhanxianlouzhuarr.length; j++) {
                xiaozhanxianlouzhuarr = zhanxianlouzhuarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaozhanxianlouzhuarr[0]), "i")) &&
                    xiaozhanxianlouzhuarr.length >= 2 &&
                    louzhuStr.match(new RegExp(escapeRegex(xiaozhanxianlouzhuarr[1]), "i"))
                ) {
                    louzhubaoliu = 1;
                }
            }
        } else {
            if (louzhuStr && zhanxianlouzhuReg && zhanxianlouzhuReg.test(louzhuStr)) {
                louzhubaoliu = 1;
            }
        }
    }

    // 3.2 楼主屏蔽
    if (pingbilouzhu && louzhuStr && louzhubaoliu != 1) {
        if (pingbilouzhu.match(/###/)) {
            pingbilouzhuarr = pingbilouzhu.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < pingbilouzhuarr.length; j++) {
                xiaopingbilouzhuarr = pingbilouzhuarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaopingbilouzhuarr[0]), "i")) &&
                    xiaopingbilouzhuarr.length >= 2 &&
                    louzhuStr.match(new RegExp(escapeRegex(xiaopingbilouzhuarr[1]), "i"))
                ) {
                    louzhupingbi = 1;
                }
            }
        } else {
            if (louzhuStr && pingbilouzhuReg && pingbilouzhuReg.test(louzhuStr)) {
                louzhupingbi = 1;
            }
        }
    }

    // 3.3 楼主加强屏蔽（增加 louzhubaoliu != 1 检查，防止覆盖强制展现）
    if (pingbilouzhuplus && louzhuStr && louzhubaoliu != 1 && louzhupingbi != 1) {
        if (pingbilouzhuplus.match(/###/)) {
            pingbilouzhuplusarr = pingbilouzhuplus.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < pingbilouzhuplusarr.length; j++) {
                xiaopingbilouzhuplusarr = pingbilouzhuplusarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaopingbilouzhuplusarr[0]), "i")) &&
                    xiaopingbilouzhuplusarr.length >= 2 &&
                    louzhuStr.match(new RegExp(escapeRegex(xiaopingbilouzhuplusarr[1]), "i"))
                ) {
                    louzhupingbiplus = 1;
                    louzhubaoliu = 0;
                }
            }
        } else {
            if (louzhuStr && pingbilouzhuplusReg && pingbilouzhuplusReg.test(louzhuStr)) {
                louzhupingbiplus = 1;
                louzhubaoliu = 0;
            }
        }
    }

    if (louzhupingbi == 1 || louzhupingbiplus == 1) {
        return false;
    }

    // ------ 4. 标题（title）规则 ------

    // 4.1 标题强制展现
    if (zhanxianbiaoti && titleStr) {
        if (zhanxianbiaoti.match(/###/)) {
            zhanxianbiaotiarr = zhanxianbiaoti.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < zhanxianbiaotiarr.length; j++) {
                xiaozhanxianbiaotiarr = zhanxianbiaotiarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaozhanxianbiaotiarr[0]), "i")) &&
                    xiaozhanxianbiaotiarr.length >= 2 &&
                    titleStr.match(new RegExp(escapeRegex(xiaozhanxianbiaotiarr[1]), "i"))
                ) {
                    biaotibaoliu = 1;
                }
            }
        } else {
            if (titleStr && zhanxianbiaotiReg && zhanxianbiaotiReg.test(titleStr)) {
                biaotibaoliu = 1;
            }
        }
    }

    // 4.2 标题屏蔽
    if (pingbibiaoti && titleStr && louzhubaoliu != 1 && biaotibaoliu != 1) {
        if (pingbibiaoti.match(/###/)) {
            pingbibiaotiarr = pingbibiaoti.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < pingbibiaotiarr.length; j++) {
                xiaopingbibiaotiarr = pingbibiaotiarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaopingbibiaotiarr[0]), "i")) &&
                    xiaopingbibiaotiarr.length >= 2 &&
                    titleStr.match(new RegExp(escapeRegex(xiaopingbibiaotiarr[1]), "i"))
                ) {
                    biaotipingbi = 1;
                }
            }
        } else {
            if (titleStr && pingbibiaotiReg && pingbibiaotiReg.test(titleStr)) {
                biaotipingbi = 1;
            }
        }
    }

    // 4.3 标题加强屏蔽
    if (pingbibiaotiplus && titleStr && louzhubaoliu != 1 && biaotipingbi != 1) {
        if (pingbibiaotiplus.match(/###/)) {
            pingbibiaotiplusarr = pingbibiaotiplus.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < pingbibiaotiplusarr.length; j++) {
                xiaopingbibiaotiplusarr = pingbibiaotiplusarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaopingbibiaotiplusarr[0]), "i")) &&
                    xiaopingbibiaotiplusarr.length >= 2 &&
                    titleStr.match(new RegExp(escapeRegex(xiaopingbibiaotiplusarr[1]), "i"))
                ) {
                    biaotipingbiplus = 1;
                    biaotibaoliu = 0;
                }
            }
        } else {
            if (titleStr && pingbibiaotiplusReg && pingbibiaotiplusReg.test(titleStr)) {
                biaotipingbiplus = 1;
                biaotibaoliu = 0;
            }
        }
    }

    if (biaotipingbi == 1 || biaotipingbiplus == 1) {
        return false;
    }

    // ------ 5. 内容（content）规则 ------

    // 5.1 内容强制展现
    if (zhanxianneirong && contentStr) {
        if (zhanxianneirong.match(/###/)) {
            zhanxianneirongarr = zhanxianneirong.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < zhanxianneirongarr.length; j++) {
                xiaozhanxianneirongarr = zhanxianneirongarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaozhanxianneirongarr[0]), "i")) &&
                    xiaozhanxianneirongarr.length >= 2 &&
                    contentStr.match(new RegExp(escapeRegex(xiaozhanxianneirongarr[1]), "i"))
                ) {
                    neirongbaoliu = 1;
                }
            }
        } else {
            if (contentStr && zhanxianneirongReg && zhanxianneirongReg.test(contentStr)) {
                neirongbaoliu = 1;
            }
        }
    }

    // 5.2 内容屏蔽
    if (pingbineirong && contentStr && louzhubaoliu != 1 && biaotibaoliu != 1 && neirongbaoliu != 1) {
        if (pingbineirong.match(/###/)) {
            pingbineirongarr = pingbineirong.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < pingbineirongarr.length; j++) {
                xiaopingbineirongarr = pingbineirongarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaopingbineirongarr[0]), "i")) &&
                    xiaopingbineirongarr.length >= 2 &&
                    contentStr.match(new RegExp(escapeRegex(xiaopingbineirongarr[1]), "i"))
                ) {
                    neirongpingbi = 1;
                }
            }
        } else {
            if (contentStr && pingbineirongReg && pingbineirongReg.test(contentStr)) {
                neirongpingbi = 1;
            }
        }
    }

    // 5.3 内容加强屏蔽
    if (pingbineirongplus && contentStr && louzhubaoliu != 1 && biaotibaoliu != 1 && neirongpingbi != 1) {
        if (pingbineirongplus.match(/###/)) {
            pingbineirongplusarr = pingbineirongplus.split(/<br>|\n\n|\r\n/);
            for (let j = 0; j < pingbineirongplusarr.length; j++) {
                xiaopingbineirongplusarr = pingbineirongplusarr[j].split("###");
                if (
                    catStr &&
                    catStr.match(new RegExp(escapeRegex(xiaopingbineirongplusarr[0]), "i")) &&
                    xiaopingbineirongplusarr.length >= 2 &&
                    contentStr.match(new RegExp(escapeRegex(xiaopingbineirongplusarr[1]), "i"))
                ) {
                    neirongpingbiplus = 1;
                    neirongbaoliu = 0;
                }
            }
        } else {
            if (contentStr && pingbineirongplusReg && pingbineirongplusReg.test(contentStr)) {
                neirongpingbiplus = 1;
                neirongbaoliu = 0;
            }
        }
    }

    if (neirongpingbi == 1 || neirongpingbiplus == 1) {
        return false;
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

    let content_html = `${shuju.content_html || ''}<br>&nbsp;<br>&nbsp;<br>原文链接：<a href="${shuju.url}" target="_blank">${shuju.url}</a><br>&nbsp;<br>&nbsp;<br>`;

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
            // 使用 split/join 全局替换，避免正则特殊字符导致的崩溃
            text = text.split(key).join(value);
        } else {
            text = text.split(key).join('');
        }
    }

    return text;
}

function htmlToMarkdown(shuju) { 
    let html = shuju.content_html ? shuju.content_html : '';

    html = html.replace(/<h([1-6])>(.*?)<\/h\1>/gi, function(match, level, content) {
        return '#'.repeat(level) + ' ' + content + '\n\n';
    });

    // 优化后的正则，限定字符减少回溯
    html = html.replace(/<a\s+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
    html = html.replace(/<img[^>]+src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/gi, '\n\n![$2]($1)\n\n');
    html = html.replace(/<img[^>]+src="([^"]+)"[^>]*>/gi, '\n\n![]($1)\n\n');
    html = html.replace(/<br\s*\/?>/gi, '\n\n');
    html = html.replace(/<p[^>]*>/gi, '\n\n');
    html = html.replace(/<\/p>/gi, '\n\n');
    html = html.replace(/<[^>]+>/g, '');
    html = html.replace(/\n{3,}/g, '\n\n');
    html = `${html}\n\n原文链接：[${shuju.url}](${shuju.url})\n\n\n\n`;

    return html.trim();
}

const DATA_DIR = path.join(__dirname, 'xianbaoku_cache');
try {
    if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR); }
} catch (e) {
    console.error('创建缓存目录失败，后续读写可能出错:', e.message);
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
        console.error(`JSON解析错误，重置文件 ${filePath}:`, error.message);
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

got(newUrl, { 
    timeout: REQUEST_TIMEOUT_MS, 
    retry: { limit: REQUEST_RETRY_LIMIT, methods: ['GET'] } 
})
.then(async (response) => {
    let xbkdata;
    try {
        xbkdata = JSON.parse(response.body);
    } catch (e) {
        console.error('返回内容不是合法 JSON');
        console.error('响应片段：', response.body.slice(0, 300));
        return;
    }
    try {
        if (!xbkdata) {
            console.log('警告：服务器返回空数据');
            return;
        }

        let list = [];
        if (Array.isArray(xbkdata)) {
            list = xbkdata;
        } else if (xbkdata.data && Array.isArray(xbkdata.data)) {
            list = xbkdata.data;
        } else {
            console.log('数据格式异常，非列表');
            return;
        }

        const cacheFileName = getFileName(newUrl);
        const cacheFilePath = getFilePath(cacheFileName);

        // 加锁读取缓存ID，避免并发下的去重失效
        let cachedIds = new Set();
        let releaseRead = null;
        try {
    ensureFileExists(cacheFilePath);
    releaseRead = await lockFile.lock(cacheFilePath, {
        retries: { retries: 3, factor: 2, minTimeout: 100, maxTimeout: 500 }
    });
    cachedIds = new Set(readMessages(cacheFilePath).map(m => m.id));
} catch (lockErr) {

            console.warn('获取缓存锁失败，使用空集合继续:', lockErr.message);
        } finally {
            if (releaseRead) {
                try {
                    await releaseRead();
                } catch (e) {
                    console.error('释放文件锁失败:', e.message);
                }
            }
        }

        // 补齐缺失的 id，防止去重紊乱
        list.forEach(item => {
            if (item.id === undefined || item.id === null) {
                console.warn('数据缺少 id，使用 url 作为标识');
                item.id = item.url || `unknown_${Date.now()}_${Math.random()}`;
            }
        });

        let items = [];

        for (const item of list) {
            if (!cachedIds.has(item.id)) {
                await appendMessageToFile(item, cacheFileName);

                if (
                    listfilter(
                        item,
                        pingbifenlei,
                        pingbilouzhu,
                        zhanxianlouzhu,
                        pingbilouzhuplus,
                        pingbibiaoti,
                        zhanxianbiaoti,
                        pingbibiaotiplus,
                        pingbineirong,
                        zhanxianneirong,
                        pingbineirongplus,
                        pingbitime
                    )
                ) {
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
    console.warn('数据缺少 url，使用空链接:', item.title);
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
            console.log('发现到新数据：' + item.title + '【' + item.catename + '】' + item.url);

            if (hebingdata) {
                hebingdata += '\n\n';
            }
            hebingdata += tuisong_replace('{标题}【{分类名}】{链接}', item);
        });

        console.log('\n\n\n\n*******************************************');
        console.debug(`获取到${list.length}条数据，筛选后的新数据${items.length}条，本次任务结束`);
    } catch (innerError) {
        console.error('处理数据时发生错误:', innerError);
    }
})
.catch(error => { 
    if (error.response) { 
        console.log('请求失败，状态码:', error.response.statusCode); 
    } else if (error.code === 'ETIMEDOUT') { 
        console.log('请求超时:', error.message); 
    } else { 
        console.log('请求错误:', error.message); 
    } 
});
// ==================== 常量与预编译资源 ====================
//版本号1.1
const NEWLINE_REGEX = /[\n\r]/g;             // 预编译正则，资源复用
const DEFAULT_TIMEOUT = 15000;               // 请求超时，消除魔法数字
const HITOKOTO_API = 'https://v1.hitokoto.cn/';
const WXPUSHER_API = 'https://wxpusher.zjiecode.com/api/send/message';
const PUSHPLUS_API = 'https://www.pushplus.plus/send';
const DEFAULT_PUSHME_URL = 'https://push.i-i.me';

// ==================== HTTP 客户端（资源复用） ====================
const got = require('got');

const httpClient = {
    async post(url, json, headers = {}) {
        const response = await got.post(url, {
            json,
            headers: { 'Content-Type': 'application/json', ...headers },
            timeout: DEFAULT_TIMEOUT,
        }).catch(err => {
            // 局部容错：只抛出可读错误，不中断全局
            throw err?.response?.body || err;
        });
        return safeParseJSON(response?.body);
    },

    async get(url) {
        const response = await got.get(url, { timeout: DEFAULT_TIMEOUT }).catch(err => {
            throw err?.response?.body || err;
        });
        return safeParseJSON(response?.body);
    }
};

// 安全 JSON 解析，消除异常中断
function safeParseJSON(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

// ================== 配置验证与规范化 ==================
function normalizeConfig(raw) {
    return {
        HITOKOTO: raw.HITOKOTO !== 'false', // 字符串转布尔，语义明确
        WX_pusher_appToken: raw.WX_pusher_appToken || '',
        WX_pusher_topicIds: raw.WX_pusher_topicIds || '',
        PUSHME_URL: raw.PUSHME_URL || DEFAULT_PUSHME_URL,
        PUSHME_KEY: raw.PUSHME_KEY || '',
        PUSH_PLUS_TOKEN: raw.PUSH_PLUS_TOKEN || '',
        PUSH_PLUS_USER: raw.PUSH_PLUS_USER || '',
    };
}

// ==================== 一言服务 ====================
class HitokotoService {
    static async fetch() {
        const data = await httpClient.get(HITOKOTO_API);
        return `${data?.hitokoto}    ----${data?.from}`;
    }
}

// ==================== 推送器基类（接口契约） ====================
class BaseNotifier {
    constructor(config) {
        this.config = config;
    }

    isEnabled() {
        return false; // 子类必须重写
    }

    async notify(title, content, params = {}) {
        throw new Error('notify() must be implemented by subclass');
    }
}

// ------------------ WxPusher 推送器 ------------------
class WxPusherNotifier extends BaseNotifier {
    isEnabled() {
        return Boolean(this.config.WX_pusher_appToken);
    }

    async notify(title, content) {
        if (!this.isEnabled()) return;

        const payload = {
            appToken: this.config.WX_pusher_appToken,
            content,
            summary: title.substring(0, 90),
            contentType: 2,
            topicIds: [this.config.WX_pusher_topicIds],
        };

        try {
            const data = await httpClient.post(WXPUSHER_API, payload);
            if (data?.code === 1000) {
                console.log('[WxPusher] 发送成功');
            } else {
                console.warn('[WxPusher] 发送异常', data);
            }
        } catch (err) {
            console.error('[WxPusher] 发送失败', err);
        }
    }
}

// ------------------ PushMe 推送器 ------------------
class PushMeNotifier extends BaseNotifier {
    isEnabled() {
        return Boolean(this.config.PUSHME_KEY);
    }

    async notify(title, content, params = {}) {
        if (!this.isEnabled()) return;

        const keys = this.config.PUSHME_KEY.split('#').filter(Boolean);
        const url = this.config.PUSHME_URL;

        for (const key of keys) {
            const payload = {
                push_key: key,
                title,
                content,
                type: 'markdown',
                ...params,
            };
            try {
                const res = await httpClient.post(url, payload);
                if (res === 'success') {
                    console.log(`[PushMe] ${key} 发送成功`);
                } else {
                    console.warn(`[PushMe] ${key} 响应异常`, res);
                }
            } catch (err) {
                console.error(`[PushMe] ${key} 发送失败`, err);
            }
        }
    }
}

// ------------------ PushPlus 推送器 ------------------
class PushPlusNotifier extends BaseNotifier {
    isEnabled() {
        return Boolean(this.config.PUSH_PLUS_TOKEN);
    }

    async notify(title, content) {
        if (!this.isEnabled()) return;

        // 使用预编译正则替换换行，消除重复创建
        const htmlContent = content.replace(NEWLINE_REGEX, '<br>');

        const payload = {
            token: this.config.PUSH_PLUS_TOKEN,
            title,
            content: htmlContent,
            topic: this.config.PUSH_PLUS_USER || undefined,
        };

        try {
            const data = await httpClient.post(PUSHPLUS_API, payload);
            if (data?.code === 200) {
                const mode = this.config.PUSH_PLUS_USER ? '一对多' : '一对一';
                console.log(`[PushPlus] ${mode} 发送成功`);
            } else {
                console.warn(`[PushPlus] 发送异常`, data?.msg);
            }
        } catch (err) {
            console.error('[PushPlus] 发送失败', err);
        }
    }
}

// ==================== 通知管理器（组装与调度） ====================
class NotifyManager {
    constructor(rawConfig) {
        this.config = normalizeConfig(rawConfig);
        this.notifiers = [
            new WxPusherNotifier(this.config),
            new PushMeNotifier(this.config),
            new PushPlusNotifier(this.config),
        ];
    }

    async send(title, content, params = {}) {
        // 使用可选链防御，更简洁安全
        const skipList = process.env.SKIP_PUSH_TITLE;
        if (skipList?.split('\n')?.includes(title)) {
            console.info(`[Notify] ${title} 位于跳过列表，已跳过`);
            return;
        }

        // 附加一言内容
        let finalContent = content;
        if (this.config.HITOKOTO) {
            try {
                const hitokoto = await HitokotoService.fetch();
                finalContent += '\n\n' + hitokoto;
            } catch (err) {
                console.error('[Notify] 一言获取失败', err);
            }
        }

        // 筛选启用的推送器，并发推送，局部失败不影响全局
        const tasks = this.notifiers
            .filter(notifier => notifier.isEnabled())
            .map(notifier => notifier.notify(title, finalContent, params));

        await Promise.all(tasks);
    }
}

// ==================== 单例与导出（向下兼容） ====================
const push_config = {
    HITOKOTO: 'false',
    WX_pusher_appToken: '',
    WX_pusher_topicIds: '',
    PUSHME_URL: 'https://push.i-i.me',
    PUSHME_KEY: '',
    PUSH_PLUS_TOKEN: '',
    PUSH_PLUS_USER: '',
};

const manager = new NotifyManager(push_config);

async function sendNotify(text, desp, params = {}) {
    return manager.send(text, desp, params);
}

function wxPusherNotify(text, desp) {
    return new WxPusherNotifier(normalizeConfig(push_config)).notify(text, desp);
}

function pushMeNotify(text, desp, params = {}) {
    return new PushMeNotifier(normalizeConfig(push_config)).notify(text, desp, params);
}

function pushPlusNotify(text, desp) {
    return new PushPlusNotifier(normalizeConfig(push_config)).notify(text, desp);
}

module.exports = {
    sendNotify,
    wxPusherNotify,
    pushMeNotify,
    pushPlusNotify,
};
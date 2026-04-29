// ==================== 常量与预编译资源 ====================
// 版本号 1.3
const NEWLINE_REGEX = /[\n\r]/g;
const DEFAULT_TIMEOUT = 15000;
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

// 安全 JSON 解析
function safeParseJSON(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

// ================== 配置规范化 ==================
function normalizeConfig(raw) {
    return {
        HITOKOTO: raw.HITOKOTO !== 'false',
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
        return `${data?.hitokoto ?? ''}    ----${data?.from ?? ''}`;
    }
}

// ==================== 推送器基类 ====================
class BaseNotifier {
    constructor(config) {
        this.config = config;
    }

    isEnabled() {
        return false;
    }

    async notify(title, content, params = {}) {
        throw new Error('notify() must be implemented by subclass');
    }
}

// ------------------ WxPusher ------------------
class WxPusherNotifier extends BaseNotifier {
    isEnabled() {
        return Boolean(this.config.WX_pusher_appToken && this.config.WX_pusher_topicIds);
    }

    async notify(title, content) {
        if (!this.isEnabled()) return;

        const payload = {
            appToken: this.config.WX_pusher_appToken,
            content,
            summary: (title ?? '').substring(0, 90),
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

// ------------------ PushMe ------------------
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

// ------------------ PushPlus ------------------
class PushPlusNotifier extends BaseNotifier {
    isEnabled() {
        return Boolean(this.config.PUSH_PLUS_TOKEN);
    }

    async notify(title, content) {
        if (!this.isEnabled()) return;

        // 兼容旧版 Node，使用 replace 代替 replaceAll
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

// ==================== 通知管理器 ====================
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
        // 跳过列表检查
        const skipList = process.env.SKIP_PUSH_TITLE;
        if (skipList?.split('\n')?.includes(title)) {
            console.info(`[Notify] ${title} 位于跳过列表，已跳过`);
            return;
        }

        // 附加一言
        let finalContent = content;
        if (this.config.HITOKOTO) {
            try {
                const hitokoto = await HitokotoService.fetch();
                finalContent += '\n\n' + hitokoto;
            } catch (err) {
                console.error('[Notify] 一言获取失败', err);
            }
        }

        const enabledNotifiers = this.notifiers.filter(n => n.isEnabled());
        if (enabledNotifiers.length === 0) {
            console.warn('[Notify] 无任何推送渠道启用，请检查配置');
            return;
        }

        const tasks = enabledNotifiers.map(n => n.notify(title, finalContent, params));
        await Promise.all(tasks);
    }
}

// ==================== 配置加载（优先环境变量，再硬编码兜底） ====================
const push_config = {
    HITOKOTO: process.env.HITOKOTO || 'false',
    WX_pusher_appToken: process.env.WX_pusher_appToken || '',
    WX_pusher_topicIds: process.env.WX_pusher_topicIds || '',
    PUSHME_URL: process.env.PUSHME_URL || 'https://push.i-i.me',
    PUSHME_KEY: process.env.PUSHME_KEY || '',
    PUSH_PLUS_TOKEN: process.env.PUSH_PLUS_TOKEN || '',
    PUSH_PLUS_USER: process.env.PUSH_PLUS_USER || '',
};

// 如果环境变量全为空，可在此处直接填入测试 token（不推荐长期使用）
// push_config.WX_pusher_appToken = 'AT_xxx';
// push_config.WX_pusher_topicIds = '44193';

const manager = new NotifyManager(push_config);

// ==================== 导出（向下兼容） ====================
async function sendNotify(text, desp, params = {}) {
    return manager.send(text, desp, params);
}

function wxPusherNotify(text, desp) {
    const cfg = normalizeConfig(push_config);
    return new WxPusherNotifier(cfg).notify(text, desp);
}

function pushMeNotify(text, desp, params = {}) {
    const cfg = normalizeConfig(push_config);
    return new PushMeNotifier(cfg).notify(text, desp, params);
}

function pushPlusNotify(text, desp) {
    const cfg = normalizeConfig(push_config);
    return new PushPlusNotifier(cfg).notify(text, desp);
}

module.exports = {
    sendNotify,
    wxPusherNotify,
    pushMeNotify,
    pushPlusNotify,
};
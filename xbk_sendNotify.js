// ==================== 常量与配置 ====================
//版本号1.4
const NEWLINE_REGEX = /[\n\r]/g;
const DEFAULT_TIMEOUT = 15_000;

const HITOKOTO_API = 'https://v1.hitokoto.cn/';
const WXPUSHER_API = 'https://wxpusher.zjiecode.com/api/send/message';
const PUSHPLUS_API = 'https://www.pushplus.plus/send';
const DEFAULT_PUSHME_URL = 'https://push.i-i.me';

// ==================== HTTP 客户端（原生 fetch + 超时） ====================
const httpClient = {
    async post(url, json, headers = {}) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...headers },
                body: JSON.stringify(json),
                signal: controller.signal,
            });
            return await safeParseResponse(res);
        } catch (err) {
            throw err.name === 'AbortError' ? new Error('Request timeout') : err;
        } finally {
            clearTimeout(timeout);
        }
    },

    async get(url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
        try {
            const res = await fetch(url, { signal: controller.signal });
            return await safeParseResponse(res);
        } catch (err) {
            throw err.name === 'AbortError' ? new Error('Request timeout') : err;
        } finally {
            clearTimeout(timeout);
        }
    }
};

// 安全解析响应（优先 JSON，否则返回纯文本）
async function safeParseResponse(res) {
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

// ==================== 一言服务 ====================
class HitokotoService {
    static async fetch() {
        const data = await httpClient.get(HITOKOTO_API);
        return `${data?.hitokoto ?? ''}    ----${data?.from ?? ''}`;
    }
}

// ==================== 推送渠道基类 ====================
class BaseNotifier {
    #config;
    constructor(config) { this.#config = config; }
    get config() { return this.#config; }
    isEnabled() { return false; }
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
            data?.code === 1000
                ? console.log('[WxPusher] 发送成功')
                : console.warn('[WxPusher] 发送异常', data);
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
            const payload = { push_key: key, title, content, type: 'markdown', ...params };
            try {
                const res = await httpClient.post(url, payload);
                res === 'success'
                    ? console.log(`[PushMe] ${key} 发送成功`)
                    : console.warn(`[PushMe] ${key} 响应异常`, res);
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
        // ✅ 使用最新语法 replaceAll，语义明确，符合静态分析要求
        const htmlContent = content.replaceAll(NEWLINE_REGEX, '<br>');
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
    #config;
    #notifiers;

    constructor(rawConfig) {
        this.#config = normalizeConfig(rawConfig);
        this.#notifiers = [
            new WxPusherNotifier(this.#config),
            new PushMeNotifier(this.#config),
            new PushPlusNotifier(this.#config),
        ];
    }

    async send(title, content, params = {}) {
        // 跳过列表
        const skipList = process.env.SKIP_PUSH_TITLE;
        if (skipList?.split('\n')?.includes(title)) {
            console.info(`[Notify] ${title} 位于跳过列表，已跳过`);
            return;
        }

        // 附加一言
        let finalContent = content;
        if (this.#config.HITOKOTO) {
            try {
                const hitokoto = await HitokotoService.fetch();
                finalContent += '\n\n' + hitokoto;
            } catch (err) {
                console.error('[Notify] 一言获取失败', err);
            }
        }

        const enabled = this.#notifiers.filter(n => n.isEnabled());
        if (enabled.length === 0) {
            console.warn('[Notify] 无任何推送渠道启用，请检查配置');
            return;
        }

        // 更健壮的并发控制：一个失败不影响其他
        const results = await Promise.allSettled(
            enabled.map(n => n.notify(title, finalContent, params))
        );
        results.forEach((result, i) => {
            if (result.status === 'rejected') {
                console.error(`[Notify] ${enabled[i].constructor.name} 推送异常`, result.reason);
            }
        });
    }
}

// ==================== 配置规范化 ====================
function normalizeConfig(raw) {
    return {
        HITOKOTO: raw.HITOKOTO !== 'false',
        WX_pusher_appToken: raw.WX_pusher_appToken ?? '',
        WX_pusher_topicIds: raw.WX_pusher_topicIds ?? '',
        PUSHME_URL: raw.PUSHME_URL ?? DEFAULT_PUSHME_URL,
        PUSHME_KEY: raw.PUSHME_KEY ?? '',
        PUSH_PLUS_TOKEN: raw.PUSH_PLUS_TOKEN ?? '',
        PUSH_PLUS_USER: raw.PUSH_PLUS_USER ?? '',
    };
}

// ==================== 配置加载（环境变量优先，可在此处填入测试 key） ====================
const pushConfig = {
    HITOKOTO: process.env.HITOKOTO ?? 'false',
    WX_pusher_appToken: process.env.WX_pusher_appToken ?? '',
    WX_pusher_topicIds: process.env.WX_pusher_topicIds ?? '',
    PUSHME_URL: process.env.PUSHME_URL ?? DEFAULT_PUSHME_URL,
    PUSHME_KEY: process.env.PUSHME_KEY ?? '',
    PUSH_PLUS_TOKEN: process.env.PUSH_PLUS_TOKEN ?? '',
    PUSH_PLUS_USER: process.env.PUSH_PLUS_USER ?? '',
};

// 若需开发测试，可在此处临时覆盖（不推荐长期使用）
// pushConfig.WX_pusher_appToken = 'AT_xxx';
// pushConfig.WX_pusher_topicIds = '44193';

const manager = new NotifyManager(pushConfig);

// ==================== 导出（ESM） ====================
async function sendNotify(text, desp, params = {}) {
    return manager.send(text, desp, params);
}

function wxPusherNotify(text, desp) {
    const cfg = normalizeConfig(pushConfig);
    return new WxPusherNotifier(cfg).notify(text, desp);
}

function pushMeNotify(text, desp, params = {}) {
    const cfg = normalizeConfig(pushConfig);
    return new PushMeNotifier(cfg).notify(text, desp, params);
}

function pushPlusNotify(text, desp) {
    const cfg = normalizeConfig(pushConfig);
    return new PushPlusNotifier(cfg).notify(text, desp);
}

export { sendNotify, wxPusherNotify, pushMeNotify, pushPlusNotify };
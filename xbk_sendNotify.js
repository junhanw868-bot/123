// ======================== 用户配置区域 ========================
const push_config = {
    HITOKOTO: 'false',      // 启用一言（随机句子）

    // WxPusher 配置
    WX_pusher_appToken: '',
    WX_pusher_topicIds: '',

    // PushMe 配置
    PUSHME_URL: 'https://push.i-i.me',
    PUSHME_KEY: '',

    // PushPlus 配置
    PUSH_PLUS_TOKEN: '',
    PUSH_PLUS_USER: '',
};

// ======================== 通用工具 ========================
const got = require('got');
const timeout = 15000;

const httpClient = {
    async post(url, json, headers = {}) {
        const response = await got.post(url, {
            json,
            headers: { 'Content-Type': 'application/json', ...headers },
            timeout,
        }).catch(err => {
            throw err?.response?.body || err;
        });
        let body = response.body;
        try { body = JSON.parse(body); } catch {}
        return body;
    },

    async get(url) {
        const response = await got.get(url, { timeout }).catch(err => {
            throw err?.response?.body || err;
        });
        let body = response.body;
        try { body = JSON.parse(body); } catch {}
        return body;
    }
};

// ======================== 一言服务（独立模块） ========================
class HitokotoService {
    static async fetch() {
        const url = 'https://v1.hitokoto.cn/';
        const body = await httpClient.get(url);
        return `${body.hitokoto}    ----${body.from}`;
    }
}

// ======================== 推送器基类 / 接口 ========================
class BaseNotifier {
    constructor(config) {
        this.config = config;
    }

    isEnabled() {
        return false;  // 子类重写
    }

    async notify(title, content, params = {}) {
        throw new Error('notify() must be implemented');
    }
}

// ---------------------- WxPusher 推送器 ----------------------
class WxPusherNotifier extends BaseNotifier {
    isEnabled() {
        return !!this.config.WX_pusher_appToken;
    }

    async notify(title, content, params = {}) {
        const { WX_pusher_appToken, WX_pusher_topicIds } = this.config;
        if (!this.isEnabled()) return;

        const payload = {
            appToken: WX_pusher_appToken,
            content: content,
            summary: title.substring(0, 90),
            contentType: 2,  // 1文字 2html 3markdown
            topicIds: [WX_pusher_topicIds],
        };

        try {
            const data = await httpClient.post('https://wxpusher.zjiecode.com/api/send/message', payload);
            if (data.code === 1000) {
                console.log('WxPusher 发送成功');
            } else {
                console.log('WxPusher 发送异常', data);
            }
        } catch (err) {
            console.log('WxPusher 发送失败', err);
        }
    }
}

// ---------------------- PushMe 推送器（支持多KEY）--------------------
class PushMeNotifier extends BaseNotifier {
    isEnabled() {
        return !!this.config.PUSHME_KEY;
    }

    async notify(title, content, params = {}) {
        const { PUSHME_KEY, PUSHME_URL } = this.config;
        if (!this.isEnabled()) return;

        const keys = PUSHME_KEY.split('#').filter(k => k.trim());
        const url = PUSHME_URL || 'https://push.i-i.me';

        for (const key of keys) {
            const payload = {
                push_key: key.trim(),
                title: title,
                content: content,
                type: "markdown",
                ...params
            };
            try {
                const data = await httpClient.post(url, payload);
                if (data === 'success') {
                    console.log(`PushMe (${key}) 发送成功`);
                } else {
                    console.log(`PushMe (${key}) 发送异常: ${data}`);
                }
            } catch (err) {
                console.log(`PushMe (${key}) 发送失败`, err);
            }
        }
    }
}

// ---------------------- PushPlus 推送器 ----------------------
class PushPlusNotifier extends BaseNotifier {
    isEnabled() {
        return !!this.config.PUSH_PLUS_TOKEN;
    }

    async notify(title, content, params = {}) {
        const { PUSH_PLUS_TOKEN, PUSH_PLUS_USER } = this.config;
        if (!this.isEnabled()) return;

        // ✅ 修改点 1：使用 replaceAll 替代 replace（正则仍需 /g 标志）
        const htmlContent = content.replaceAll(/[\n\r]/g, '<br>');
        const payload = {
            token: PUSH_PLUS_TOKEN,
            title: title,
            content: htmlContent,
            topic: PUSH_PLUS_USER,
        };

        try {
            const data = await httpClient.post('https://www.pushplus.plus/send', payload);
            if (data.code === 200) {
                console.log(`PushPlus (${PUSH_PLUS_USER ? '一对多' : '一对一'}) 发送成功`);
            } else {
                console.log(`PushPlus 发送异常 ${data.msg}`);
            }
        } catch (err) {
            console.log('PushPlus 发送失败', err);
        }
    }
}

// ======================== 通知管理器（组装所有积木） ========================
class NotifyManager {
    constructor(config) {
        this.config = config;
        this.notifiers = [
            new WxPusherNotifier(config),
            new PushMeNotifier(config),
            new PushPlusNotifier(config),
        ];
    }

    async send(title, content, params = {}) {
        // ✅ 修改点 2：使用可选链简化判空逻辑
        const skipTitle = process.env.SKIP_PUSH_TITLE;
        if (skipTitle?.split('\n').includes(title)) {
            console.info(`${title} 在 SKIP_PUSH_TITLE 中，跳过推送`);
            return;
        }

        let finalContent = content;
        if (this.config.HITOKOTO !== 'false') {
            const hitokoto = await HitokotoService.fetch();
            finalContent += '\n\n' + hitokoto;
        }

        const tasks = this.notifiers
            .filter(notifier => notifier.isEnabled())
            .map(notifier => notifier.notify(title, finalContent, params));

        await Promise.all(tasks);
    }
}

// 创建全局单例
const manager = new NotifyManager(push_config);

// ======================== 导出兼容原接口 ========================
async function sendNotify(text, desp, params = {}) {
    return manager.send(text, desp, params);
}

function wxPusherNotify(text, desp) {
    return new WxPusherNotifier(push_config).notify(text, desp);
}

function pushMeNotify(text, desp, params = {}) {
    return new PushMeNotifier(push_config).notify(text, desp, params);
}

function pushPlusNotify(text, desp) {
    return new PushPlusNotifier(push_config).notify(text, desp);
}

module.exports = {
    sendNotify,
    wxPusherNotify,
    pushMeNotify,
    pushPlusNotify,
};
//********用户配置区域开始*****************************************
// 版本号：精简版 - 仅保留 WxPusher、PushMe、PushPlus

const got = require('got');
const timeout = 15000;

const push_config = {
    HITOKOTO: 'false', // 启用一言（随机句子）

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

// 通用请求工具
const $ = {
    post: (params, callback) => {
        const { url, ...others } = params;
        got.post(url, others).then(
            (res) => {
                let body = res.body;
                try {
                    body = JSON.parse(body);
                } catch (error) { }
                callback(null, res, body);
            },
            (err) => {
                callback(err?.response?.body || err);
            },
        );
    },
    get: (params, callback) => {
        const { url, ...others } = params;
        got.get(url, others).then(
            (res) => {
                let body = res.body;
                try {
                    body = JSON.parse(body);
                } catch (error) { }
                callback(null, res, body);
            },
            (err) => {
                callback(err?.response?.body || err);
            },
        );
    },
    logErr: console.log,
};

// 获取随机一言
async function one() {
    const url = 'https://v1.hitokoto.cn/';
    const res = await got.get(url);
    const body = JSON.parse(res.body);
    return `${body.hitokoto}    ----${body.from}`;
}

// WxPusher 推送
function wxPusherNotify(text, desp) {
    return new Promise((resolve) => {
        const { WX_pusher_appToken, WX_pusher_topicIds } = push_config;

        const options = {
            url: `https://wxpusher.zjiecode.com/api/send/message`,
            json: {
                appToken: WX_pusher_appToken,
                content: desp,
                summary: text.substring(0, 90),
                contentType: 2, // 1文字 2html 3markdown
                topicIds: [WX_pusher_topicIds],
            },
            headers: {
                'Content-Type': 'application/json',
            },
            timeout,
        };

        if (WX_pusher_appToken) {
            $.post(options, (err, resp, data) => {
                try {
                    if (err) {
                        console.log('WxPusher发送通知消息失败😞\n', err);
                    } else {
                        if (data.code === 1000) {
                            console.log('WxPusher发送通知消息成功🎉。\n');
                        } else {
                            console.log(`WxPusher发送通知消息异常\n`);
                            console.log(data);
                        }
                    }
                } catch (e) {
                    $.logErr(e, resp);
                } finally {
                    resolve(data);
                }
            });
        } else {
            resolve();
        }
    });
}

// PushMe 推送
function pushMeNotify(text, desp, params = {}) {
    return new Promise((resolve) => {
        const { PUSHME_KEY, PUSHME_URL } = push_config;

        if (!PUSHME_KEY) {
            return resolve();
        }

        const pushKeys = PUSHME_KEY.split('#').filter(key => key.trim());
        if (pushKeys.length === 0) {
            return resolve();
        }

        const pushPromises = pushKeys.map(pushKey => {
            const trimmedKey = pushKey.trim();
            const options = {
                url: PUSHME_URL || 'https://push.i-i.me',
                json: {
                    push_key: trimmedKey,
                    title: text,
                    content: desp,
                    type: "markdown",
                    ...params
                },
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout,
            };

            return new Promise((innerResolve) => {
                $.post(options, (err, resp, data) => {
                    try {
                        if (err) {
                            console.log(`PushMe 发送通知到 KEY ${trimmedKey} 失败😞\n`, err);
                        } else {
                            if (data === 'success') {
                                console.log(`PushMe 发送通知到 KEY ${trimmedKey} 成功🎉\n`);
                            } else {
                                console.log(`PushMe 发送通知到 KEY ${trimmedKey} 异常: ${data}\n`);
                            }
                        }
                    } catch (e) {
                        $.logErr(e, resp);
                    } finally {
                        innerResolve(data);
                    }
                });
            });
        });

        Promise.all(pushPromises).then(resolve);
    });
}

// PushPlus 推送
function pushPlusNotify(text, desp) {
    return new Promise((resolve) => {
        const { PUSH_PLUS_TOKEN, PUSH_PLUS_USER } = push_config;
        if (PUSH_PLUS_TOKEN) {
            desp = desp.replace(/[\n\r]/g, '<br>'); // 默认为html格式
            const body = {
                token: `${PUSH_PLUS_TOKEN}`,
                title: `${text}`,
                content: `${desp}`,
                topic: `${PUSH_PLUS_USER}`,
            };
            const options = {
                url: `https://www.pushplus.plus/send`,
                body: JSON.stringify(body),
                headers: {
                    'Content-Type': ' application/json',
                },
                timeout,
            };
            $.post(options, (err, resp, data) => {
                try {
                    if (err) {
                        console.log(
                            `Push+ 发送${PUSH_PLUS_USER ? '一对多' : '一对一'}通知消息失败😞\n`,
                            err,
                        );
                    } else {
                        if (data.code === 200) {
                            console.log(
                                `Push+ 发送${PUSH_PLUS_USER ? '一对多' : '一对一'}通知消息完成🎉\n`,
                            );
                        } else {
                            console.log(
                                `Push+ 发送${PUSH_PLUS_USER ? '一对多' : '一对一'}通知消息异常 ${data.msg}\n`,
                            );
                        }
                    }
                } catch (e) {
                    $.logErr(e, resp);
                } finally {
                    resolve(data);
                }
            });
        } else {
            resolve();
        }
    });
}

/**
 * sendNotify 推送通知功能
 * @param text 通知头
 * @param desp 通知体
 * @param params 某些推送通知方式点击弹窗可跳转, 例：{ url: 'https://abc.com' }
 * @returns {Promise<unknown>}
 */
async function sendNotify(text, desp, params = {}) {
    // 根据标题跳过一些消息推送，环境变量：SKIP_PUSH_TITLE 用回车分隔
    let skipTitle = process.env.SKIP_PUSH_TITLE;
    if (skipTitle) {
        if (skipTitle.split('\n').includes(text)) {
            console.info(text + '在 SKIP_PUSH_TITLE 环境变量内，跳过推送');
            return;
        }
    }

    if (push_config.HITOKOTO !== 'false') {
        desp += '\n\n' + (await one());
    }

    await Promise.all([
        pushPlusNotify(text, desp),
        wxPusherNotify(text, desp),
        pushMeNotify(text, desp, params),
    ]);
}

module.exports = {
    sendNotify,
    wxPusherNotify,
    pushMeNotify,
    pushPlusNotify,
};
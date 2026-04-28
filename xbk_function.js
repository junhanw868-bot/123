//********用户配置区域开始*****************************************
// 版本号：2.0
// ... 版本说明保持不变 ...
const notify = require('./xbk_sendNotify');
const fs = require('fs');
const got = require('got');
const path = require('path');

function daysComputed(time) {
    // 【类型安全】预防非字符串导致崩溃，非法输入直接返回0
    if (typeof time !== 'string' || !time) return 0;
    var oldTimeFormat = new Date(time.replace(/-/g, '/'));
    var nowDate = new Date();
    if (nowDate.getTime() - oldTimeFormat.getTime() > 0) {
        var times = nowDate.getTime() - oldTimeFormat.getTime();
        var days = parseInt(times / (60 * 60 * 24 * 1000));
        return days;
    } else {
        return 0;
    }
}

function listfilter(group, pingbifenlei, pingbilouzhu, zhanxianlouzhu, pingbilouzhuplus, pingbibiaoti, zhanxianbiaoti, pingbibiaotiplus, pingbineirong, zhanxianneirong, pingbineirongplus, pingbitime) {
    // 【状态变量声明】保持原有
    var j, pingbitimearr, xiaopingbitimearr, zhanxianlouzhuarr, xiaozhanxianlouzhuarr,
        pingbilouzhuarr, xiaopingbilouzhuarr, pingbilouzhuplusarr, xiaopingbilouzhuplusarr,
        zhanxianbiaotiarr, xiaozhanxianbiaotiarr, pingbibiaotiarr, xiaopingbibiaotiarr,
        pingbibiaotiplusarr, xiaopingbibiaotiplusarr, zhanxianneirongarr, xiaozhanxianneirongarr,
        pingbineirongarr, xiaopingbineirongarr, pingbineirongplusarr, xiaopingbineirongplusarr,
        louzhubaoliu, biaotibaoliu, neirongbaoliu,
        louzhupingbi, louzhupingbiplus, biaotipingbi, biaotipingbiplus,
        neirongpingbi, neirongpingbiplus;

    // 【结构优化】统一提取字段，同时完成类型收敛（非字符串或假值 → null）
    var catStr = (typeof group.catename === 'string' && group.catename) ? group.catename : null;
    var louzhuStr = (typeof group.louzhu === 'string' && group.louzhu) ? group.louzhu : null;
    var titleStr = (typeof group.title === 'string' && group.title) ? group.title : null;
    var contentStr = (typeof group.content === 'string' && group.content) ? group.content : null;
    // 时间字段单独保留原样，仅在需要时进行类型判断

    // ------ 1. 时间屏蔽（优先级最高）------
    if (pingbitime && group.louzhuregtime) {
        if (typeof group.louzhuregtime !== 'string') {
            // 非字符串无法计算天数，不做屏蔽（原逻辑会崩溃，现安全降级）
        } else if (pingbitime.match(/###/)) {
            pingbitimearr = pingbitime.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < pingbitimearr.length; j++) {
                xiaopingbitimearr = pingbitimearr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaopingbitimearr[0], "i")) &&
                    !isNaN(Number(xiaopingbitimearr[1])) && Number(xiaopingbitimearr[1]) > daysComputed(group.louzhuregtime)) {
                    return false;
                }
            }
        } else {
            if (!isNaN(Number(pingbitime)) && Number(pingbitime) > daysComputed(group.louzhuregtime)) {
                return false;
            }
        }
    }

    // ------ 2. 分类屏蔽 ------
    if (pingbifenlei && catStr) {
        if (catStr.match(new RegExp(pingbifenlei, "i"))) {
            return false;
        }
    }

    // ------ 3. 楼主（louzhu）规则 ------
    // 3.1 楼主强制展现
    if (zhanxianlouzhu && louzhuStr) {
        if (zhanxianlouzhu.match(/###/)) {
            zhanxianlouzhuarr = zhanxianlouzhu.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < zhanxianlouzhuarr.length; j++) {
                xiaozhanxianlouzhuarr = zhanxianlouzhuarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaozhanxianlouzhuarr[0], "i")) &&
                    louzhuStr.match(new RegExp(xiaozhanxianlouzhuarr[1], "i"))) {
                    louzhubaoliu = 1;
                }
            }
        } else {
            if (louzhuStr.match(new RegExp(zhanxianlouzhu, "i"))) {
                louzhubaoliu = 1;
            }
        }
    }

    // 3.2 楼主屏蔽
    if (pingbilouzhu && louzhuStr && louzhubaoliu != 1) {
        if (pingbilouzhu.match(/###/)) {
            pingbilouzhuarr = pingbilouzhu.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < pingbilouzhuarr.length; j++) {
                xiaopingbilouzhuarr = pingbilouzhuarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaopingbilouzhuarr[0], "i")) &&
                    louzhuStr.match(new RegExp(xiaopingbilouzhuarr[1], "i"))) {
                    louzhupingbi = 1;
                }
            }
        } else {
            if (louzhuStr.match(new RegExp(pingbilouzhu, "i"))) {
                louzhupingbi = 1;
            }
        }
    }

    // 3.3 楼主加强屏蔽
    if (pingbilouzhuplus && louzhuStr && louzhupingbi != 1) {
        if (pingbilouzhuplus.match(/###/)) {
            pingbilouzhuplusarr = pingbilouzhuplus.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < pingbilouzhuplusarr.length; j++) {
                xiaopingbilouzhuplusarr = pingbilouzhuplusarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaopingbilouzhuplusarr[0], "i")) &&
                    louzhuStr.match(new RegExp(xiaopingbilouzhuplusarr[1], "i"))) {
                    louzhupingbiplus = 1;
                    louzhubaoliu = 0;
                }
            }
        } else {
            if (louzhuStr.match(new RegExp(pingbilouzhuplus, "i"))) {
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
            for (j = 0; j < zhanxianbiaotiarr.length; j++) {
                xiaozhanxianbiaotiarr = zhanxianbiaotiarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaozhanxianbiaotiarr[0], "i")) &&
                    titleStr.match(new RegExp(xiaozhanxianbiaotiarr[1], "i"))) {
                    biaotibaoliu = 1;
                }
            }
        } else {
            if (titleStr.match(new RegExp(zhanxianbiaoti, "i"))) {
                biaotibaoliu = 1;
            }
        }
    }

    // 4.2 标题屏蔽
    if (pingbibiaoti && titleStr && louzhubaoliu != 1 && biaotibaoliu != 1) {
        if (pingbibiaoti.match(/###/)) {
            pingbibiaotiarr = pingbibiaoti.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < pingbibiaotiarr.length; j++) {
                xiaopingbibiaotiarr = pingbibiaotiarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaopingbibiaotiarr[0], "i")) &&
                    titleStr.match(new RegExp(xiaopingbibiaotiarr[1], "i"))) {
                    biaotipingbi = 1;
                }
            }
        } else {
            if (titleStr.match(new RegExp(pingbibiaoti, "i"))) {
                biaotipingbi = 1;
            }
        }
    }

    // 4.3 标题加强屏蔽
    if (pingbibiaotiplus && titleStr && louzhubaoliu != 1 && biaotipingbi != 1) {
        if (pingbibiaotiplus.match(/###/)) {
            pingbibiaotiplusarr = pingbibiaotiplus.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < pingbibiaotiplusarr.length; j++) {
                xiaopingbibiaotiplusarr = pingbibiaotiplusarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaopingbibiaotiplusarr[0], "i")) &&
                    titleStr.match(new RegExp(xiaopingbibiaotiplusarr[1], "i"))) {
                    biaotipingbiplus = 1;
                    biaotibaoliu = 0;
                }
            }
        } else {
            if (titleStr.match(new RegExp(pingbibiaotiplus, "i"))) {
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
            for (j = 0; j < zhanxianneirongarr.length; j++) {
                xiaozhanxianneirongarr = zhanxianneirongarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaozhanxianneirongarr[0], "i")) &&
                    contentStr.match(new RegExp(xiaozhanxianneirongarr[1], "i"))) {
                    neirongbaoliu = 1;
                }
            }
        } else {
            if (contentStr.match(new RegExp(zhanxianneirong, "i"))) {
                neirongbaoliu = 1;
            }
        }
    }

    // 5.2 内容屏蔽
    if (pingbineirong && contentStr && louzhubaoliu != 1 && biaotibaoliu != 1 && neirongbaoliu != 1) {
        if (pingbineirong.match(/###/)) {
            pingbineirongarr = pingbineirong.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < pingbineirongarr.length; j++) {
                xiaopingbineirongarr = pingbineirongarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaopingbineirongarr[0], "i")) &&
                    contentStr.match(new RegExp(xiaopingbineirongarr[1], "i"))) {
                    neirongpingbi = 1;
                }
            }
        } else {
            if (contentStr.match(new RegExp(pingbineirong, "i"))) {
                neirongpingbi = 1;
            }
        }
    }

    // 5.3 内容加强屏蔽
    if (pingbineirongplus && contentStr && louzhubaoliu != 1 && biaotibaoliu != 1 && neirongpingbi != 1) {
        if (pingbineirongplus.match(/###/)) {
            pingbineirongplusarr = pingbineirongplus.split(/<br>|\n\n|\r\n/);
            for (j = 0; j < pingbineirongplusarr.length; j++) {
                xiaopingbineirongplusarr = pingbineirongplusarr[j].split("###");
                if (catStr && catStr.match(new RegExp(xiaopingbineirongplusarr[0], "i")) &&
                    contentStr.match(new RegExp(xiaopingbineirongplusarr[1], "i"))) {
                    neirongpingbiplus = 1;
                    neirongbaoliu = 0;
                }
            }
        } else {
            if (contentStr.match(new RegExp(pingbineirongplus, "i"))) {
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
    let content_html = `${shuju.content_html}<br>&nbsp;<br>&nbsp;<br>原文链接：<a href="${shuju.url}" target="_blank">${shuju.url}</a><br>&nbsp;<br>&nbsp;<br>`;
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
            text = text.replace(new RegExp(key, 'g'), value);
        } else {
            text = text.replace(new RegExp(key, 'g'), '');
        }
    }
    return text;
}

function htmlToMarkdown(shuju) {
    let html = shuju.content_html ? shuju.content_html : '';
    html = html.replace(/<h([1-6])>(.*?)<\/h\1>/gi, function(match, level, content) {
        return '#'.repeat(level) + ' ' + content + '\n\n';
    });
    html = html.replace(/<a\s+href="(.*?)".*?>(.*?)<\/a>/gi, '[$2]($1)');
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
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

function getFilePath(filename) { return path.join(DATA_DIR, filename); }

function ensureFileExists(filePath) {
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '[]', 'utf8');
    }
}

function fixJsonFile(filePath) {
    ensureFileExists(filePath);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        JSON.parse(content || '[]');
    } catch (error) {
        console.error(`JSON解析错误，重置文件${filePath}:`, error.message);
        fs.writeFileSync(filePath, '[]', 'utf8');
    }
}

function readMessages(filePath) {
    fixJsonFile(filePath);
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data || '[]');
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

function appendMessageToFile(message, filename) {
    const filePath = getFilePath(filename);
    ensureFileExists(filePath);
    const messages = readMessages(filePath);
    const existingIndex = messages.findIndex(m => m.id === message.id);
    if (existingIndex >= 0) {
        messages[existingIndex] = { ...message, timestamp: new Date().toISOString() };
    } else {
        messages.push({ ...message, timestamp: new Date().toISOString() });
    }
    if (messages.length > 100) {
        messages.splice(0, messages.length - 100);
    }
    fs.writeFileSync(filePath, stringifySafe(messages), 'utf8');
}

function getFileName(url) {
    const parts = url.split('/');
    let filename = parts[parts.length - 1];
    if (!filename.endsWith('.json')) {
        filename += '.json';
    }
    return filename;
}

//****以上代码不懂代码请勿修改*****用户还需要拉到底部修改最后的推送设置**************
//****以上代码不懂代码请勿修改*****用户还需要拉到底部修改最后的推送设置**************

//定义推送的线报酷域名
const domin = 'http://new.ixbk.net';
const newUrl = domin + '/plus/json/push.json';

//分类屏蔽
const pingbifenlei = '狗组|爱猫生活|爱猫澡盆|蛋肉|果蔬|服饰|美妆|母婴|健康|数码|娱乐|运动|宠物|更多|拼多多|外卖团购|其他活动|整点';

//全局标题屏蔽
const pingbibiaoti = `\\d+[度°]|(?:中国)?农业(?:银行)?|农行|农银|交通(?:银行)?|交行|交银|招商(?:银行)?|招行|招银|浦发(?:银行)?|浦银|中信(?:银行)?|信银|光大(?:银行)?|光银|华夏(?:银行)?|华银|民生(?:银行)?|民银|广发(?:银行)?|广银|兴业(?:银行)?|兴银|平安(?:银行)?|平银|浙商(?:银行)?|浙银|渤海(?:银行)?|渤银|恒丰(?:银行)?|恒银|中国银行|中行|汇丰(?:银行)?|汇银|交.{0,3}行|浦发|麻辣王子|辣条|麻辣零食|藤桥牌|鸭舌|卤味|得力|妮维雅|扒鸡|橡皮擦|麦丽素|五谷奈儿|糕点|曼可顿|源之香|乌苏|啤酒|塔斯汀|凉拖鞋|老陈皮|电解质|鸡精|粉丝汤|冈本|水磨年糕|燕窝玉耳|有机银耳|豆瓣酱
  |睫毛膏|(?:贴片|涂抹|泥|睡眠|清洁|补水|修护|美白|油敷)?面膜|眼膜|唇膜|化妆品|护肤品|洁面(?:奶|乳|啫喱|慕斯)?|洁颜(?:蜜|油)|卸妆(?:油|水|膏|乳|巾|棉)|眼唇卸妆液|(?:爽肤|柔肤|化妆|精粹|精华|收敛|醒肤|保湿)水|纯露|(?:修护|美白|抗老|补水|眼部|次抛)?精华(?:液|乳)?|肌底液|安瓶|原液|冻干粉|乳液|(?:保湿|修护|日|晚|素颜|润肤|颈|护手|面)霜|身体乳|身体精华|身体磨砂膏|去角质|啫喱|眼霜|眼胶|润唇膏|唇(?:油|部精华)|防晒(?:霜|乳|喷雾|啫喱)?|隔离(?:霜|乳)|妆前乳|粉底(?:液|膏)?|气垫|BB霜|CC霜|遮瑕(?:膏|液|笔)?|粉饼|(?:散|定妆|蜜)粉|定妆喷雾|高光|修容(?:盘)?|腮红(?:盘)?|眼影(?:盘)?|单色眼影|眼线(?:笔|液|胶笔)?|睫毛(?:膏|打底膏|胶|夹)?|假睫毛|眉(?:笔|粉|膏|胶)|染眉膏|卧蚕笔|提亮笔|口红|唇(?:釉|泥|霜|彩|线笔|部打底)|美甲(?:贴|灯)?|甲油胶|指甲油|卸甲水|底胶|封层|美瞳|隐形眼镜(?:护理液)?|化妆棉|美妆蛋|(?:气垫|散粉)?粉扑|湿敷棉|洗脸巾|棉柔巾|(?:眼影|粉底|腮红|修容|眉|唇)刷|化妆刷|化妆包|化妆镜|(?:修|刮)眉刀|(?:粉扑|刷具)清洁剂|(?:美容|洁面|导入|射频|脱毛)仪|化妆台|梳妆台|香水|香氛|香体露|止汗露|脱毛(?:膏|慕斯|喷雾)?|发(?:胶|蜡|泥|膜)|定型喷雾|护发精油|假发(?:片)?
  |孕妇|产妇|孕妈|宝妈|待产包|产妇卫生巾|产褥垫|月子(?:服|鞋|帽)|孕妇(?:装|裤|内衣|内裤)|托腹带|(?:收|束)腹带|妊娠(?:油|纹霜)|哺乳(?:内衣|文胸)|吸乳器|集奶器|乳头(?:膏|霜)|储奶(?:袋|瓶)|防溢乳垫|哺乳枕|喂奶神器|啃馋你|爆爆蛋|卤蛋|富安娜|空调被|王小卤|凤爪|kd橙|奶茶代下|硅胶铲|八马茶业|正山小种|红茶|亚都|电风扇|台地扇|蔬果园|洁厕剂|良品铺子|红薯干|美的|落地扇|金纺|留香珠|电动头盔|摩托车头盔|滴露|消毒液|德芙|冰淇淋|海底捞|牛肉酱|水一方|鱿鱼条|好世多|意面|猫砂|桃酥|磨砂膏|衣飞扬|电视|绿之源|除醛|乳蛋白|新希望|杨掌柜|拉面|家得宝|蚕丝蛋白裤|拉拉裤|纸尿裤
  |新生儿|婴儿|宝宝|婴幼儿|幼儿|(?:婴儿|宝宝)(?:面霜|润肤乳|身体乳|油|沐浴露|洗衣液|洗衣皂|湿巾|云柔巾|棉柔巾|皂|洗手液)|抚触油|护臀膏|屁屁霜|宝宝洗发沐浴二合一|(?:婴儿|儿童|孕妇|水解|特殊配方)奶粉|(?:宽口|PPSU|硅胶)?奶瓶|奶嘴|(?:吸管|学饮|鸭嘴)杯|辅食(?:机|锅|碗|剪|工具)?|米粉|米糊|果泥|肉泥|磨牙棒|牙胶|安抚奶嘴|(?:温|暖)奶器|奶瓶消毒器|消毒柜|恒温水壶|调奶器|(?:电动|手动)?吸奶器|(?:一次性|可洗)?隔尿垫|纸尿裤|尿不湿|拉拉裤|成长裤|纸尿片|婴儿(?:连体衣|哈衣|爬服|和尚服|袜子|鞋)|围嘴|口水巾|饭兜|(?:罩|反穿)衣|(?:婴儿|宝宝)床|拼接床|摇篮床|婴儿(?:床垫|睡袋|定型枕|盖毯)|床围|防惊跳睡袋|(?:抱|包)被|襁褓|纱布浴巾|婴儿(?:推车|提篮|背带)|腰凳|婴儿生理盐水|海盐水|洗鼻器
  |少儿|小童|中童|大童|儿童|童装|儿童(?:内衣|内裤)|宝宝袜子|童鞋|学步鞋|儿童枕头|(?:儿童|汽车)安全座椅|遛娃神器|(?:妈咪|母婴|儿童)包|(?:儿童|益智|早教)玩具|大颗粒积木|儿童拼图|(?:拼装|拼插|变形)玩具|娃娃|芭比娃娃|(?:毛绒|戏水|沙滩|洗澡|过家家|仿真)玩具|公仔|玩偶|遥控玩具车|儿童机器人|泡泡机|儿童水枪|(?:扭扭|溜溜|三轮)车|儿童(?:平衡车|滑板车|滑步车|泳池|滑梯|帐篷|游戏屋|厨房玩具|手工DIY)|海洋球|波波池|秋千|攀爬架|医生玩具|超轻黏土|彩泥|橡皮泥|太空沙|雪花片|磁力片|磁力棒|(?:点读|早教|故事|学习)机|点读笔|儿童(?:手表|电话手表|画板|涂鸦板|水彩笔|文具|书包|文具盒|相机|乐器|电子琴|架子鼓)|蜡笔|油画棒|玩具相机|风筝|儿童(?:飞盘|跳绳)|陀螺|悠悠球|退热贴|婴儿(?:体温计|喂药器|吸鼻器|指甲剪|磨甲器|棉签|益生菌)|(?:额|耳)温枪|(?:护|肚)脐贴|驱蚊(?:贴|手环)|儿童口罩|儿童(?:牙膏|牙刷)|手口湿巾|抑菌皂|儿童雾化器|维生素D|鱼肝油|宝宝钙铁锌|月子中心|母婴店|亲子早教|托育|幼儿园|儿童乐园|游乐场|(?:母婴|婴儿|儿童|宝宝)用品|小学生
  |蛋糕|每日鲜语|收纳箱|鸡胸|翅根|琵琶|yjwd|洗衣液|棒棒糖|手帕纸|鸡粉|蒙牛|饼干|凉茶|沐浴露|奶粉|酸辣粉|保温杯|烧麦|垃圾袋|芝士片|花生|洗衣机清洁剂|云吞|饺子|馄饨|鸡蛋|鸭蛋|拖把|三只松鼠|暖贴|钥匙扣|斧头|雕牌|高露洁|洗衣凝珠|牛奶|闪购|数币|受邀|.*酒|前.*名|咖啡|维生素|斗鱼|电.{0,3}影票|(mei|美)(团|tuan)|大众点评|fa.{0,2}票|地区价|饿了么|外卖|迯賣|优酷|芒果|爱奇艺|百度|蜜雪冰城|霸王茶姬|喜茶|奈雪的茶|古茗|茶百道|沪上阿姨|一点点|茶颜悦色|益禾堂|书亦烧仙草|柠季|茉莉奶白|乐乐茶|茶理宜世|茉酸奶|老虎堂|悸动烧仙草|甜啦啦|阿水大茶|CoCo都可|厝内小眷村|伏小桃|百分茶|茶屿水果茶|兵立王|瑞幸(?:咖啡)?|星巴克|库迪(?:咖啡)?|Manner(?: Coffee)?|Stand|Seesaw|Tims(?:天好咖啡)?|皮爷咖啡|代数学家|挪瓦(?:咖啡)?|Nowwa|隅田川|永璞(?:咖啡)?|三顿半|雀巢(?:咖啡)?|麦斯威尔|连咖啡
  |卫生巾|姨妈巾|护垫|棉条|安睡裤|安心裤|夜安裤|一次性内裤|产褥垫|刀纸|产妇湿巾|私处护理液|私处凝胶|干货|水杨酸软膏|周大生|项链|驱蚊喷雾|蚊香液|爆炸盐|小龙虾|花露水|大希地|牛排|宠物冻干|兔肋排|蚊帐|南极人|墨镜|护发素|澳宝|小白熊|泡奶机|bixbi|犬冻干|宠物冻干|君乐宝|悦鲜活|鲜牛奶|好想你|阿胶糕|固元糕|Votesil|尿味克星|宠物除臭喷雾|第六感|避孕套|安全套|粒上皇|周黑鸭|卤味零食|妙可蓝多|芝士碎|威王|洁厕灵|84消毒液|小熊|塔扇|桌面风扇|黛芙语|走珠香体露|止汗香体|纯甄|利乐钻|风味酸奶|九道艾|老北京足贴|艾草足贴|米饼|米多奇|机灵麦片|坚果|沃隆|矿泉水|恒大|薯片|白象火鸡面|拉面
  |洗发水|牙膏|鼠标垫|鼠标|面包|毛巾|糖|圣农|方便面|香菜|乌江|海苔|鸭货|一次性|百洁布|鸭脖|狗粮|围裙|果冻|粽子|竹笋|三养|披萨|苏打水|养车|大豆被|凉感被|行李箱|好价吗|养生茶|农心|翠春园|豆浆粉|金蚝油|茶叶蛋|口香糖|洗衣机|简爱|湿厕纸|去骨凤爪|洁鲜生|塑料袋|保鲜袋|富光|水杯|吨吨杯|凉水壶|杜蕾斯|byt|避孕套|延时安全套|情趣用品|万达|碧根果|笑乐笑|鸭腿|九禧鹤|火锅鸡醋|蓝怡宝|洁厕宝|洁厕块|海尔|空调|牛凡匠|南峰|吸盘粘钩|无痕挂钩|上鲜|鸡米花|盐酥鸡|油炸小吃|小雨伞|杰士邦|冰激凌|瓜子|肉粽|风干|肋骨|益生菌|小米|思圆|除螨喷雾剂|折叠椅|骆驼
  |百草味|木瓜膏|洗衣服务|马克笔|果汁机|榨汁机|肉片|玉米|炒货|栗仁|摇头扇|垃圾桶|止痒花露水喷雾|冷链配送|布丁|湿巾|包浆豆腐|大窑|冰淇淋|湿巾|自热米饭|自热火锅|自热煲仔饭|夹子|棉签|创口贴|生抽|雪糕|笔|驱蚊液|矿砂|干拌面|高洁丝|三全|油泼辣子|核桃粉|芝麻粉|黑豆粉|酸奶|螺丝刀|东鹏特饮|功能饮料|能量饮料|鲸鱼洞洞鞋|南宋胡记|中式糕点|桃夭酥|汉世刘家|扫把|簸箕|帕特|帕特猫粮|生骨肉冻干|宠物猫粮|水卫士|除臭喷雾|鞋袜除臭|鲁王|列文虎克|香薰|浴室|立香园|橘红片|老管家|除湿盒|热水壶|伊利|特仑苏|纯奶
  |三粒福|夏威夷果|奶油坚果|扫地机器人|午餐肉|空气循环扇|矿石砂|牛角脆|煎饺|米线|破壁机|牙刷|烘蛋|洗牙|认养一头牛|花胶羹|林饱饱|早餐|cn|Kinder健达|卫龙|久光贴鸡肉卷|舒客|咖喱饭|热干面|床垫|好丽友|榴莲|野餐垫|桶面|无印良品|零食|鲜奶|餐盒|小天鹅|京鲜|泡菜|鲜花饼|星球杯|电饼铛|元气森林|气泡水|葵花籽|海带丝|筋头巴脑|露营|数字人民币|睡裤|苹果|林饱饱|豆沙羹|溜溜梅|工银e生活|罐头|电扇|有推荐的吗|马桶|屈臣氏|王老吉|立式落地风扇|椰子水|空气炸锅|海蓝之谜|木薯粉|桂圆干|洗手液|洁厕液|打印纸|记忆乳胶枕头|皮蛋|松花皮蛋|拌面|意大利面|啤酒|杏仁露|吸色片|麦香鸡块|密实袋|破壁机|枸杞原浆|法国进口|去核红枣|荞麦面条|泸州老窖|红枣豆奶|电解质水|适用iPhone|紫皮腰果|网易严选|精小珍|爱那多|快雪弥|鸡肉脆片|e生活|北冰洋|椰子水|净水器|小酥饼|泡澡桶|洞洞鞋|蒜蓉酱
  |吐司|全麦|牙线|鳗知道|鳗鱼|冻干|兔肉|肉饼|大蒜|苹果醋|爆米花|牛乳|小圆饼|雪花酥|闲聊|刺梨原浆|山楂球|希尔顿|网易云音乐|限苹果`;
//全部标题强制展现
const zhanxianbiaoti = `十月稻田|可口可乐`;
//全部标题强制屏蔽(强化)
const pingbibiaotiplus = '';

//全局内容屏蔽
const pingbineirong =`\\d+[度°]|(?:中国)?农业(?:银行)?|农行|农银|交通(?:银行)?|交行|交银|招商(?:银行)?|招行|招银|浦发(?:银行)?|浦银|中信(?:银行)?|信银|光大(?:银行)?|光银|华夏(?:银行)?|华银|民生(?:银行)?|民银|广发(?:银行)?|广银|兴业(?:银行)?|兴银|平安(?:银行)?|平银|浙商(?:银行)?|浙银|渤海(?:银行)?|渤银|恒丰(?:银行)?|恒银|中国银行|中行|汇丰(?:银行)?|汇银|交.{0,3}行|浦发|麻辣王子|辣条|麻辣零食|金纺|留香珠|电动头盔|摩托车头盔|滴露|消毒液|德芙|冰淇淋|海底捞|牛肉酱|水一方|鱿鱼条|好世多|意面|猫砂|桃酥|衣飞扬|电视|麦丽素|源之香|乳蛋白|新希望|拉面|塔斯汀|凉拖鞋|老陈皮|电解质|鸡精|粉丝汤|冈本|水磨年糕|燕窝玉耳|有机银耳|豆瓣酱
  |睫毛膏|(?:贴片|涂抹|泥|睡眠|清洁|补水|修护|美白|油敷)?面膜|眼膜|唇膜|化妆品|护肤品|洁面(?:奶|乳|啫喱|慕斯)?|洁颜(?:蜜|油)|卸妆(?:油|水|膏|乳|巾|棉)|眼唇卸妆液|(?:爽肤|柔肤|化妆|精粹|精华|收敛|醒肤|保湿)水|纯露|(?:修护|美白|抗老|补水|眼部|次抛)?精华(?:液|乳)?|肌底液|安瓶|原液|冻干粉|乳液|(?:保湿|修护|日|晚|素颜|润肤|颈|护手|面)霜|身体乳|身体精华|身体磨砂膏|去角质|啫喱|眼霜|眼胶|润唇膏|唇(?:油|部精华)|防晒(?:霜|乳|喷雾|啫喱)?|隔离(?:霜|乳)|妆前乳|粉底(?:液|膏)?|气垫|BB霜|CC霜|遮瑕(?:膏|液|笔)?|粉饼|(?:散|定妆|蜜)粉|定妆喷雾|高光|修容(?:盘)?|腮红(?:盘)?|眼影(?:盘)?|单色眼影|眼线(?:笔|液|胶笔)?|睫毛(?:膏|打底膏|胶|夹)?|假睫毛|眉(?:笔|粉|膏|胶)|染眉膏|卧蚕笔|提亮笔|口红|唇(?:釉|泥|霜|彩|线笔|部打底)|美甲(?:贴|灯)?|甲油胶|指甲油|卸甲水|底胶|封层|美瞳|隐形眼镜(?:护理液)?|化妆棉|美妆蛋|(?:气垫|散粉)?粉扑|湿敷棉|洗脸巾|棉柔巾|(?:眼影|粉底|腮红|修容|眉|唇)刷|化妆刷|化妆包|化妆镜|(?:修|刮)眉刀|(?:粉扑|刷具)清洁剂|(?:美容|洁面|导入|射频|脱毛)仪|化妆台|梳妆台|香水|香氛|香体露|止汗露|脱毛(?:膏|慕斯|喷雾)?|发(?:胶|蜡|泥|膜)|定型喷雾|护发精油|假发(?:片)?
  |孕妇|产妇|孕妈|宝妈|待产包|产妇卫生巾|产褥垫|月子(?:服|鞋|帽)|孕妇(?:装|裤|内衣|内裤)|托腹带|(?:收|束)腹带|妊娠(?:油|纹霜)|哺乳(?:内衣|文胸)|吸乳器|集奶器|乳头(?:膏|霜)|储奶(?:袋|瓶)|防溢乳垫|哺乳枕|喂奶神器|小白熊|泡奶机|啃馋你|爆爆蛋|卤蛋|富安娜|空调被|王小卤|凤爪|kd橙|奶茶代下|硅胶铲|八马茶业|正山小种|红茶|亚都|电风扇|台地扇|落地扇|蔬果园|洁厕剂|良品铺子|红薯干|美的|落地扇|纯甄|利乐钻|风味酸奶|九道艾|老北京足贴|艾草足贴|小熊|塔扇|桌面风扇|黛芙语|走珠香体露|止汗香体|小雨伞|杰士邦|风干|肋骨|益生菌|小米|思圆|除螨喷雾剂|磨砂膏|杨掌柜|拉面|家得宝|蚕丝蛋白裤|拉拉裤|纸尿裤
  |新生儿|婴儿|宝宝|婴幼儿|幼儿|(?:婴儿|宝宝)(?:面霜|润肤乳|身体乳|油|沐浴露|洗衣液|洗衣皂|湿巾|云柔巾|棉柔巾|皂|洗手液)|抚触油|护臀膏|屁屁霜|宝宝洗发沐浴二合一|(?:婴儿|儿童|孕妇|水解|特殊配方)奶粉|(?:宽口|PPSU|硅胶)?奶瓶|奶嘴|(?:吸管|学饮|鸭嘴)杯|辅食(?:机|锅|碗|剪|工具)?|米粉|米糊|果泥|肉泥|磨牙棒|牙胶|安抚奶嘴|(?:温|暖)奶器|奶瓶消毒器|消毒柜|恒温水壶|调奶器|(?:电动|手动)?吸奶器|(?:一次性|可洗)?隔尿垫|纸尿裤|尿不湿|拉拉裤|成长裤|纸尿片|婴儿(?:连体衣|哈衣|爬服|和尚服|袜子|鞋)|围嘴|口水巾|饭兜|(?:罩|反穿)衣|(?:婴儿|宝宝)床|拼接床|摇篮床|婴儿(?:床垫|睡袋|定型枕|盖毯)|床围|防惊跳睡袋|(?:抱|包)被|襁褓|纱布浴巾|婴儿(?:推车|提篮|背带)|腰凳|婴儿生理盐水|海盐水|洗鼻器
  |少儿|小童|中童|大童|儿童|童装|儿童(?:内衣|内裤)|宝宝袜子|童鞋|学步鞋|儿童枕头|(?:儿童|汽车)安全座椅|遛娃神器|(?:妈咪|母婴|儿童)包|(?:儿童|益智|早教)玩具|大颗粒积木|儿童拼图|(?:拼装|拼插|变形)玩具|娃娃|芭比娃娃|(?:毛绒|戏水|沙滩|洗澡|过家家|仿真)玩具|公仔|玩偶|遥控玩具车|儿童机器人|泡泡机|儿童水枪|(?:扭扭|溜溜|三轮)车|儿童(?:平衡车|滑板车|滑步车|泳池|滑梯|帐篷|游戏屋|厨房玩具|手工DIY)|海洋球|波波池|秋千|攀爬架|医生玩具|超轻黏土|彩泥|橡皮泥|太空沙|雪花片|磁力片|磁力棒|(?:点读|早教|故事|学习)机|点读笔|儿童(?:手表|电话手表|画板|涂鸦板|水彩笔|文具|书包|文具盒|相机|乐器|电子琴|架子鼓)|蜡笔|油画棒|玩具相机|风筝|儿童(?:飞盘|跳绳)|陀螺|悠悠球|退热贴|婴儿(?:体温计|喂药器|吸鼻器|指甲剪|磨甲器|棉签|益生菌)|(?:额|耳)温枪|(?:护|肚)脐贴|驱蚊(?:贴|手环)|儿童口罩|儿童(?:牙膏|牙刷)|手口湿巾|抑菌皂|儿童雾化器|维生素D|鱼肝油|宝宝钙铁锌|月子中心|母婴店|亲子早教|托育|幼儿园|儿童乐园|游乐场|(?:母婴|婴儿|儿童|宝宝)用品|小学生
  |蛋糕|每日鲜语|收纳箱|鸡胸|翅根|琵琶|yjwd|洗衣液|棒棒糖|手帕纸|鸡粉|蒙牛|饼干|凉茶|沐浴露|奶粉|酸辣粉|保温杯|烧麦|垃圾袋|芝士片|花生|洗衣机清洁剂|云吞|饺子|馄饨|鸡蛋|鸭蛋|拖把|三只松鼠|暖贴|钥匙扣|斧头|雕牌|高露洁|洗衣凝珠|牛奶|闪购|数币|受邀|.*酒|前.*名|咖啡|维生素|斗鱼|电.{0,3}影票|(mei|美)(团|tuan)|大众点评|fa.{0,2}票|地区价|饿了么|外卖|迯賣|优酷|芒果|爱奇艺|百度|蜜雪冰城|霸王茶姬|喜茶|奈雪的茶|古茗|茶百道|沪上阿姨|一点点|茶颜悦色|益禾堂|书亦烧仙草|柠季|茉莉奶白|乐乐茶|茶理宜世|茉酸奶|老虎堂|悸动烧仙草|甜啦啦|阿水大茶|CoCo都可|厝内小眷村|伏小桃|百分茶|茶屿水果茶|兵立王|瑞幸(?:咖啡)?|星巴克|库迪(?:咖啡)?|Manner(?: Coffee)?|Stand|Seesaw|Tims(?:天好咖啡)?|皮爷咖啡|代数学家|挪瓦(?:咖啡)?|Nowwa|隅田川|永璞(?:咖啡)?|三顿半|雀巢(?:咖啡)?|麦斯威尔|连咖啡
  |卫生巾|姨妈巾|护垫|棉条|安睡裤|安心裤|夜安裤|一次性内裤|产褥垫|刀纸|产妇湿巾|私处护理液|私处凝胶|干货|水杨酸软膏|周大生|项链|驱蚊喷雾|蚊香液|爆炸盐|小龙虾|花露水|大希地|牛排|宠物冻干|兔肋排|蚊帐|南极人|墨镜|护发素|澳宝|bixbi|犬冻干|宠物冻干|君乐宝|悦鲜活|鲜牛奶|好想你|阿胶糕|固元糕|Votesil|尿味克星|宠物除臭喷雾|第六感|避孕套|安全套|粒上皇|周黑鸭|卤味零食|妙可蓝多|芝士碎|威王|洁厕灵|84消毒液|牛凡匠|南峰|吸盘粘钩|无痕挂钩|列文虎克|香薰|浴室|上鲜|鸡米花|盐酥鸡|油炸小吃|得力|妮维雅|扒鸡|橡皮擦|米饼|米多奇|机灵麦片|坚果|沃隆|矿泉水|恒大|乌苏|啤酒|薯片|白象火鸡面
  |洗发水|牙膏|鼠标垫|鼠标|面包|毛巾|糖|圣农|方便面|香菜|乌江|海苔|鸭货|一次性|百洁布|鸭脖|狗粮|围裙|果冻|粽子|竹笋|三养|披萨|苏打水|养车|大豆被|凉感被|行李箱|好价吗|养生茶|农心|翠春园|豆浆粉|金蚝油|茶叶蛋|洗衣机|简爱|湿厕纸|口香糖|去骨凤爪|洁鲜生|塑料袋|保鲜袋|富光|水杯|吨吨杯|凉水壶|杜蕾斯|byt|避孕套|延时安全套|情趣用品|万达|碧根果|笑乐笑|鸭腿|九禧鹤|火锅鸡醋|蓝怡宝|洁厕宝|洁厕块|海尔|空调|帕特|帕特猫粮|生骨肉冻干|宠物猫粮|水卫士|除臭喷雾|鞋袜除臭|立香园|橘红片|老管家|除湿盒|瓜子|肉粽|热水壶|伊利|特仑苏|纯奶|折叠椅|骆驼|五谷奈儿
  |百草味|木瓜膏|洗衣服务|马克笔|果汁机|榨汁机|肉片|玉米|炒货|栗仁|摇头扇|垃圾桶|止痒花露水喷雾|冷链配送|布丁|包浆豆腐|大窑|冰淇淋|湿巾|自热米饭|自热火锅|自热煲仔饭|夹子|棉签|创口贴|生抽|雪糕|笔|驱蚊液|矿砂|干拌面|高洁丝|三全|油泼辣子|核桃粉|芝麻粉|黑豆粉|酸奶|螺丝刀|东鹏特饮|功能饮料|能量饮料|鲸鱼洞洞鞋|南宋胡记|中式糕点|桃夭酥|汉世刘家|扫把|簸箕|鲁王|藤桥牌|鸭舌|卤味|冰激凌|绿之源|除醛|糕点|曼可顿
  |三粒福|夏威夷果|奶油坚果|扫地机器人|午餐肉|空气循环扇|矿石砂|牛角脆|煎饺|米线|破壁机|牙刷|烘蛋|洗牙|认养一头牛|花胶羹|林饱饱|早餐|cn|Kinder健达|卫龙|久光贴鸡肉卷|舒客|咖喱饭|热干面|床垫|好丽友|榴莲|野餐垫|桶面|无印良品|零食|鲜奶|餐盒|小天鹅|京鲜|泡菜|鲜花饼|星球杯|电饼铛|元气森林|气泡水|葵花籽|海带丝|筋头巴脑|露营|数字人民币|睡裤|苹果|林饱饱|豆沙羹|溜溜梅|工银e生活|罐头|电扇|有推荐的吗|马桶|屈臣氏|王老吉|立式落地风扇|椰子水|空气炸锅|海蓝之谜|木薯粉|桂圆干|洗手液|洁厕液|打印纸|记忆乳胶枕头|皮蛋|松花皮蛋|拌面|意大利面|啤酒|杏仁露|吸色片|麦香鸡块|密实袋|破壁机|枸杞原浆|法国进口|去核红枣|荞麦面条|泸州老窖|红枣豆奶|电解质水|适用iPhone|紫皮腰果|网易严选|精小珍|爱那多|快雪弥|鸡肉脆片|e生活|北冰洋|椰子水|净水器|小酥饼|泡澡桶|洞洞鞋|蒜蓉酱
  |吐司|全麦|牙线|鳗知道|鳗鱼|冻干|兔肉|肉饼|大蒜|苹果醋|爆米花|牛乳|小圆饼|雪花酥|闲聊|刺梨原浆|山楂球|希尔顿|网易云音乐|限苹果`;
//全部内容强制展现
const zhanxianneirong = `十月稻田|可口可乐`;
//全部内容强制屏蔽(强化)
const pingbineirongplus = '';

//全部楼主屏蔽
const pingbilouzhu = '';
//全部楼主强制展现
const zhanxianlouzhu = '';
//全部楼主强制屏蔽(强化)
const pingbilouzhuplus = '';

//赚客吧/新赚吧楼主注册日期屏蔽
const pingbitime = "5";


console.debug('开始获取线报酷数据...');
got(newUrl, {
    timeout: 10000,
    retry: {
        limit: 2,
        methods: ['GET']
    }
})
.json()
.then((xbkdata) => {
    if (!xbkdata) {
        console.log("警告：服务器返回空数据");
        return;
    }
    let list = [];
    if (Array.isArray(xbkdata)) {
        list = xbkdata;
    } else if (xbkdata.data && Array.isArray(xbkdata.data)) {
        list = xbkdata.data;
    } else {
        console.log("数据格式异常，非列表");
        return;
    }

    let items = [];
    list.forEach(item => {
        if (!isMessageInFile(item, getFileName(newUrl))) {
            appendMessageToFile(item, getFileName(newUrl));
            if (listfilter(item, pingbifenlei, pingbilouzhu, zhanxianlouzhu, pingbilouzhuplus, pingbibiaoti, zhanxianbiaoti, pingbibiaotiplus, pingbineirong, zhanxianneirong, pingbineirongplus, pingbitime)) {
                items.push(item);
            }
        }
    });

    let hebingdata = "";
    items.forEach(item => {
        item.url = domin + item.url;
        let text = "{标题}{内容}";
        let desp = "{链接}";
        text = tuisong_replace(text, item);
        desp = tuisong_replace(desp, item);

        notify.wxPusherNotify(tuisong_replace("【{分类名}】{标题}", item), tuisong_replace("<h5>{标题}</h5><br>{Html内容}", item));

        console.log("-----------------------------");
        console.log("发现到新数据：" + item.title + "【" + item.catename + "】" + item.url);

        if (hebingdata) {
            hebingdata += "\n\n";
        }
        hebingdata += tuisong_replace("{标题}【{分类名}】{链接}", item);
    });

    console.log("\n\n\n\n*******************************************");
    console.debug(`获取到${list.length}条数据，筛选后的新数据${items.length}条，本次任务结束`);
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
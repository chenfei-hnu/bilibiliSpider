var fs = require('fs');
const puppeteer = require('puppeteer');
(async () => {
    let browser = await puppeteer.launch({});//初始化puppeteer的chrome浏览器
    function sleep (time = 0) {//定义睡眠函数，以等待页面资源加载
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                resolve();
            }, time);
        })
    }
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(20000);//页面及默认超时时间初始化
    async function startTask () {//业务执行函数
        const pageArr = [//需要抓取的视频列表
            'https://space.bilibili.com/39089748/video?tid=0&page=0&keyword=&order=pubdate',
        ];
        async function getVideoLinkList () {//获取列表中视频链接的异步方法
            let resultArr = [];
            let videoArr = $('#submit-video-list .cube-list .fakeDanmu-item');
            for (let i = 0; i < videoArr.length; i++) {
                let item = videoArr[i];
                resultVideo = {};
                let curItem = $(item);
                resultArr.push(`https:${curItem.find('.cover').attr('href')}`);
            }
            return resultArr;
        }
        let linkArr = [];//初始视频链接列表
        for (let listLink of pageArr) {//遍历初始视频列表获取相关视频链接
            try {
                console.log(`正在扫描视频列表 ${listLink}`);
                await page.goto(listLink);
                await sleep(500);
                await page.waitForSelector('#submit-video-list .fakeDanmu-item', { timeout: 10000 });
                let arr = await page.evaluate(getVideoLinkList);
                linkArr = linkArr.concat(arr);
            } catch (error) {
                console.log(`扫描视频列表报错 ${error}`);
                await sleep(3000);
                continue
            }
        }
        async function getVideoContent () {//获取视频的首页评论及相关用户链接
            let result = {};
            window.scrollTo({
                top: 1000
            });
            function sleep (time = 0) {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        resolve();
                    }, time);
                })
            }
            await sleep(2000);//等待页面资源加载
            let itemDom = $('.list-item');
            if (!itemDom.length) {
                await sleep(2000);
                itemDom = $('.list-item');
            }
            for (var i = 0; i < itemDom.length; i++) {
                let item = $(itemDom[i]);
                let link = `https:${item.find('.user-face a').attr('href')}`;
                let content = item.find('.text').text() + item.find('.text-con').text();
                if (result[link]) {
                    result[link].push(content);
                } else {
                    result[link] = [content];
                }
            }
            return result;
        }
        let finalResult = {};//用户链接及其对应的评论集合列表的映射表
        for (let videoItem of linkArr) {
            try {
                console.log(`正在扫描视频内容 ${videoItem}`);
                await page.goto(videoItem);
                await page.waitForSelector('.comment-list', { timeout: 10000 });
                let result = await page.evaluate(getVideoContent);
                console.log(result);
                for (let link in result) {
                    if (finalResult[link]) {
                        finalResult[link] = finalResult[link].concat(result[link]);
                    } else {
                        finalResult[link] = result[link];
                    }
                }
            } catch (error) {
                console.log(`扫描视频内容报错 ${error}`);
                await sleep(3000);
                continue
            }
        }
        let finalArr = [];
        let preUser = [];
        let goodComment = [];
        let exsitComment = [];
        for (let link in finalResult) {//过滤重复的评论及部分网站附加信息
            let linkContent = finalResult[link];
            finalArr.push({ link: link, text: linkContent });
            for (let item of linkContent) {
                let itemPre = item.slice(0, 100);
                if (item.length > 100 && !exsitComment.includes(itemPre)) {
                    goodComment.push(item.slice(0, item.indexOf('回复')));
                    exsitComment.push(itemPre);
                }
            }
        }
        for (let i = 0; i < 30; i++) {//取评论数量最多的前30个用户作为参考
            preUser.push(finalArr[i].link);
        }
        async function getLikedUser () {//获取用户关注的UP主
            let result = [];
            function sleep (time = 0) {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        resolve();
                    }, time);
                })
            }
            let page = 0;
            let likedDom = $('.list-item ');
            for (var i = 0; i < likedDom.length; i++) {
                let item = $(likedDom[i]);
                result.push(`https:${item.find('a').attr('href')}`);
            }
            page++;
            while (page < 5 && !$('.be-pager-next').hasClass('be-pager-disabled')) {
                $('.be-pager-next').click();
                await sleep(1000);
                likedDom = $('.list-item ');
                for (var i = 0; i < likedDom.length; i++) {
                    let item = $(likedDom[i]);
                    result.push({
                        link: `https:${item.find('a').attr('href')}`,
                        name: item.find('.fans-name').text(),
                    });
                }
                page++;
            }
            return result;
        }
        let allUser = {};
        for (let user of preUser) {
            user += '/fans/follow'
            try {
                console.log(`正在扫描用户关注列表 ${user}`);
                await page.goto(user);
                await page.waitForSelector('.relation-list', { timeout: 10000 });
                let result = await page.evaluate(getLikedUser);
                for (let user of result) {
                    if (allUser[user.link]) {
                        allUser[user.link].count = allUser[user.link].count + 1;
                    } else {
                        user.count = 1;
                        allUser[user.link] = user;
                    }
                }
            } catch (error) {
                console.log(`扫描用户关注列表报错 ${error}`);
                await sleep(3000);
                continue
            }
        }
        let userArr = [];
        for (let k in allUser) {//在这30个用户的所有关注的UP主中，取用两个或以上用户共同关注的
            if (allUser[k].count > 1) {
                userArr.push(allUser[k]);
            }
        }
        userArr.sort((a, b) => {
            return b.count - a.count;
        })
        let matchedUserArr = [];
        async function getMatched () {//判断该UP主是否包含于初始视频内容相关的部分关键字
            const keyWords = ['科技', '互联网', '创业', '商业', '人文', '社会', '财经'];//此类视频的关键词列表，最后过滤共同UP主时使用
            let hasKeyWords = [];
            function sleep (time = 0) {
                return new Promise((resolve, reject) => {
                    setTimeout(() => {
                        resolve();
                    }, time);
                })
            }
            while (!$) {
                await sleep(1000);
            }
            let allText = $('#app').text();
            for (let item of keyWords) {
                if (allText.contains(item)) {
                    hasKeyWords.push(item);
                }
            }
            return hasKeyWords;
        }
        for (let user of userArr) {
            try {
                console.log(`扫描UP主 ${user.link}`);
                await page.goto(user.link);
                await page.waitForSelector('#app', { timeout: 10000 });
                let result = await page.evaluate(getMatched);
                if (result.length) {
                    user.keyWords = result;
                    matchedUserArr.push(user);
                }
            } catch (error) {
                console.log(`扫描UP主错误 ${error}`);
                await sleep(3000);
                continue
            }
        }
        let customOutput = {
            updateTime: new Date().getTime(),
            goodComment: goodComment,
            likedUser: matchedUserArr,
            preUser: preUser,
        }
        fs.writeFile(`./test.js`, JSON.stringify(customOutput), function (error) {
            console.log('本地 test.js 生成成功');
        });
    }
    await startTask();
})();
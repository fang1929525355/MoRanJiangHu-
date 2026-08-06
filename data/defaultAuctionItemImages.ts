import type { 物品图片档案 } from '../models/imageGeneration';

const 默认拍卖物品图片映射: Record<string, string> = {
    青锋短剑: 'https://msjh.bacon159.pp.ua/assets/auction-items/qingfeng-duanjian.png',
    雁翎护腕: 'https://msjh.bacon159.pp.ua/assets/auction-items/yanling-huwan.png',
    回春散: 'https://msjh.bacon159.pp.ua/assets/auction-items/huichun-san.png',
    寒潭玄铁屑: 'https://msjh.bacon159.pp.ua/assets/auction-items/hantan-xuantiexie.png',
    '残页·归云步': 'https://msjh.bacon159.pp.ua/assets/auction-items/canye-guiyunbu.png',
    乌金软甲: 'https://msjh.bacon159.pp.ua/assets/auction-items/wujin-ruanjia.png',
    无名刀谱拓本: 'https://msjh.bacon159.pp.ua/assets/auction-items/wuming-daopu-taben.png',
    南荒毒砂: 'https://msjh.bacon159.pp.ua/assets/auction-items/nanhuang-dusha.png',
    白玉鱼佩: 'https://msjh.bacon159.pp.ua/assets/auction-items/baiyu-yupei.png',
    破军弩机: 'https://msjh.bacon159.pp.ua/assets/auction-items/pojun-nuji.png',
    药王谷旧丹方: 'https://msjh.bacon159.pp.ua/assets/auction-items/yaowanggu-jiudanfang.png',
    青玉飞剑: 'https://msjh.bacon159.pp.ua/assets/auction-items/qingyu-feijian.png',
    赤纹丹炉: 'https://msjh.bacon159.pp.ua/assets/auction-items/chiwen-danlu.png',
    下品灵石袋: 'https://msjh.bacon159.pp.ua/assets/auction-items/xiapin-lingshidai.png',
    雷击桃木: 'https://msjh.bacon159.pp.ua/assets/auction-items/leiji-taomu.png',
    清心符箓: 'https://msjh.bacon159.pp.ua/assets/auction-items/qingxin-fulu.png',
    筑基丹残瓶: 'https://msjh.bacon159.pp.ua/assets/auction-items/zhuji-dan-canping.png',
    碧水阵盘: 'https://msjh.bacon159.pp.ua/assets/auction-items/bishui-zhenpan.png',
    储物戒: 'https://msjh.bacon159.pp.ua/assets/auction-items/chuwu-jie.png',
    星砂一撮: 'https://msjh.bacon159.pp.ua/assets/auction-items/xingsha-yicuo.png',
    云纹法袍: 'https://msjh.bacon159.pp.ua/assets/auction-items/yunwen-fapao.png',
    火鸦羽: 'https://msjh.bacon159.pp.ua/assets/auction-items/huoya-yu.png'
};

export const 获取默认拍卖物品图片档案 = (itemName: string): 物品图片档案 | undefined => {
    const imageUrl = 默认拍卖物品图片映射[itemName];
    if (!imageUrl) return undefined;
    const id = `default_auction_${itemName}`;
    const record = {
        id,
        图片URL: imageUrl,
        生图词组: `默认拍卖行固定拍品写实图标（无文字）：${itemName}`,
        原始描述: itemName,
        使用模型: 'gpt-image-2',
        生成时间: 1778503458255,
        构图: '物品图标' as const,
        画风: '写实' as const,
        渲染风格: '写实道具' as const,
        尺寸: '1024x1024',
        状态: 'success' as const,
        来源: 'hosted' as const
    };
    return {
        最近生图结果: record,
        生图历史: [record],
        已选图标图片ID: id
    };
};

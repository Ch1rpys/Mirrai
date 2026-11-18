/**
 * Coarse topics, for spotting what they never talk about.
 *
 * A domain only becomes a knowledge boundary when they have spoken
 * thousands of lines and never once used these words, while the other
 * person has. The names are the pattern stored on the subtraction.
 */
import type { CopyKey } from "./copy";

export interface TopicDomain {
  id: string;
  /** Copy key for the domain's name, which becomes the suppression pattern. */
  nameKey: Extract<CopyKey, `labels.topicDomain.${string}`>;
  keywords: string[];
}

// i18n:allow-input — words in the records that name a topic they may not know
export const TOPIC_DOMAINS: TopicDomain[] = [
  {
    id: "coding",
    nameKey: "labels.topicDomain.coding",
    keywords: ["编程", "代码", "程序员", "编译", "报错", "接口", "前端", "后端", "数据库", "开源", "框架", "bug", "python", "javascript", "github"],
  },
  {
    id: "finance",
    nameKey: "labels.topicDomain.finance",
    keywords: ["股票", "基金", "理财", "炒股", "牛市", "熊市", "沪深", "债券", "期货", "仓位", "收益率", "A股", "stock", "fund", "nasdaq"],
  },
  {
    id: "medicine",
    nameKey: "labels.topicDomain.medicine",
    keywords: ["医院", "处方", "消炎", "手术", "复诊", "门诊", "过敏", "血压", "血糖", "疫苗", "病理", "CT", "diagnosis", "prescription", "symptom"],
  },
  {
    id: "law",
    nameKey: "labels.topicDomain.law",
    keywords: ["起诉", "律师", "合同", "违约", "开庭", "判决", "原告", "被告", "诉讼", "公证", "劳动法", "民事", "lawsuit", "attorney", "contract"],
  },
  {
    id: "cars",
    nameKey: "labels.topicDomain.cars",
    keywords: ["发动机", "变速箱", "油耗", "刹车片", "轮胎", "保养", "4S店", "新能源车", "混动", "公里数", "车险", "驾照", "sedan", "mileage", "horsepower"],
  },
  {
    id: "sports",
    nameKey: "labels.topicDomain.sports",
    keywords: ["比分", "联赛", "世界杯", "进球", "点球", "季后赛", "主场", "客场", "篮球", "足球", "奥运会", "锦标赛", "offside", "playoffs", "scoreboard"],
  },
  {
    id: "games",
    nameKey: "labels.topicDomain.games",
    keywords: ["开黑", "段位", "皮肤", "副本", "抽卡", "氪金", "主线", "装备", "打野", "补刀", "匹配", "steam", "esports", "respawn", "controller"],
  },
  {
    id: "papers",
    nameKey: "labels.topicDomain.papers",
    keywords: ["论文", "期刊", "引用", "答辩", "综述", "实验组", "对照组", "影响因子", "投稿", "审稿", "参考文献", "abstract", "citation", "doi", "preprint"],
  },
  {
    id: "politics",
    nameKey: "labels.topicDomain.politics",
    keywords: ["选举", "议会", "外交", "制裁", "法案", "执政党", "在野党", "宣言", "政局", "投票率", "内阁", "referendum", "senate", "policy", "campaign"],
  },
  {
    id: "cooking",
    nameKey: "labels.topicDomain.cooking",
    keywords: ["食谱", "焯水", "爆炒", "炖", "烤箱", "调味", "火候", "腌", "出锅", "高汤", "刀工", "recipe", "simmer", "seasoning", "skillet"],
  },
  {
    id: "photography",
    nameKey: "labels.topicDomain.photography",
    keywords: ["光圈", "快门", "焦距", "感光度", "单反", "微单", "镜头", "测光", "白平衡", "焦段", "三脚架", "iso", "aperture", "shutter", "bokeh"],
  },
  {
    id: "fitness",
    nameKey: "labels.topicDomain.fitness",
    keywords: ["卧推", "深蹲", "硬拉", "蛋白粉", "有氧", "力量训练", "组数", "配速", "热身", "拉伸", "增肌", "hiit", "deadlift", "cardio", "reps"],
  },
  {
    id: "pets",
    nameKey: "labels.topicDomain.pets",
    keywords: ["疫苗本", "绝育", "猫粮", "狗粮", "驱虫", "宠物医院", "猫砂", "牵引绳", "领养", "掉毛", "爪爪", "vet", "litter", "leash", "neuter"],
  },
  {
    id: "fandom",
    nameKey: "labels.topicDomain.fandom",
    keywords: ["应援", "内场", "周边", "粉丝", "代言", "官宣", "路透", "打投", "站姐", "专辑", "签售", "comeback", "fandom", "bias", "photocard"],
  },
  {
    id: "anime",
    nameKey: "labels.topicDomain.anime",
    keywords: ["番剧", "漫画", "漫展", "声优", "二次元", "追番", "剧场版", "手办", "同人", "设定集", "连载", "anime", "manga", "cosplay", "seiyuu"],
  },
  {
    id: "travel",
    nameKey: "labels.topicDomain.travel",
    keywords: ["行程", "签证", "过境", "值机", "行李额", "景点", "攻略", "民宿", "时差", "落地签", "转机", "itinerary", "boarding", "hostel", "layover"],
  },
  {
    id: "beauty",
    nameKey: "labels.topicDomain.beauty",
    keywords: ["口红", "粉底", "护肤", "精华", "防晒", "卸妆", "妆容", "染发", "美甲", "遮瑕", "妆前", "serum", "concealer", "moisturizer", "primer"],
  },
  {
    id: "home",
    nameKey: "labels.topicDomain.home",
    keywords: ["装修", "瓷砖", "乳胶漆", "橱柜", "水电改造", "全屋定制", "墙纸", "踢脚线", "吊顶", "设计师", "样板间", "drywall", "cabinetry", "renovation", "fixture"],
  },
  {
    id: "parenting",
    nameKey: "labels.topicDomain.parenting",
    keywords: ["辅食", "早教", "尿布", "疫苗本", "幼儿园", "夜奶", "生长曲线", "亲子", "绘本", "积木", "入园", "formula", "pacifier", "toddler", "stroller"],
  },
  {
    id: "housing",
    nameKey: "labels.topicDomain.housing",
    keywords: ["首付", "房贷", "学区", "中介", "挂牌", "过户", "公摊", "产权", "限购", "月供", "二手房", "mortgage", "downpayment", "listing", "escrow"],
  },
];

export function domainKeywordHit(text: string, keywords: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return keywords.some((keyword) => {
    if (/^[a-z0-9]/.test(keyword)) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(lower);
    }
    return text.includes(keyword);
  });
}

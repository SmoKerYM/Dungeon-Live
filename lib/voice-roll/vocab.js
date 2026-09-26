/**
 * 语音掷骰词表：属性 / 技能 / 别名 / ASR 错字 / 热词。
 *
 * 负责：为整个 voice-roll 功能提供**唯一**的词表数据源——规则匹配（intent.js）、
 *       调整值与标签（dice.js）、LLM 结果校验（llm.js）、ASR 热词（asr.js）全部读这里。
 * 不负责：任何判定逻辑（在 intent.js）、任何数值计算（在 dice.js）。
 *
 * 谁调用：lib/voice-roll/{intent,dice,llm,asr,index}.js，以及 scripts/test-voice-intent.js。
 * 依赖：无（纯数据，不 require 任何东西）。
 *
 * 注意：server.js 里另有一份 ATTR_CN / SKILL_CN（给角色卡 AI 总结用）。这里是本功能的
 * 单一数据源，两边各自独立，**不要**为了去重去改 server.js 里那份。
 */

/** 六项属性 key → 中文名 */
const ATTR_CN = {
  strength: '力量',
  dexterity: '敏捷',
  constitution: '体质',
  intelligence: '智力',
  wisdom: '感知',
  charisma: '魅力'
};

/** 十八项技能 key → 中文名 */
const SKILL_CN = {
  athletics: '运动', acrobatics: '体操', sleightOfHand: '巧手', stealth: '隐匿',
  arcana: '奥秘', history: '历史', investigation: '调查', nature: '自然',
  religion: '宗教', animalHandling: '驯兽', insight: '洞悉', medicine: '医药',
  perception: '察觉', survival: '求生', deception: '欺瞒', intimidation: '威吓',
  performance: '表演', persuasion: '游说'
};

/** 技能 key → 对应属性 key（与 game.html 的 skillAttributeMap 一致，服务端算调整值用） */
const SKILL_ATTR = {
  athletics: 'strength',
  acrobatics: 'dexterity',
  sleightOfHand: 'dexterity',
  stealth: 'dexterity',
  arcana: 'intelligence',
  history: 'intelligence',
  investigation: 'intelligence',
  nature: 'intelligence',
  religion: 'intelligence',
  animalHandling: 'wisdom',
  insight: 'wisdom',
  medicine: 'wisdom',
  perception: 'wisdom',
  survival: 'wisdom',
  deception: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
  persuasion: 'charisma'
};

const ATTR_KEYS = Object.keys(ATTR_CN);
const SKILL_KEYS = Object.keys(SKILL_CN);

/** 意图类型枚举 */
const INTENT_TYPES = ['ability', 'save', 'skill', 'initiative', 'deathSave'];
/** 优劣势枚举 */
const ADVANTAGE_TYPES = ['normal', 'advantage', 'disadvantage'];

/**
 * 属性别名（中文）。只放**无歧义**的说法。
 * 「身手」「反应」「耐力」这类模糊说法故意不放，交给 LLM 兜底（见 plan §6.1）。
 */
const ATTR_ALIAS_CN = {
  strength: ['力量', '力气', '蛮力'],
  dexterity: ['敏捷'],
  constitution: ['体质'],
  intelligence: ['智力'],
  wisdom: ['感知'],
  charisma: ['魅力']
};

/** 属性别名（拉丁字母），按单词边界匹配 */
const ATTR_ALIAS_EN = {
  strength: ['strength', 'str'],
  dexterity: ['dexterity', 'dex'],
  constitution: ['constitution', 'con'],
  intelligence: ['intelligence', 'int'],
  wisdom: ['wisdom', 'wis'],
  charisma: ['charisma', 'cha']
};

/**
 * 技能别名（中文）。同样只放无歧义的说法；
 * 「感知」「身手」这种会和属性打架的词不在这里，由 LLM 决定。
 */
const SKILL_ALIAS_CN = {
  athletics: ['运动'],
  acrobatics: ['体操', '特技', '杂技'],
  sleightOfHand: ['巧手', '妙手', '撬锁', '开锁'],
  stealth: ['隐匿', '潜行', '躲藏'],
  arcana: ['奥秘', '奥术', '神秘学'],
  history: ['历史'],
  investigation: ['调查', '搜查'],
  nature: ['自然'],
  religion: ['宗教'],
  animalHandling: ['驯兽', '驯养'],
  insight: ['洞悉', '洞察'],
  medicine: ['医药', '医疗', '急救'],
  perception: ['察觉', '觉察', '侦察'],
  survival: ['求生'],
  // 「撒谎」「欺骗」是有歧义的：说谎的是自己才是欺瞒，看别人是不是在说谎其实是洞悉，
  // 按 plan §6.1 这类说法不进规则表，交给 LLM 判
  deception: ['欺瞒'],
  intimidation: ['威吓', '恐吓'],
  performance: ['表演'],
  persuasion: ['游说', '说服', '劝说']
};

/** 技能别名（拉丁字母），按单词边界匹配；空格在预处理里会被归一成单个空格 */
const SKILL_ALIAS_EN = {
  athletics: ['athletics'],
  acrobatics: ['acrobatics'],
  sleightOfHand: ['sleight of hand', 'sleightofhand'],
  stealth: ['stealth'],
  arcana: ['arcana'],
  history: ['history'],
  investigation: ['investigation'],
  nature: ['nature'],
  religion: ['religion'],
  animalHandling: ['animal handling', 'animalhandling'],
  insight: ['insight'],
  medicine: ['medicine'],
  perception: ['perception'],
  survival: ['survival'],
  deception: ['deception'],
  intimidation: ['intimidation'],
  performance: ['performance'],
  persuasion: ['persuasion']
};

/**
 * ASR 常见同音错字 → 正字。预处理阶段整词替换。
 * 只替换这些明确的**词**组合，绝不做单字替换（见 plan §6.5）。
 */
const ASR_TYPOS = [
  ['活免', '豁免'], ['获免', '豁免'], ['祸免', '豁免'],
  ['列式', '劣势'], ['裂势', '劣势'], ['略势', '劣势'],
  ['幽势', '优势'],
  ['奥米', '奥秘'], ['奥密', '奥秘'],
  ['巧受', '巧手'], ['敲手', '巧手'],
  ['洞西', '洞悉'], ['动悉', '洞悉'],
  ['茶觉', '察觉'], ['查觉', '察觉'],
  ['引逆', '隐匿'], ['隐逆', '隐匿'],
  ['七瞒', '欺瞒'], ['欺满', '欺瞒'],
  ['威赫', '威吓'], ['微吓', '威吓'],
  ['游税', '游说'],
  ['先功', '先攻'], ['鲜攻', '先攻']
];

/** 「豁免」及其错字（错字已在预处理替换，这里留着兜底） */
const SAVE_WORDS_CN = ['豁免', '活免', '获免', '祸免'];
/** 「豁免」的英文说法（按单词边界匹配） */
const SAVE_WORDS_EN = ['saving throw', 'save'];
/** 死亡豁免 */
const DEATH_SAVE_CN = ['死亡豁免'];
const DEATH_SAVE_EN = ['death save', 'death saving throw'];
/** 先攻 */
const INITIATIVE_CN = ['先攻'];
const INITIATIVE_EN = ['initiative'];
/** 属性检定的提示词：出现这些词时「感知」是属性而不是察觉技能 */
const CHECK_WORDS_CN = ['检定', '比拼', '较量', '对抗'];
const CHECK_WORDS_EN = ['check'];

/** 优势 / 劣势。注意 disadvantage 包含 advantage，匹配时必须先匹配长的 */
const DISADVANTAGE_CN = ['劣势', '取低', '双骰取低'];
const DISADVANTAGE_EN = ['disadvantage', 'disadv'];
const ADVANTAGE_CN = ['优势', '取高', '双骰取高'];
const ADVANTAGE_EN = ['advantage', 'adv'];

/**
 * 额外加减值的信号词。命中时规则层直接放弃，整句交给 LLM，
 * 免得规则把「再减二」这类玩家明说的修正值悄悄吃掉（见 plan §6.6）。
 */
const EXTRA_MOD_HINTS = ['额外', '再加', '再减', '多加', '多减', '加值', '减值'];

/** 属性检定标签的后缀（用户已拍板用「检定」，见 plan §12.1） */
const ABILITY_CHECK_WORD = '检定';

/**
 * ASR 热词 / 上下文提示串。「豁免」是硬规则的分界词，ASR 必须写对这两个字，
 * 所以这段提示对识别率影响很大（见 plan §8）。
 */
const ASR_CONTEXT_PROMPT =
  'D&D跑团掷骰。力量、敏捷、体质、智力、感知、魅力检定，力量比拼，豁免，优势，劣势，先攻，死亡豁免。' +
  '运动、体操、巧手、隐匿、奥秘、历史、调查、自然、宗教、驯兽、洞悉、医药、察觉、求生、欺瞒、威吓、表演、游说。' +
  'dex save, perception, advantage, d20。';

/** 只支持热词列表时用这个数组 */
const ASR_HOTWORDS = [
  ...ATTR_KEYS.map(k => ATTR_CN[k]),
  ...SKILL_KEYS.map(k => SKILL_CN[k]),
  '豁免', '优势', '劣势', '比拼', '较量', '检定', '先攻', '死亡豁免'
];

module.exports = {
  ATTR_CN, SKILL_CN, SKILL_ATTR, ATTR_KEYS, SKILL_KEYS,
  INTENT_TYPES, ADVANTAGE_TYPES,
  ATTR_ALIAS_CN, ATTR_ALIAS_EN, SKILL_ALIAS_CN, SKILL_ALIAS_EN,
  ASR_TYPOS,
  SAVE_WORDS_CN, SAVE_WORDS_EN, DEATH_SAVE_CN, DEATH_SAVE_EN,
  INITIATIVE_CN, INITIATIVE_EN, CHECK_WORDS_CN, CHECK_WORDS_EN,
  ADVANTAGE_CN, ADVANTAGE_EN, DISADVANTAGE_CN, DISADVANTAGE_EN,
  EXTRA_MOD_HINTS, ABILITY_CHECK_WORD,
  ASR_CONTEXT_PROMPT, ASR_HOTWORDS
};

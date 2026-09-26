/**
 * 语音掷骰纯函数层的验证脚本：跑 plan-voice-roll.md §10 的用例表。
 *
 * 负责：离线验证 parseRollIntent / computeRollModifier / buildRollLabel 三个纯函数。
 * 不负责：ASR、DeepSeek 兜底、socket 流程——这些要起服务器用 voice:text 事件测。
 *
 * 谁调用：人工执行 `node scripts/test-voice-intent.js`（不需要起服务器，也不读 data/）。
 * 依赖：lib/voice-roll/{intent,dice}.js。
 *
 * 角色卡用 §10 里的 V 和艾琳，外加两张命中投用的假卡（全部内联在本文件，
 * 不读 data/，保证脚本随时可跑；假卡也不要写进 data/characters.json）。
 */

const { parseRollIntent } = require('../lib/voice-roll/intent');
const {
  computeRollModifier, buildRollLabel, buildModifierParts, formatModifierBreakdown,
  buildDamagePlan, buildDamageOutcome
} = require('../lib/voice-roll/dice');

// §10 的测试角色：PB=2，熟练豁免 智力/敏捷，熟练技能 隐匿/巧手/医药/察觉
const CARD_V = {
  name: 'V',
  proficiencyBonus: 2,
  attributes: { strength: -1, dexterity: 3, constitution: 2, intelligence: 1, wisdom: 3, charisma: -1 },
  savingThrows: ['intelligence', 'dexterity'],
  skills: ['stealth', 'sleightOfHand', 'medicine', 'perception']
};

// 命中投「取高」对照组的假卡（故意不写进 data/characters.json，脚本要能随时离线跑）：
// 力量 +3 > 敏捷 +1，没提武器时应当取力量
const CARD_STRONG = {
  name: '力量流假卡',
  proficiencyBonus: 2,
  attributes: { strength: 3, dexterity: 1, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 },
  savingThrows: [],
  skills: []
};

// 力量 = 敏捷 = +2：相等时按敏捷记
const CARD_TIE = {
  name: '力敏相等假卡',
  proficiencyBonus: 2,
  attributes: { strength: 2, dexterity: 2, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 },
  savingThrows: [],
  skills: []
};

// 符具的熟练只给禾易苇（按名字判），伤害取智/感/魅最高的那项 → 感知 +3
const CARD_HEYIWEI = {
  name: '禾易苇',
  proficiencyBonus: 2,
  attributes: { strength: -1, dexterity: 2, constitution: -1, intelligence: 2, wisdom: 3, charisma: 1 },
  savingThrows: [],
  skills: []
};

// 对照组：验证「属性检定」和「同属性的熟练技能」真的区分开了
const CARD_AILIN = {
  name: '艾琳',
  proficiencyBonus: 2,
  attributes: { strength: -1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 1, charisma: 1 },
  savingThrows: [],
  skills: ['athletics']
};

/**
 * 一条用例。
 * expect 为 'llm' 表示规则层应当放弃（返回 null，交给 DeepSeek）；
 * expect 为 'error' 表示规则层应当明确报错（例如只说了「豁免」）。
 */
const CASES = [
  // 输入文本, 期望 type, 期望 key, 期望 advantage, 期望调整值, 期望 label
  ['进行力量比拼',          'ability', 'strength',     'normal',       -1, '力量检定'],
  ['敏捷较量',              'ability', 'dexterity',    'normal',        3, '敏捷检定'],
  ['过魅力豁免',            'save',    'charisma',     'normal',       -1, '魅力豁免'],
  ['敏捷豁免检定',          'save',    'dexterity',    'normal',        5, '敏捷豁免'],
  ['带优势的力量豁免检定',  'save',    'strength',     'advantage',    -1, '带优势的力量豁免'],
  ['智力豁免',              'save',    'intelligence', 'normal',        3, '智力豁免'],
  ['体质活免',              'save',    'constitution', 'normal',        2, '体质豁免'],
  ['带劣势的敏捷检定',      'ability', 'dexterity',    'disadvantage',  3, '带劣势的敏捷检定'],
  ['帮我投个带优势的隐匿',  'skill',   'stealth',      'advantage',     5, '带优势的隐匿检定'],
  ['调查一下',              'skill',   'investigation', 'normal',       1, '调查检定'],
  ['奥米一下',              'skill',   'arcana',       'normal',        1, '奥秘检定'],
  ['我来巧手撬个锁',        'skill',   'sleightOfHand', 'normal',       5, '巧手检定'],
  ['察觉',                  'skill',   'perception',   'normal',        5, '察觉检定'],
  ['洞悉',                  'skill',   'insight',      'normal',        3, '洞悉检定'],
  ['dex save with advantage', 'save',  'dexterity',    'advantage',     5, '带优势的敏捷豁免'],
  ['投个先攻',              'initiative', null,        'normal',        3, '先攻'],
  ['死亡豁免',              'deathSave',  null,        'normal',        0, '死亡豁免'],
  ['带优势带劣势的隐匿',    'skill',   'stealth',      'normal',        5, '隐匿检定'],
  ['豁免',                  'error'],
  ['感知一下周围',          'llm'],
  ['看看他是不是在撒谎',    'llm'],   // 「撒谎」是欺瞒的别名，但这句问的是识破 → 见下方说明
  ['我偷偷跟上去',          'llm'],
  ['敏捷检定，DM 说再减二', 'llm'],
  // 命中投（V：力量 -1 / 敏捷 +3 / PB 2）。熟练按武器决定，玩家可口头覆盖
  ['命中投',                'attack', 'finesse', 'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  ['加熟练项的命中投',      'attack', 'finesse', 'normal',        5, '命中投（敏捷 +3，熟练 +2）'],
  ['命中投加数联想',        'attack', 'finesse', 'normal',        5, '命中投（敏捷 +3，熟练 +2）'],
  // 「熟练加值」含「加值」，不能被 EXTRA_MOD_HINTS 误判成额外加减值踢给 LLM
  ['命中投，熟练加值',      'attack', 'finesse', 'normal',        5, '命中投（敏捷 +3，熟练 +2）'],
  ['带优势的命中投',        'attack', 'finesse', 'advantage',     3, '带优势的命中投（敏捷 +3，未加熟练）'],
  ['命中头',                'attack', 'finesse', 'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  ['用剔骨刀的命中投',      'attack', 'finesse', 'normal',        5, '命中投（敏捷 +3，熟练 +2）'],
  ['用刀的命中投，不加熟练', 'attack', 'finesse', 'normal',       3, '命中投（敏捷 +3，未加熟练）'],
  // 「一刀」是量词不是武器，不能因此判成用刀并自动加熟练
  ['命中投，砍他一刀',      'attack', 'finesse', 'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  ['近战命中投',            'attack', 'finesse', 'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  ['用球棒的命中投',        'attack', 'melee',   'normal',        1, '命中投（力量 -1，熟练 +2）'],
  ['徒手的命中投',          'attack', 'melee',   'normal',        1, '命中投（力量 -1，熟练 +2）'],
  ['用斧头的命中投',        'attack', 'melee',   'normal',       -1, '命中投（力量 -1，未加熟练）'],
  ['开枪的攻击检定',        'attack', 'ranged',  'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  // 枪要分手枪 / 步枪（伤害 2d10 vs 2d12），熟练只有艾琳有，V 一律不加
  ['用手枪的命中投',        'attack', 'ranged',  'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  ['举步枪射他的命中投',    'attack', 'ranged',  'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  ['用飞刀的命中投',        'attack', 'finesse', 'normal',        5, '命中投（敏捷 +3，熟练 +2）'],
  ['用短剑的命中投',        'attack', 'finesse', 'normal',        3, '命中投（敏捷 +3，未加熟练）'],
  // 符具走智/感/魅取高（V 的感知 +3 最高），熟练只有禾易苇有
  ['甩张黄符的命中投',      'attack', 'mental',  'normal',        3, '命中投（感知 +3，未加熟练）'],
  ['开枪的命中投加熟练',    'attack', 'ranged',  'normal',        5, '命中投（敏捷 +3，熟练 +2）'],
  ['attack roll with proficiency',  'attack', 'finesse', 'normal', 5, '命中投（敏捷 +3，熟练 +2）'],
  ['attack roll with disadvantage', 'attack', 'finesse', 'disadvantage', 3, '带劣势的命中投（敏捷 +3，未加熟练）'],
  // 「加熟练」只对命中投生效，其他检定类型一律忽略
  ['魅力豁免，加熟练',      'save',   'charisma', 'normal',      -1, '魅力豁免'],
  ['投个伤害',              'error'],   // 单独要伤害骰仍然不支持
  ['攻击伤害',              'error'],   // 没有攻击触发词（「攻击」不在触发词表里）
  // 有触发词时「伤害」二字不再拦路：伤害骰本来就跟在命中投后面
  ['攻击检定，顺便算伤害',  'attack', 'finesse', 'normal', 3, '命中投（敏捷 +3，未加熟练）'],
  // 只描述动作、没有触发词的交给 LLM
  ['我砍他一刀',            'llm'],
  ['我拿匕首捅他',          'llm'],
  ['一拳打过去',            'llm'],
  ['抄起椅子砸他',          'llm'],
  ['我开枪打他',            'llm'],
  ['用球棒砸他',            'llm']
];

// 对照组用例：艾琳的「力量比拼」= -1，「运动检定」= -1 + 2 = +1
const CONTROL_CASES = [
  ['力量比拼', 'ability', 'strength',  'normal', -1, '力量检定'],
  ['运动检定', 'skill',   'athletics', 'normal',  1, '运动检定']
];

let pass = 0;
let fail = 0;

function check(ok, line) {
  if (ok) { pass++; console.log('  ✓ ' + line); }
  else    { fail++; console.log('  ✗ ' + line); }
}

function runCase(card, [text, expType, expKey, expAdv, expMod, expLabel]) {
  const got = parseRollIntent(text);

  if (expType === 'llm') {
    return check(got === null, `「${text}」→ 规则放弃，交给 LLM（实际 ${JSON.stringify(got)}）`);
  }
  if (expType === 'error') {
    return check(!!(got && got.error), `「${text}」→ 规则报错（实际 ${JSON.stringify(got)}）`);
  }
  if (!got || got.error) {
    return check(false, `「${text}」→ 期望 ${expType}/${expKey}，实际 ${JSON.stringify(got)}`);
  }

  const mod = computeRollModifier(card, got);
  const label = buildRollLabel(got, card);
  const ok = got.type === expType && got.key === expKey && got.advantage === expAdv &&
             mod === expMod && label === expLabel;
  const sign = mod >= 0 ? '+' + mod : String(mod);
  check(ok, `「${text}」→ ${got.type}/${got.key}/${got.advantage} ${sign} 「${label}」` +
            (ok ? '' : `（期望 ${expType}/${expKey}/${expAdv} ${expMod >= 0 ? '+' + expMod : expMod} 「${expLabel}」）`));
}

console.log('【V 的角色卡】');
CASES.forEach(c => runCase(CARD_V, c));
console.log('\n【对照组：艾琳（力量 -1，熟练运动）】');
CONTROL_CASES.forEach(c => runCase(CARD_AILIN, c));

// 命中投取高的分支：V 和现有角色卡全是敏捷 ≥ 力量，只能靠假卡验证
console.log('\n【对照组：力量流假卡（力量 +3 > 敏捷 +1，PB 2）】');
[
  ['命中投',         'attack', 'finesse', 'normal', 3, '命中投（力量 +3，未加熟练）'],
  ['用刀的命中投',   'attack', 'finesse', 'normal', 5, '命中投（力量 +3，熟练 +2）'],
  ['开枪',           'llm'],                                                    // 没有触发词 → LLM
  ['远程命中投',     'attack', 'ranged',  'normal', 1, '命中投（敏捷 +1，未加熟练）'],
  ['用球棒的命中投', 'attack', 'melee',   'normal', 5, '命中投（力量 +3，熟练 +2）']
].forEach(c => runCase(CARD_STRONG, c));

console.log('\n【对照组：力敏相等假卡（力量 = 敏捷 = +2）】');
[
  ['命中投', 'attack', 'finesse', 'normal', 2, '命中投（敏捷 +2，未加熟练）']   // 相等时记为敏捷
].forEach(c => runCase(CARD_TIE, c));

// 可观测性：卡片明细行必须逐字对得上 plan §10 的表（假设骰出 15）
console.log('\n【可观测性：命中投明细行（V，骰出 15）】');
[
  ['命中投',                  '15 + 3 敏捷（未提武器·力敏取高）+ 未加熟练（未提武器·默认不加）= 18'],
  ['加熟练项的命中投',        '15 + 3 敏捷（未提武器·力敏取高）+ 2 熟练（明说加熟练）= 20'],
  // 剔骨刀单成一类（伤害要给 V 加 +6），所以理由里写的是「剔骨刀」不是「刀类」
  ['用剔骨刀的命中投',        '15 + 3 敏捷（剔骨刀·力敏取高）+ 2 熟练（剔骨刀·默认熟练）= 20'],
  ['用刀的命中投，不加熟练',  '15 + 3 敏捷（刀类·力敏取高）+ 未加熟练（明说不加熟练）= 18'],
  ['用球棒的命中投',          '15 − 1 力量（棍棒类·近战用力量）+ 2 熟练（棍棒类·默认熟练）= 16'],
  ['开枪的命中投加熟练',      '15 + 3 敏捷（远程武器·用敏捷）+ 2 熟练（明说加熟练）= 20']
].forEach(([text, expected]) => {
  const intent = parseRollIntent(text);
  const parts = intent && !intent.error ? buildModifierParts(CARD_V, intent) : null;
  const line = parts
    ? formatModifierBreakdown('15', parts, 15 + computeRollModifier(CARD_V, intent))
    : '（没有明细项）';
  check(line === expected, `「${text}」→ ${line}` + (line === expected ? '' : `\n      期望 ${expected}`));
});

// 「抄起椅子砸他」走 LLM，这里直接用等价意图验证临时武器的理由文案
console.log('\n【可观测性：临时武器（LLM 路径的意图）】');
[[{ type: 'attack', key: 'melee', weaponClass: 'improvised', proficiencyOverride: null,
    advantage: 'normal', extraModifier: 0 },
   '15 − 1 力量（临时武器·近战用力量）+ 未加熟练（临时武器·默认不加）= 14']
].forEach(([intent, expected]) => {
  const parts = buildModifierParts(CARD_V, intent);
  const line = formatModifierBreakdown('15', parts, 15 + computeRollModifier(CARD_V, intent));
  check(line === expected, `抄起椅子砸他 → ${line}` + (line === expected ? '' : `\n      期望 ${expected}`));
});

// ===== 伤害骰 =====
// 掷骰本身用 crypto，没法对结果断言；这里验的是**投什么**（几颗几面、加哪项调整值、理由怎么写）
console.log('\n【伤害骰：投什么】');
[
  // 角色卡, 文本, 勾超自然, 期望 label, 期望 expr
  [CARD_V,       '用剔骨刀的命中投', false, '刀具伤害',            '2d8+9'],   // 3 敏捷 + 6 剔骨刀
  [CARD_AILIN,   '用剔骨刀的命中投', false, '刀具伤害',            '2d8+1'],   // 别人拿没有 +6（这张假卡敏捷 +1）
  [CARD_V,       '用刀的命中投',     false, '刀具伤害',            '2d8+3'],
  [CARD_V,       '用短剑的命中投',   false, '刀具伤害',            '2d8+3'],
  [CARD_V,       '用飞刀的命中投',   false, '业余器具伤害',        '2d4+3'],
  [CARD_V,       '徒手的命中投',     false, '业余器具伤害',        '2d4+3'],
  [CARD_V,       '抄起椅子的命中投', false, '业余器具伤害',        '2d4+3'],
  [CARD_V,       '用球棒的命中投',   false, '钝器伤害',            '2d6+3'],
  [CARD_V,       '用斧头的命中投',   false, '钝器伤害',            '2d6+3'],
  [CARD_V,       '用手枪的命中投',   false, '手枪伤害',            '2d10'],    // 手枪不加调整值
  [CARD_V,       '举步枪射他的命中投', false, '步枪伤害',          '2d12+3'],
  [CARD_HEYIWEI, '甩张黄符的命中投', false, '符具伤害（魔法）',     '2d6+3'],   // 智2/感3/魅1 → 感知
  [CARD_HEYIWEI, '甩张黄符的命中投', true,  '符具伤害（魔法·对抗超自然）', '4d6+3']
].forEach(([card, text, supernatural, expLabel, expExpr]) => {
  const intent = parseRollIntent(text);
  const plan = intent && !intent.error ? buildDamagePlan(card, intent, { supernatural }) : null;
  const got = plan && plan.available ? `${plan.label} ${plan.expr}` : `（没投：${plan ? plan.note : '不是命中投'}）`;
  check(got === `${expLabel} ${expExpr}`,
        `${card.name}「${text}」${supernatural ? '·超自然' : ''} → ${got}` +
        (got === `${expLabel} ${expExpr}` ? '' : `\n      期望 ${expLabel} ${expExpr}`));
});

// 判不出武器时**不猜**：命中投照投，伤害那行写清缺了什么（用户 2026-09-26 拍板）
console.log('\n【伤害骰：判不出武器就不投】');
[
  ['命中投',           '没听出用的什么武器，伤害没投'],
  ['我砍他一刀的命中投', '没听出用的什么武器，伤害没投'],   // 「一刀」是量词
  ['开枪的命中投',      '没听出是手枪还是步枪，伤害没投']
].forEach(([text, expected]) => {
  const intent = parseRollIntent(text);
  const plan = buildDamagePlan(CARD_V, intent, {});
  const got = plan && !plan.available ? plan.note : `（投了：${plan && plan.expr}）`;
  check(got === expected, `「${text}」→ ${got}` + (got === expected ? '' : `\n      期望 ${expected}`));
});

// 熟练按角色：枪只有艾琳、符只有禾易苇
console.log('\n【伤害骰：按角色给的熟练（只影响命中投的 PB）】');
[
  [CARD_AILIN,   '用手枪的命中投',   '命中投（敏捷 +1，熟练 +2）'],
  [CARD_V,       '用手枪的命中投',   '命中投（敏捷 +3，未加熟练）'],
  [CARD_HEYIWEI, '甩张黄符的命中投', '命中投（感知 +3，熟练 +2）'],
  [CARD_V,       '甩张黄符的命中投', '命中投（感知 +3，未加熟练）'],
  // 口头覆盖仍然优先于「按角色给」的默认值
  [CARD_V,       '用手枪的命中投，加熟练', '命中投（敏捷 +3，熟练 +2）'],
  [CARD_AILIN,   '用手枪的命中投，不加熟练', '命中投（敏捷 +1，未加熟练）']
].forEach(([card, text, expected]) => {
  const intent = parseRollIntent(text);
  const label = intent && !intent.error ? buildRollLabel(intent, card) : '（判不出）';
  check(label === expected, `${card.name}「${text}」→ ${label}` +
        (label === expected ? '' : `\n      期望 ${expected}`));
});

// 大成功翻倍骰子数、大失败不投（用户 2026-09-26 拍板）
console.log('\n【伤害骰：大成功 / 大失败】');
{
  const intent = parseRollIntent('用刀的命中投');
  const crit = buildDamageOutcome(CARD_V, intent, { kept: 20 });
  check(crit.rolled && crit.count === 4 && crit.sides === 8 && crit.crit === true,
        `大成功 → ${crit.expr}（${crit.rolls.length} 颗）` );
  check(crit.rolls.length === 4 && crit.rolls.every(r => r >= 1 && r <= 8),
        `大成功的骰值都在 1~8：${crit.rolls.join(',')}`);
  check(crit.total === crit.rolls.reduce((a, b) => a + b, 0) + 3,
        `大成功的合计 = 骰子和 + 3 敏捷：${crit.total}`);

  const fumble = buildDamageOutcome(CARD_V, intent, { kept: 1 });
  check(fumble.rolled === false && fumble.note === '大失败·未命中',
        `大失败 → ${fumble.note}`);

  const plain = buildDamageOutcome(CARD_V, intent, { kept: 12 });
  check(plain.rolled && plain.count === 2 && !plain.crit, `普通命中 → ${plain.expr}`);

  // 非命中投（技能、豁免）不该有伤害
  check(buildDamageOutcome(CARD_V, parseRollIntent('帮我投个隐匿'), { kept: 12 }) === null,
        '技能检定没有伤害骰');
}

// 伤害明细行：和命中投同一套排版，逐项写出理由
console.log('\n【可观测性：伤害明细行（假设两颗骰子是 5 和 6）】');
[
  [CARD_V,       '用剔骨刀的命中投', false,
   '5 + 6 + 3 敏捷（刀具·力敏取高）+ 6 剔骨刀（V 专属）= 20'],
  [CARD_V,       '用手枪的命中投',   false, '5 + 6 = 11'],
  [CARD_HEYIWEI, '甩张黄符的命中投', true,
   '5 + 6 + 3 感知（符具·智感魅取高）= 14']
].forEach(([card, text, supernatural, expected]) => {
  const plan = buildDamagePlan(card, parseRollIntent(text), { supernatural });
  const line = formatModifierBreakdown('5 + 6', plan.parts, 11 + plan.modifier);
  check(line === expected, `${card.name}「${text}」→ ${line}` +
        (line === expected ? '' : `\n      期望 ${expected}`));
});

console.log(`\n通过 ${pass} / ${pass + fail}`);

// 用例表也导出去，方便把同一份期望值灌进聊天框的 @ai 文字通道做端到端比对
// （两条通道共用服务端同一条链路，期望值也该是同一份）
module.exports = { CASES, CONTROL_CASES, CARD_V, CARD_AILIN, CARD_STRONG, CARD_TIE, CARD_HEYIWEI };

// 被 require 时不能把宿主进程一起退掉
if (require.main === module) process.exit(fail === 0 ? 0 : 1);

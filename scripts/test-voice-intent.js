/**
 * 语音掷骰纯函数层的验证脚本：跑 plan-voice-roll.md §10 的用例表。
 *
 * 负责：离线验证 parseRollIntent / computeRollModifier / buildRollLabel 三个纯函数。
 * 不负责：ASR、DeepSeek 兜底、socket 流程——这些要起服务器用 voice:text 事件测。
 *
 * 谁调用：人工执行 `node scripts/test-voice-intent.js`（不需要起服务器，也不读 data/）。
 * 依赖：lib/voice-roll/{intent,dice}.js。
 *
 * 角色卡用 §10 里的 V 和艾琳（内联在本文件，不读 data/，保证脚本随时可跑）。
 */

const { parseRollIntent } = require('../lib/voice-roll/intent');
const { computeRollModifier, buildRollLabel } = require('../lib/voice-roll/dice');

// §10 的测试角色：PB=2，熟练豁免 智力/敏捷，熟练技能 隐匿/巧手/医药/察觉
const CARD_V = {
  name: 'V',
  proficiencyBonus: 2,
  attributes: { strength: -1, dexterity: 3, constitution: 2, intelligence: 1, wisdom: 3, charisma: -1 },
  savingThrows: ['intelligence', 'dexterity'],
  skills: ['stealth', 'sleightOfHand', 'medicine', 'perception']
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
  ['我砍他一刀',            'llm']
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
  const label = buildRollLabel(got);
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

console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);

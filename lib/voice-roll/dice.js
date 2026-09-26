/**
 * 语音掷骰的数值层：调整值、标签、表达式、掷骰。
 *
 * 负责：按角色卡和意图确定性地算出调整值（computeRollModifier）、生成中文标签
 *       （buildRollLabel）与表达式（buildRollExpr），并用 crypto 掷 d20（rollD20）。
 * 不负责：识别意图（intent.js / llm.js）、读角色卡文件（由 index.js 通过 deps 注入）、
 *         广播（index.js）。
 *
 * 谁调用：lib/voice-roll/index.js 在 voice:intent 预览和 voice:confirm 落定时各调一次；
 *         scripts/test-voice-intent.js 用它跑用例表。
 * 依赖：node:crypto、./vocab.js。
 *
 * 数值口径（plan-voice-roll.md §3.2）：角色卡 attributes 里存的**已经是调整值**，
 * 不要再做 (score-10)/2。
 */

const crypto = require('crypto');
const V = require('./vocab');

/**
 * 在几项属性里取角色卡上调整值最高的那一项。
 * candidates 的顺序就是**并列时的优先顺序**（力敏并列记敏捷，三选一并列记智力）。
 *
 * @param {object} card 角色卡
 * @param {string[]} candidates 属性 key，按并列时的优先顺序排列
 * @returns {string} 属性 key
 */
function pickHighestAbility(card, candidates) {
  const attrs = (card && card.attributes) || {};
  let best = candidates[0];
  for (const key of candidates) {
    if ((Number(attrs[key]) || 0) > (Number(attrs[best]) || 0)) best = key;
  }
  return best;
}

/**
 * 命中投实际用哪一项属性。
 * melee（棍棒斧锤拳）→ 力量；ranged（枪）→ 敏捷；
 * finesse（刀匕首，以及**没提武器**的情况）→ 力量和敏捷中较高的，相等时记为敏捷；
 * mental（符具）→ 智力/感知/魅力中较高的，相等时按 智力 → 感知 → 魅力 取第一个。
 * 纯函数：调整值和 label 都调它，别各算一遍，否则两边可能对不上。
 *
 * @param {object} card 角色卡
 * @param {'melee'|'ranged'|'finesse'|'mental'} mode 武器模式（intent.key）
 * @returns {string} 属性 key
 */
function resolveAttackAbility(card, mode) {
  if (mode === 'melee') return 'strength';
  if (mode === 'ranged') return 'dexterity';
  if (mode === 'mental') return pickHighestAbility(card, ['intelligence', 'wisdom', 'charisma']);
  return pickHighestAbility(card, ['dexterity', 'strength']);   // 并列记为敏捷
}

/**
 * 把一次命中投拆开：用哪项属性、加不加熟练，**以及每一项的理由**。
 * 调整值、label、卡片明细行全都从这里出，避免三处各算一遍、算出不同结果。
 *
 * 理由文案是确定性生成的（plan §5.4「可观测性」）：
 *   属性：finesse →「{武器类别}·力敏取高」/ melee →「{武器类别}·近战用力量」/
 *         ranged →「{武器类别}·用敏捷」/ mental →「{武器类别}·智感魅取高」
 *   熟练：明说 →「明说加熟练 / 明说不加熟练」；
 *         按角色给的（枪械、符具）→「{武器类别}·{角色名}熟练 / ·只有{角色名}熟练」；
 *         其余没说 →「{武器类别}·默认熟练 / ·默认不加」
 *
 * @param {object} card 角色卡
 * @param {{weaponClass?: string, proficiencyOverride?: boolean|null}} intent 命中投意图
 * @returns {{weaponCn: string, mode: string, ability: string, abilityNote: string,
 *            addProficiency: boolean, proficiencyNote: string}}
 */
function buildAttackPlan(card, intent) {
  const cls = V.WEAPON_CLASSES[intent.weaponClass] || V.WEAPON_CLASSES.none;
  const mode = cls.key;
  const ability = resolveAttackAbility(card, mode);

  const abilityNote = mode === 'ranged' ? `${cls.cn}·用敏捷`
    : mode === 'melee' ? `${cls.cn}·近战用力量`
    : mode === 'mental' ? `${cls.cn}·智感魅取高`
    : `${cls.cn}·力敏取高`;

  // 枪械和符具的熟练是**按角色**给的：只有 proficientFor 那个人默认熟练
  const owner = cls.proficientFor || null;
  const byOwner = owner ? String(card && card.name) === owner : null;
  const defaultProficient = owner ? byOwner : cls.proficient;

  const override = intent.proficiencyOverride;
  const addProficiency = override == null ? defaultProficient : override;
  const proficiencyNote = override === true ? '明说加熟练'
    : override === false ? '明说不加熟练'
    : owner ? (byOwner ? `${cls.cn}·${owner}熟练` : `${cls.cn}·只有${owner}熟练`)
    : (cls.proficient ? `${cls.cn}·默认熟练` : `${cls.cn}·默认不加`);

  return { weaponCn: cls.cn, mode, ability, abilityNote, addProficiency, proficiencyNote };
}

/**
 * 把调整值拆成带理由的明细项，给卡片逐项展示（plan §5.4「可观测性」）。
 * 目前只有命中投需要——别的检定类型返回 null，卡片照旧显示。
 *
 * 未加熟练时**也要有一项**（value 0），「没加」本身就是要被看见的信息。
 *
 * @param {object} card 角色卡
 * @param {object} intent 已校验过的意图
 * @returns {Array<{name: string, value: number, note: string}>|null}
 */
function buildModifierParts(card, intent) {
  if (intent.type !== 'attack') return null;

  const attrs = (card && card.attributes) || {};
  const pb = Number(card && card.proficiencyBonus) || 0;
  const plan = buildAttackPlan(card, intent);

  const parts = [
    { name: V.ATTR_CN[plan.ability] || plan.ability,
      value: Number(attrs[plan.ability]) || 0,
      note: plan.abilityNote },
    { name: '熟练',
      value: plan.addProficiency ? pb : 0,
      note: plan.proficiencyNote }
  ];

  const extra = Number(intent.extraModifier) || 0;
  if (extra) parts.push({ name: '额外', value: extra, note: '玩家口述' });
  return parts;
}

/**
 * 把明细项排成卡片上那一行，例如
 * 「15 + 3 敏捷（未提武器·力敏取高）+ 2 熟练（明说加熟练）= 20」。
 *
 * 排版规则：各段之间留一个空格，但中文右括号「）」后面不再留——
 * 全角括号本身自带视觉间距，留了反而松散。
 * ⚠️ game.html 的 buildDiceCard 里有一份等价实现（前端拿不到 lib/），改这里时两边要一起改。
 *
 * @param {string} diceText 骰子部分，例如 '15' 或 'max(17, 4)'
 * @param {Array<{name: string, value: number, note: string}>} parts
 * @param {number} total 最终结果
 * @returns {string}
 */
function formatModifierBreakdown(diceText, parts, total) {
  const tokens = [diceText];
  for (const p of parts) {
    if (p.value === 0 && p.name === '熟练') {
      tokens.push(`+ 未加熟练（${p.note}）`);
    } else {
      tokens.push(`${p.value < 0 ? '−' : '+'} ${Math.abs(p.value)} ${p.name}（${p.note}）`);
    }
  }
  tokens.push(`= ${total}`);
  return tokens.join(' ').replace(/）\s+/g, '）');
}

/**
 * 伤害骰的计划：投几颗、几面、加哪项属性调整值、有没有专属加值。
 * 和 buildAttackPlan 一样是**唯一**的口径来源——预览卡片、真正掷骰、卡片明细都调它。
 *
 * 判不出该投什么伤害骰时返回 { available: false, note }：
 * 没提武器（「命中投」）和只说了「开枪」但没说手枪步枪都属于这种，
 * 按用户的要求**不猜**——命中投照投，伤害那一行写清缺了什么信息（2d4 和 2d12 差太远）。
 *
 * @param {object} card 角色卡
 * @param {{type: string, weaponClass?: string}} intent 已校验过的意图
 * @param {{supernatural?: boolean}} [opts] 玩家在预览卡片上勾了「对抗超自然生物」
 * @returns {null | {available: false, note: string}
 *          | {available: true, classKey: string, cn: string, count: number, sides: number,
 *             modifier: number, parts: Array, damageType: string|null,
 *             supernatural: boolean, canToggleSupernatural: boolean, label: string, expr: string}}
 */
function buildDamagePlan(card, intent, opts) {
  if (!intent || intent.type !== 'attack') return null;

  const cls = V.WEAPON_CLASSES[intent.weaponClass] || V.WEAPON_CLASSES.none;
  const dmg = cls.damage ? V.DAMAGE_CLASSES[cls.damage] : null;
  if (!dmg) {
    return { available: false, note: `${cls.damageHint || '判不出用的什么武器'}，伤害没投` };
  }

  // 属性调整值：physical = 力敏取高，mental = 智感魅取高，null = 不加（手枪）
  const parts = [];
  if (dmg.ability) {
    const ability = resolveAttackAbility(card, dmg.ability === 'mental' ? 'mental' : 'finesse');
    parts.push({
      name: V.ATTR_CN[ability] || ability,
      value: Number((card && card.attributes || {})[ability]) || 0,
      note: `${dmg.cn}·${dmg.ability === 'mental' ? '智感魅取高' : '力敏取高'}`
    });
  }
  // 专属加值：V 的剔骨刀 +6，别人拿着同一把刀没有这个加值
  const bonus = cls.damageBonus;
  if (bonus && String(card && card.name) === bonus.character) {
    parts.push({ name: cls.cn, value: bonus.value, note: `${bonus.character} 专属` });
  }

  const canToggleSupernatural = !!dmg.supernaturalDice;
  const supernatural = canToggleSupernatural && !!(opts && opts.supernatural);
  const count = supernatural ? dmg.supernaturalDice : dmg.count;
  const modifier = parts.reduce((sum, p) => sum + p.value, 0);

  return {
    available: true,
    classKey: cls.damage,
    cn: dmg.cn,
    count,
    sides: dmg.sides,
    modifier,
    parts,
    damageType: dmg.damageType || null,
    supernatural,
    canToggleSupernatural,
    label: buildDamageLabel(dmg, supernatural),
    expr: buildDamageExpr(count, dmg.sides, modifier)
  };
}

/** 伤害那一行的标签，例如「刀具伤害」「符具伤害（魔法·对抗超自然）」 */
function buildDamageLabel(dmg, supernatural) {
  const tags = [];
  if (dmg.damageType) tags.push(dmg.damageType);
  if (supernatural) tags.push('对抗超自然');
  return `${dmg.cn}伤害` + (tags.length ? `（${tags.join('·')}）` : '');
}

/** 伤害表达式，例如 '2d8+3' / '4d6' / '2d10' */
function buildDamageExpr(count, sides, modifier) {
  const dice = `${count}d${sides}`;
  if (!modifier) return dice;
  return dice + (modifier > 0 ? '+' : '-') + Math.abs(modifier);
}

/** 掷 n 颗 sides 面骰，服务端 crypto，和 d20 同一口径 */
function rollDice(count, sides) {
  const rolls = [];
  for (let i = 0; i < count; i++) rolls.push(crypto.randomInt(1, sides + 1));
  return rolls;
}

/**
 * 真正掷伤害骰，结果直接挂到 dice 条目的 `damage` 字段上。
 *
 * 三种「不投」的情况都会带着理由返回，让卡片有话可说：
 *   - 判不出武器 → { note: '没听出用的什么武器，伤害没投' }
 *   - 大失败（d20 = 1，必定未命中）→ { note: '大失败·未命中' }
 * 大成功（d20 = 20）按用户的规则**骰子数翻倍**（2d8 → 4d8），调整值不翻倍。
 *
 * @param {object} card 角色卡
 * @param {object} intent 已校验过的意图
 * @param {{kept: number, supernatural?: boolean}} ctx kept 是命中投采用的那颗 d20
 * @returns {null|object} 挂在结果条目上的 damage 字段
 */
function buildDamageOutcome(card, intent, ctx) {
  const plan = buildDamagePlan(card, intent, { supernatural: ctx && ctx.supernatural });
  if (!plan) return null;
  if (!plan.available) return { rolled: false, note: plan.note };

  const kept = ctx && ctx.kept;
  // 大失败必定未命中，伤害数字只会干扰 DM（用户 2026-09-26 拍板）
  if (kept === 1) return { rolled: false, label: plan.label, note: '大失败·未命中' };

  const crit = kept === 20;
  const count = crit ? plan.count * 2 : plan.count;
  const rolls = rollDice(count, plan.sides);
  const total = rolls.reduce((a, b) => a + b, 0) + plan.modifier;

  return {
    rolled: true,
    label: plan.label,
    damageType: plan.damageType,
    supernatural: plan.supernatural,
    crit,
    count,
    sides: plan.sides,
    expr: buildDamageExpr(count, plan.sides, plan.modifier),
    rolls,
    modifier: plan.modifier,
    parts: plan.parts,
    total
  };
}

/**
 * 根据角色卡和检定意图计算最终调整值（不含骰子本身）。
 * 纯函数：不读文件、不访问 gameState。
 *
 * 规则：ability → 属性调整值；save → 属性 + (熟练豁免 ? PB : 0)；
 *       skill → 对应属性 + (熟练技能 ? PB : 0)；attack → 武器对应属性 + (该加熟练 ? PB : 0)；
 *       initiative → 敏捷；deathSave → 0。
 * 最后再加上玩家明说的 extraModifier。
 * 注意：不熟练的技能照样加对应属性调整值，只是不加熟练加值。
 *
 * @param {object} card 角色卡（characters.json 里的一项）
 * @param {{type: string, key: string|null, extraModifier?: number}} intent 已校验过的意图
 * @returns {number} 调整值，例如 V 的敏捷豁免返回 5
 */
function computeRollModifier(card, intent) {
  const attrs = (card && card.attributes) || {};
  const pb = Number(card && card.proficiencyBonus) || 0;
  const saves = (card && card.savingThrows) || [];
  const skills = (card && card.skills) || [];
  const attrOf = key => Number(attrs[key]) || 0;

  let base = 0;
  switch (intent.type) {
    case 'ability':
      base = attrOf(intent.key);
      break;
    case 'save':
      base = attrOf(intent.key) + (saves.includes(intent.key) ? pb : 0);
      break;
    case 'skill':
      base = attrOf(V.SKILL_ATTR[intent.key]) + (skills.includes(intent.key) ? pb : 0);
      break;
    case 'attack': {
      // 加不加熟练由武器类别和玩家的口头覆盖共同决定（plan §3.2）
      const plan = buildAttackPlan(card, intent);
      base = attrOf(plan.ability) + (plan.addProficiency ? pb : 0);
      break;
    }
    case 'initiative':
      base = attrOf('dexterity');
      break;
    case 'deathSave':
      base = 0;   // 死亡豁免是纯 d20
      break;
    default:
      base = 0;
  }
  return base + (Number(intent.extraModifier) || 0);
}

/**
 * 生成中文标签，例如「带优势的察觉检定」「魅力豁免」「先攻」「命中投（敏捷）」。
 * 由枚举确定性生成，不用 LLM 原话（LLM 只负责判枚举）。
 *
 * 命中投的标签要写全「用了哪项属性、值多少、加没加熟练、加了多少」
 * （用户硬性要求，plan §5.4），这些都要读角色卡，所以这里要拿到卡。
 *
 * @param {{type: string, key: string|null, advantage?: string}} intent 已校验过的意图
 * @param {object} [card] 角色卡；命中投必须传，其他检定类型用不到
 * @returns {string} 标签，判不出来时返回空串
 */
function buildRollLabel(intent, card) {
  let core = '';
  switch (intent.type) {
    case 'ability':    core = (V.ATTR_CN[intent.key] || '') + V.ABILITY_CHECK_WORD; break;
    case 'save':       core = (V.ATTR_CN[intent.key] || '') + '豁免'; break;
    case 'skill':      core = (V.SKILL_CN[intent.key] || '') + '检定'; break;
    case 'attack': {
      const plan = buildAttackPlan(card, intent);
      const pb = Number(card && card.proficiencyBonus) || 0;
      const attr = Number((card && card.attributes || {})[plan.ability]) || 0;
      // 标签里用普通减号（plan §5.4 的示例「命中投（力量 -1，未加熟练）」），
      // 明细行里才用减号 −
      core = `${V.ATTACK_LABEL_WORD}（${V.ATTR_CN[plan.ability] || plan.ability} ` +
             `${attr >= 0 ? '+' : '-'}${Math.abs(attr)}，` +
             `${plan.addProficiency ? `熟练 +${pb}` : '未加熟练'}）`;
      break;
    }
    case 'initiative': core = '先攻'; break;
    case 'deathSave':  core = '死亡豁免'; break;
    default:           return '';
  }
  if (intent.advantage === 'advantage') return '带优势的' + core;
  if (intent.advantage === 'disadvantage') return '带劣势的' + core;
  return core;
}

/**
 * 生成骰子表达式，例如 'd20+5' / 'd20-1' / 'd20'。
 * 优劣势不进表达式，由 broadcast 的 advantage 字段表达（前端渲染成「两次取高/低」），
 * 这样手打 d20 和语音掷骰的表达式长得一样。
 *
 * @param {number} modifier 调整值
 * @returns {string}
 */
function buildRollExpr(modifier) {
  if (!modifier) return 'd20';
  return 'd20' + (modifier > 0 ? '+' : '-') + Math.abs(modifier);
}

/**
 * 服务端掷 d20。优势/劣势掷两次取高/取低；用 crypto.randomInt，
 * 不信任客户端传来的结果（现有 dice:roll 事件是信任客户端的，语音路径借机收回）。
 *
 * @param {'normal'|'advantage'|'disadvantage'} advantage
 * @returns {{ rolls: number[], kept: number }} rolls 为实际掷出的全部骰值，kept 为采用的那个
 */
function rollD20(advantage) {
  const one = () => crypto.randomInt(1, 21);
  if (advantage === 'advantage' || advantage === 'disadvantage') {
    const rolls = [one(), one()];
    const kept = advantage === 'advantage' ? Math.max(...rolls) : Math.min(...rolls);
    return { rolls, kept };
  }
  const r = one();
  return { rolls: [r], kept: r };
}

/**
 * 把一次语音掷骰打包成聊天历史条目 / dice:result 广播所需的字段。
 * 字段与手打掷骰（server.js 的 dice:roll）保持兼容，只是多了 label / advantage / kept / source。
 *
 * @param {{ name: string, role: string }} player 掷骰者
 * @param {{ type: string, key: string|null, advantage: string, extraModifier?: number }} intent
 * @param {object} detail
 * @param {number} detail.modifier 已算好的调整值
 * @param {object} [detail.card] 角色卡；命中投要用它掷伤害（伤害骰口径全看卡）
 * @param {boolean} [detail.supernatural] 符具攻击时玩家勾了「对抗超自然生物」
 * @param {Array|null} [detail.modifierParts] 带理由的明细项（命中投才有）
 * @param {string} [detail.label] 已生成的标签
 * @param {string} [detail.transcript] 识别原话，卡片上要显示，方便全桌核对有没有听错
 * @param {'rule'|'llm'} [detail.intentSource] 这条意图是规则判的还是 AI 判的
 * @param {'voice'|'text'} [detail.inputMode] 玩家是说出来的还是在聊天框 @ai 打出来的
 * @returns {object} dice 历史条目 / dice:result 广播用的完整字段
 */
function buildRollOutcome(player, intent, detail) {
  const advantage = intent.advantage || 'normal';
  const { rolls, kept } = rollD20(advantage);
  const modifier = detail.modifier;
  // 命中投掷完接着掷伤害：大成功翻倍骰子数、大失败不投，都要拿到 kept 才知道
  const damage = detail.card
    ? buildDamageOutcome(detail.card, intent, { kept, supernatural: detail.supernatural })
    : null;
  return {
    type: 'dice',
    name: player.name,
    role: player.role,
    timestamp: Date.now(),
    sides: 20,
    expr: buildRollExpr(modifier),
    rolls,
    kept,
    modifier,
    count: 1,
    result: kept + modifier,
    advantage,
    label: detail.label || '',
    // 可观测性：明细项（含理由）、识别原话、判定来源都要进历史，
    // 这样刷新后回放出来的卡片和实时看到的一模一样（plan §5.4）
    modifierParts: detail.modifierParts || null,
    transcript: detail.transcript || '',
    intentSource: detail.intentSource || null,
    source: detail.inputMode === 'text' ? 'text' : 'voice',
    // 伤害骰（只有命中投有）。null = 这次检定没有伤害概念；
    // { rolled: false, note } = 有伤害概念但这次没投，note 说明为什么
    damage
  };
}

module.exports = {
  computeRollModifier, buildRollLabel, buildRollExpr, rollD20, buildRollOutcome,
  resolveAttackAbility, pickHighestAbility, buildAttackPlan, buildModifierParts,
  formatModifierBreakdown,
  buildDamagePlan, buildDamageOutcome, buildDamageExpr, rollDice
};

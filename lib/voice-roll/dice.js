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
 * 命中投实际用哪一项属性。
 * melee（棍棒斧锤拳）→ 力量；ranged（枪弓弩）→ 敏捷；
 * finesse（刀匕首，以及**没提武器**的情况）→ 力量和敏捷中较高的，相等时记为敏捷。
 * 纯函数：调整值和 label 都调它，别各算一遍，否则两边可能对不上。
 *
 * @param {object} card 角色卡
 * @param {'melee'|'ranged'|'finesse'} mode 武器模式（intent.key）
 * @returns {'strength'|'dexterity'}
 */
function resolveAttackAbility(card, mode) {
  const attrs = (card && card.attributes) || {};
  if (mode === 'melee') return 'strength';
  if (mode === 'ranged') return 'dexterity';
  const str = Number(attrs.strength) || 0;
  const dex = Number(attrs.dexterity) || 0;
  return str > dex ? 'strength' : 'dexterity';   // 相等记为敏捷
}

/**
 * 根据角色卡和检定意图计算最终调整值（不含骰子本身）。
 * 纯函数：不读文件、不访问 gameState。
 *
 * 规则：ability → 属性调整值；save → 属性 + (熟练豁免 ? PB : 0)；
 *       skill → 对应属性 + (熟练技能 ? PB : 0)；attack → 武器对应属性 + PB（一律加，用户拍板）；
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
    case 'attack':
      // 命中投一律加熟练：5e 所有职业都熟练简易武器，角色卡也没有武器熟练字段
      base = attrOf(resolveAttackAbility(card, intent.key)) + pb;
      break;
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
 * 命中投要标出实际用的属性（finesse 取哪个属性取决于角色卡），
 * 所以调用方要先 resolveAttackAbility 再把结果传进来。
 *
 * @param {{type: string, key: string|null, advantage?: string}} intent 已校验过的意图
 * @param {'strength'|'dexterity'|null} [attackAbility] 命中投实际用的属性
 * @returns {string} 标签，判不出来时返回空串
 */
function buildRollLabel(intent, attackAbility) {
  let core = '';
  switch (intent.type) {
    case 'ability':    core = (V.ATTR_CN[intent.key] || '') + V.ABILITY_CHECK_WORD; break;
    case 'save':       core = (V.ATTR_CN[intent.key] || '') + '豁免'; break;
    case 'skill':      core = (V.SKILL_CN[intent.key] || '') + '检定'; break;
    case 'attack':
      core = V.ATTACK_LABEL_WORD +
             (attackAbility ? `（${V.ATTR_CN[attackAbility] || attackAbility}）` : '');
      break;
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
 * @param {number} modifier 已算好的调整值
 * @param {'strength'|'dexterity'|null} [attackAbility] 命中投实际用的属性（非命中投传 null）
 * @returns {object} { type:'dice', name, role, timestamp, sides, expr, rolls, kept, modifier, count, result, advantage, label, source }
 */
function buildRollOutcome(player, intent, modifier, attackAbility) {
  const advantage = intent.advantage || 'normal';
  const { rolls, kept } = rollD20(advantage);
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
    label: buildRollLabel(intent, attackAbility),
    source: 'voice'
  };
}

module.exports = {
  computeRollModifier, buildRollLabel, buildRollExpr, rollD20, buildRollOutcome, resolveAttackAbility
};

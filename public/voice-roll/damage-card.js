/*
 * 伤害骰在聊天卡片里的那一行。
 *
 * 负责：把 dice 条目的 `damage` 字段渲染成骰子卡片底部的一行——
 *       标签、表达式、逐颗骰子与调整值的明细、总伤害；没投出来时写清为什么没投。
 * 不负责：掷骰与数值（服务端 lib/voice-roll/dice.js 是唯一口径）、
 *         骰子卡片其余部分（game.html 的 buildDiceCard）。
 *
 * 谁引入：game.html，在主 <script> 之前引入本文件；buildDiceCard 里只有一行
 *         `window.DamageCard.html(entry.damage, escapeHtml)` 的钩子。
 * 依赖：调用方传进来的 escapeHtml（复用 game.html 那份，不偷用全局变量）。
 *
 * ⚠️ 明细行的排版规则（各段空一格、全角「）」后不留空格）和服务端
 *    lib/voice-roll/dice.js 的 formatModifierBreakdown 是一对，前端拿不到 lib/，
 *    改一边要记得改另一边。
 */
(function () {
    'use strict';

    /**
     * 渲染骰子卡片里伤害那一行。
     *
     * damage 有三种形态（服务端 buildDamageOutcome 的输出）：
     *   null                          这次检定没有伤害概念（不是命中投）→ 不渲染
     *   { rolled: false, note }        有伤害概念但这次没投（没听出武器 / 大失败未命中）
     *   { rolled: true, ... }          真投了
     *
     * @param {object|null} damage dice 条目的 damage 字段
     * @param {(s: string) => string} escapeHtml 转义函数
     * @returns {string} 一段 HTML；不需要渲染时返回空串
     */
    function html(damage, escapeHtml) {
        const esc = escapeHtml || (s => String(s));
        if (!damage) return '';

        // 没投出来：把原因写出来。「没听出用的什么武器」是要玩家补一句话再投一次，
        // 静默不显示的话玩家只会以为系统忘了投伤害
        if (!damage.rolled) {
            return '<div class="dice-damage dice-damage-skipped">伤害：' +
                esc(damage.note || '没投') + '</div>';
        }

        const rolls = Array.isArray(damage.rolls) ? damage.rolls : [];
        const parts = Array.isArray(damage.parts) ? damage.parts : [];

        // 明细：逐颗骰子 + 每一项调整值（带理由），例如
        // 「5 + 6 + 3 敏捷（刀具·力敏取高）+ 6 剔骨刀（V 专属）= 20」
        const tokens = [rolls.map(r => esc(String(r))).join(' + ')];
        parts.forEach(part => {
            const note = part.note ? `（${esc(part.note)}）` : '';
            tokens.push(`${part.value < 0 ? '−' : '+'} ${Math.abs(part.value)} ` +
                        `${esc(part.name)}${note}`);
        });
        tokens.push(`= ${esc(String(damage.total))}`);
        const breakdown = tokens.join(' ').replace(/）\s+/g, '）');

        // 大成功翻倍了骰子数，得说出来，否则「2d8 的攻击怎么滚出 4 颗骰子」没人看得懂
        const critTag = damage.crit
            ? ' <span class="dice-damage-crit">大成功·骰子翻倍</span>' : '';

        return '<div class="dice-damage">' +
            `<div class="dice-damage-head"><b>${esc(damage.label || '伤害')}</b> ` +
            `${esc(damage.expr || '')}${critTag}` +
            // 表达式和结果之间要有等号，否则「2d4+3 7」读起来像两个并列的数
            '<span class="dice-damage-eq">=</span>' +
            `<span class="dice-damage-total">${esc(String(damage.total))}</span></div>` +
            `<div class="dice-damage-expr">${breakdown}</div>` +
        '</div>';
    }

    window.DamageCard = { html };
})();

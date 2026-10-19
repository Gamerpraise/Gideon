export default {
    name: 'calc',
    aliases: ['calculate', 'math'],
    description: 'Do maths',
    usage: 'calc 12*(3+4)',
    async run({ text, reply }) {
        const expr = text.replace(/x/gi, '*').replace(/÷/g, '/').replace(/\^/g, '**').replace(/,/g, '');
        if (!expr || !/^[0-9+\-*/().%\s]+$/.test(expr)) return reply('🧮 Example: *calc 12*(3+4)*\nOnly numbers and + - * / ^ % ( ) are allowed.');
        let result;
        try { result = Function(`"use strict"; return (${expr})`)(); }
        catch { return reply('❌ I could not calculate that.'); }
        if (typeof result !== 'number' || !Number.isFinite(result)) return reply('❌ That has no valid answer.');
        reply(`🧮 ${text} = *${+result.toFixed(8)}*`);
    }
};

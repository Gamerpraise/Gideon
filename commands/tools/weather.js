export default {
    name: 'weather',
    aliases: ['wea'],
    description: 'Current weather for a city',
    usage: 'weather Lagos',
    cooldown: 5,
    async run({ text, reply, utils }) {
        if (!text) return reply('🌍 Type a city. Example: *weather Lagos*');
        const data = await utils.getJson(`https://wttr.in/${encodeURIComponent(text)}?format=j1`);
        const now = data.current_condition?.[0];
        const area = data.nearest_area?.[0];
        if (!now) return reply('❌ City not found.');
        reply(
`🌤️ *Weather – ${area?.areaName?.[0]?.value || text}, ${area?.country?.[0]?.value || ''}*

🌡️ Temperature: ${now.temp_C}°C (feels like ${now.FeelsLikeC}°C)
☁️ Condition: ${now.weatherDesc?.[0]?.value}
💧 Humidity: ${now.humidity}%
💨 Wind: ${now.windspeedKmph} km/h
👁️ Visibility: ${now.visibility} km`);
    }
};

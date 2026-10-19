// One place that loads Baileys, so every file works with both Baileys 6.x and 7.x export styles.
import * as B from '@whiskeysockets/baileys';

const get = (name) => B[name] ?? B.default?.[name];

export const makeWASocket = B.makeWASocket ?? (typeof B.default === 'function' ? B.default : B.default?.default);
export const useMultiFileAuthState = get('useMultiFileAuthState');
export const makeCacheableSignalKeyStore = get('makeCacheableSignalKeyStore');
export const fetchLatestBaileysVersion = get('fetchLatestBaileysVersion');
export const Browsers = get('Browsers');
export const DisconnectReason = get('DisconnectReason');
export const jidNormalizedUser = get('jidNormalizedUser');
export const BufferJSON = get('BufferJSON');
export const delay = get('delay');
export const getContentType = get('getContentType');
export const downloadMediaMessage = get('downloadMediaMessage');

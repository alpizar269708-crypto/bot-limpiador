const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const pino = require('pino');

const app = express();
let qrImagen = '';

if (!fs.existsSync('./auth_info_baileys')) fs.mkdirSync('./auth_info_baileys');

// Mapa ultraligero para guardar solo el último mensaje de cada chat activo (Consume cero RAM extra)
const lastMessageMap = {};
const privateChats = new Set();

app.get('/', (req, res) => {
    if (qrImagen) {
        res.send(`<html><body style="background:#000; color:#0f0; text-align:center; padding-top:50px;"><h2>Escanea este QR con tu WhatsApp</h2><img src="${qrImagen}" style="background:#fff; padding:10px; border-radius:10px;"/></body></html>`);
    } else {
        res.send(`<html><body style="background:#000; color:#ff0; text-align:center; padding-top:50px;"><h2>⏳ Conectando con WhatsApp...</h2><p style="color:#fff;">Si no carga en 10 segundos, recarga la página.</p></body></html>`);
    }
});
app.listen(process.env.PORT || 3000);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ 
        version,
        auth: state, 
        logger: pino({ level: 'silent' }), // Sin logs para velocidad máxima
        markOnlineOnConnect: false,
        syncFullHistory: false,            // Mantiene la RAM al mínimo
        browser: ['FastBot', 'Chrome', '120.0.0.0']
    });

    // Reinicio preventivo cada 24 horas para mantener el servidor fresco
    setInterval(() => process.exit(1), 24 * 60 * 60 * 1000);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { if (!err) qrImagen = url; });
        }
        if (connection === 'open') {
            qrImagen = '';
            console.log('=== BOT ONLINE Y VELOCIDAD MÁXIMA ===');
        } else if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 2000);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const m of messages) {
            if (!m.message) continue;
            
            const chatJid = m.key.remoteJid;
            
            // Guardamos la referencia exacta del último mensaje de este chat específico
            lastMessageMap[chatJid] = {
                key: m.key,
                messageTimestamp: m.messageTimestamp
            };

            if (!chatJid.endsWith('@g.us')) privateChats.add(chatJid);

            if (m.key.fromMe) continue;

            const msgContent = m.message.ephemeralMessage?.message || m.message;
            const texto = (
                msgContent.conversation || 
                msgContent.extendedTextMessage?.text || 
                msgContent.imageMessage?.caption || 
                ""
            ).toLowerCase().trim();

            // Comando para borrar todo de golpe
            if (texto === 'delchats' || texto === 'elcht0') {
                await sock.sendMessage(chatJid, { text: '⚡ Vaciando y eliminando todos los chats...' });

                try {
                    const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
                    const allTargets = new Set([...Object.keys(groups), ...privateChats, chatJid]);

                    // Ejecución en paralelo real para máxima velocidad
                    const deletePromises = Array.from(allTargets).map(async (id) => {
                        try {
                            const lastMsg = lastMessageMap[id];
                            if (lastMsg) {
                                // Borrado con la referencia exacta que exige WhatsApp
                                await sock.chatModify({
                                    delete: true,
                                    lastMessages: [{
                                        key: lastMsg.key,
                                        messageTimestamp: lastMsg.messageTimestamp
                                    }]
                                }, id);
                            } else {
                                // Borrado estándar de respaldo
                                await sock.chatModify({ delete: true, lastMessages: [] }, id);
                            }
                        } catch (e) {
                            console.log(`No se pudo borrar el chat ${id}`);
                        }
                    });

                    await Promise.all(deletePromises);
                    await sock.sendMessage(chatJid, { text: '✅ ¡Proceso completado! Todos los chats eliminados (sigues en tus grupos).' });
                } catch (err) {
                    console.error('Error general:', err);
                }
            }
        }
    });
}

startBot();

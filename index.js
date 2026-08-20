const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeInMemoryStore } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const pino = require('pino');

const app = express();
let qrImagen = '';

if (!fs.existsSync('./auth_info_baileys')) fs.mkdirSync('./auth_info_baileys');

// Almacén en memoria ultraligero para registrar los chats y sus últimos mensajes
const store = makeInMemoryStore({});

app.get('/', (req, res) => {
    if (qrImagen) {
        res.send(`<html><body style="background:#000; color:#0f0; text-align:center; padding-top:50px;"><h2>Escanea este QR con tu WhatsApp</h2><img src="${qrImagen}" style="background:#fff; padding:10px; border-radius:10px;"/></body></html>`);
    } else {
        res.send(`<html><body style="background:#000; color:#ff0; text-align:center; padding-top:50px;"><h2>⏳ Conectando con WhatsApp...</h2><p style="color:#fff;">Si el QR no aparece en 10 segundos, recarga la página.</p></body></html>`);
    }
});
app.listen(process.env.PORT || 3000);

async function startBot() {
    console.log('Iniciando conexión con Baileys...');
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ 
        version,
        auth: state, 
        logger: pino({ level: 'info' }), 
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: ['FastBot', 'Chrome', '120.0.0.0']
    });

    // Vinculamos el store para que el bot registre los chats activos y mensajes
    store.bind(sock.ev);

    setInterval(() => process.exit(1), 24 * 60 * 60 * 1000);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        
        if (qr) {
            console.log('¡Código QR generado con éxito!');
            qrcode.toDataURL(qr, (err, url) => { 
                if (!err) qrImagen = url; 
            });
        }

        if (connection === 'open') {
            qrImagen = '';
            console.log('=== ¡BOT CONECTADO EXITOSAMENTE! ===');
        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log('Conexión cerrada. Código:', reason);
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(startBot, 3000);
            } else {
                console.log('Sesión cerrada.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const msgContent = m.message.ephemeralMessage?.message || m.message;
        const texto = (
            msgContent.conversation || 
            msgContent.extendedTextMessage?.text || 
            msgContent.imageMessage?.caption || 
            ""
        ).toLowerCase().trim();

        if (texto === 'delchats') {
            await sock.sendMessage(m.key.remoteJid, { text: '🧹 Eliminando todos los chats y mensajes...' });
            try {
                // Obtenemos todos los chats registrados en la memoria del bot
                const allChats = store.chats.all();

                if (allChats.length === 0) {
                    await sock.sendMessage(m.key.remoteJid, { text: '⚠️ No hay chats registrados todavía en la memoria.' });
                    return;
                }

                for (const chat of allChats) {
                    try {
                        const chatId = chat.id;
                        
                        // Obtenemos los mensajes de este chat para extraer la referencia del último mensaje (Requisito de WhatsApp MD)
                        const chatMessages = store.messages[chatId]?.array || [];
                        const lastMessage = chatMessages[chatMessages.length - 1];

                        if (lastMessage) {
                            // Borrado completo enviando la clave del último mensaje que exige WhatsApp
                            await sock.chatModify({
                                delete: true,
                                lastMessages: [{ key: lastMessage.key, messageTimestamp: lastMessage.messageTimestamp }]
                            }, chatId);
                        } else {
                            // Borrado directo si no hay mensajes en caché
                            await sock.chatModify({ delete: true }, chatId);
                        }
                    } catch (innerErr) {
                        console.log(`No se pudo eliminar el chat:`, innerErr.message);
                    }
                }

                await sock.sendMessage(m.key.remoteJid, { text: '✅ ¡Proceso finalizado! Chats eliminados de todos lados (sigues dentro de los grupos).' });
            } catch (err) {
                console.error('Error general:', err);
                await sock.sendMessage(m.key.remoteJid, { text: `❌ Error al ejecutar: ${err.message}` });
            }
        }
    });
}

startBot();

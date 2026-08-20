sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        const texto = (m.message.conversation || m.message.extendedTextMessage?.text || "").toLowerCase().trim();

        if (texto === 'elcht0') {
            await sock.sendMessage(m.key.remoteJid, { text: '🧹 Intentando limpiar los chats...' });
            try {
                // Obtenemos los grupos en los que participa el bot
                const chats = await sock.groupFetchAllParticipating();
                const chatIds = Object.keys(chats);

                if (chatIds.length === 0) {
                    await sock.sendMessage(m.key.remoteJid, { text: '⚠️ No hay chats grupales activos para limpiar.' });
                    return;
                }

                for (const id of chatIds) {
                    try {
                        // Método actualizado de Baileys para eliminar/ocultar el chat
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

const express = require('express');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const { default: Baileys, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers } = require('@whiskeysockets/baileys');
const { makeid } = require('./id');

const router = express.Router();

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

function buildSession(sessionDir) {
    const creds = JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf-8'));
    delete creds.lastPropHash;
    return JSON.stringify(creds);
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    async function pair() {
        const { state, saveCreds } = await useMultiFileAuthState('./temp/' + id);
        try {
            const conn = Baileys({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }))
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }),
                browser: Browsers.macOS('Chrome')
            });

            if (!conn.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await conn.requestPairingCode(num);
                if (!res.headersSent) res.send({ code });
            }

            conn.ev.on('creds.update', saveCreds);
            conn.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
                if (connection === 'open') {
                    await delay(3000);
                    const sessionCode = buildSession(`./temp/${id}`);

                    await conn.sendMessage(conn.user.id, { text: sessionCode });

                    const instructions = `
> ✅ Successfully Connected

> 📁 Create a folder named "sessions"

> 💾 Save this session code as creds.json inside it

> 🔁 BOT REPO FORK: https://github.com/Mrhanstz/HANS-XMD_V2/fork

> 📣 WHATSAPP CHANNEL: https://whatsapp.com/channel/0029VasiOoR3bbUw5aV4qB31

> 🧠 MY GITHUB: https://github.com/Mrhanstz`;

                    await conn.sendMessage(conn.user.id, { text: instructions });

                    await delay(500);
                    await conn.ws.close();
                    removeFile('./temp/' + id);
                } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(10000);
                    pair();
                }
            });
        } catch (err) {
            console.error('Pairing Error:', err);
            removeFile('./temp/' + id);
            if (!res.headersSent) {
                res.send({ code: 'Service Currently Unavailable' });
            }
        }
    }

    await pair();
});

module.exports = router;
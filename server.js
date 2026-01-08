const fastify = require('fastify')({
    logger: true,
    disableRequestLogging: true // Riduciamo il rumore nei log per produzione
});
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// 1. Sicurezza: Headers HTTP sicuri
fastify.register(require('@fastify/helmet'));

// 2. Sicurezza: CORS per uso pubblico
fastify.register(require('@fastify/cors'), {
    origin: '*', // API pubblica, permettiamo a tutti (o restringere se necessario)
    methods: ['GET', 'POST']
});

// 3. Sicurezza: Rate Limiting per prevenire abusi
fastify.register(require('@fastify/rate-limit'), {
    max: 100, // Max 100 richieste
    timeWindow: '1 minute' // per minuto
});

// Database Setup
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        fastify.log.error('Errore DB: ' + err.message);
        process.exit(1);
    }
    fastify.log.info('Connesso al database SQLite.');
    initDb();
});

function initDb() {
    db.serialize(() => {
        // Schema normalizzato: imageUrl per coerenza
        db.run(`CREATE TABLE IF NOT EXISTS demons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      race TEXT,
      alignment TEXT,
      imageUrl TEXT
    )`);

        seedData();
    });
}

function seedData() {
    const seedsDir = path.join(__dirname, 'seeds');
    if (!fs.existsSync(seedsDir)) return;

    const files = fs.readdirSync(seedsDir).filter(f => f.endsWith('.json'));

    files.forEach(file => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(seedsDir, file), 'utf8'));
            const stmt = db.prepare(`
        INSERT OR IGNORE INTO demons (name, description, race, alignment, imageUrl) 
        VALUES (?, ?, ?, ?, ?)
      `);

            data.forEach(demon => {
                // Normalizzazione campi: gestisce sia 'img' (vecchi batch) che 'image_source_url' (nuovi)
                const img = demon.image_source_url || demon.img || "";
                // Normalizzazione alignment: assicura coerenza (opzionale, ma buona pratica)
                let align = demon.alignment; // Assumiamo già corretto dai batch

                stmt.run(demon.name, demon.description, demon.race, align, img);
            });

            stmt.finalize();
            fastify.log.info(`Processato seed: ${file}`);
        } catch (e) {
            fastify.log.error(`Errore nel caricamento seed ${file}: ${e.message}`);
        }
    });
}

// Schemi di Validazione (Input Validation)
const demonSchema = {
    body: {
        type: 'object',
        required: ['name', 'race', 'alignment'],
        properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            description: { type: 'string', maxLength: 500 },
            race: { type: 'string', maxLength: 50 },
            alignment: { type: 'string', enum: ['Law', 'Neutral', 'Chaos', 'unknown', 'Light-Law', 'Dark-Chaos', 'Neutral-Neutral'] }, // Supportiamo i vecchi e i nuovi
            imageUrl: { type: 'string', format: 'uri' }
        }
    }
};

// Rotte

// GET / (Home)
fastify.get('/', async (request, reply) => {
    return {
        message: 'Benvenuti nella SMT API',
        endpoints: {
            list: 'GET /demons',
            create: 'POST /demons'
        }
    };
});

// GET /demons
fastify.get('/demons', async (request, reply) => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM demons ORDER BY id", [], (err, rows) => {
            if (err) {
                request.log.error(err);
                reply.status(500).send({ error: 'Internal Server Error' });
                return reject(err);
            }
            resolve(rows);
        });
    });
});

// POST /demons (Protetta da validazione)
fastify.post('/demons', { schema: demonSchema }, async (request, reply) => {
    const { name, description, race, alignment, imageUrl } = request.body;

    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT INTO demons (name, description, race, alignment, imageUrl) VALUES (?, ?, ?, ?, ?)");

        stmt.run(name, description, race, alignment, imageUrl, function (err) {
            if (err) {
                // Gestione duplicati
                if (err.message.includes('UNIQUE constraint failed')) {
                    reply.status(409).send({ error: 'Demon already exists' });
                    return resolve();
                }
                request.log.error(err);
                reply.status(500).send({ error: 'Internal Server Error' });
                return resolve();
            }
            reply.code(201).send({
                id: this.lastID,
                name,
                description,
                race,
                alignment,
                imageUrl
            });
            resolve();
        });
        stmt.finalize();
    });
});

// Avvio Server
const start = async () => {
    try {
        const PORT = process.env.PORT || 3000;
        await fastify.listen({ port: PORT, host: '0.0.0.0' });
        console.log(`Server SMT API sicuro e attivo su http://0.0.0.0:${PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();

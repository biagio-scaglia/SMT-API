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
            list: 'GET /api/v1/demons',
            create: 'POST /api/v1/demons'
        },
        documentation: 'Consulta il README per i dettagli su filtri, ordinamento e paginazione.'
    };
});

// GET /api/v1/demons
fastify.get('/api/v1/demons', async (request, reply) => {
    const { filter, $sort, $page = 1, $pageSize = 10 } = request.query;

    let sql = "SELECT * FROM demons";
    const params = [];
    const whereClauses = [];

    // 1. Filtering (?filter=field:value)
    if (filter) {
        // Supporta formato semplice field:value
        const parts = filter.split(':');
        if (parts.length === 2) {
            const [key, value] = parts;
            // Whitelist colonne per sicurezza
            const allowedFilters = ['id', 'name', 'race', 'alignment'];
            if (allowedFilters.includes(key)) {
                whereClauses.push(`${key} = ?`);
                params.push(value);
            }
        }
    }

    if (whereClauses.length > 0) {
        sql += " WHERE " + whereClauses.join(' AND ');
    }

    // 2. Sorting ($sort=field_dir)
    if ($sort) {
        // Esempio: name_asc, id_desc
        const match = $sort.match(/^([a-zA-Z0-9]+)_(asc|desc)$/i);
        if (match) {
            const [_, col, dir] = match;
            const allowedSorts = ['id', 'name', 'race', 'alignment', 'imageUrl'];
            if (allowedSorts.includes(col)) {
                sql += ` ORDER BY ${col} ${dir.toUpperCase()}`;
            }
        }
    } else {
        sql += " ORDER BY id ASC"; // Default
    }

    // 3. Pagination ($page=2, $pageSize=10)
    const limit = parseInt($pageSize);
    const offset = (parseInt($page) - 1) * limit;

    // Validazione base numeri
    const safeLimit = isNaN(limit) || limit < 1 ? 10 : limit;
    const safeOffset = isNaN(offset) || offset < 0 ? 0 : offset;

    sql += " LIMIT ? OFFSET ?";
    params.push(safeLimit, safeOffset);

    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                request.log.error(err);
                reply.status(500).send({ error: 'Internal Server Error' });
                return reject(err);
            }

            // Opzionale: potremmo ritornare anche metadata (totalCount), 
            // ma per ora manteniamo l'array semplice come da richiesta base
            resolve(rows);
        });
    });
});

// POST /api/v1/demons (Protetta da validazione)
fastify.post('/api/v1/demons', { schema: demonSchema }, async (request, reply) => {
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

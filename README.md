# SMT API

Una REST API pubblica e read-only per i demoni di Shin Megami Tensei, costruita con Node.js, Fastify e SQLite.

## Caratteristiche

*   **Veloce**: Basata su Fastify.
*   **Sicura**: Implementa Helmet (header di sicurezza), CORS e Rate Limiting.
*   **Semplice**: Database SQLite senza configurazione.
*   **Dati**: Include un dataset iniziale di ~80 demoni con descrizioni in italiano.

## Installazione

1.  Clona il repository.
2.  Installa le dipendenze:
    ```bash
    npm install
    ```

## Avvio

Per avviare il server in modalità produzione:

```bash
npm start
```

Il server ascolterà su `http://localhost:3000`.

## API Endpoints

### `GET /demons`

Restituisce la lista completa dei demoni.

**Risposta:**

```json
[
  {
    "id": 1,
    "name": "Jack Frost",
    "description": "Uno spirito dell'inverno...",
    "race": "Fata",
    "alignment": "Neutral",
    "imageUrl": "..."
  },
  ...
]
```

### `POST /demons`

Crea un nuovo demone. Richiede un body JSON valido.

**Body:**

```json
{
  "name": "Nome Demone",
  "race": "Razza",
  "alignment": "Neutral"
}
```

Ritorna `201 Created` in caso di successo o errori `400 Bad Request` se i dati non sono validi.

## Sicurezza

*   **Rate Limit**: Max 100 richieste al minuto per IP.
*   **Input Validation**: Strict schema validation su tutti gli input.
*   **SQL Injection**: Uso rigoroso di prepared statements.
